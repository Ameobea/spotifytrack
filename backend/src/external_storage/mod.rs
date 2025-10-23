//! Utilities for reading/writing user stats history entries to/from external blob storage.
//!
//! Spotifytrack has many inactive users, but we still want to retain their data and continue to
//! update them. However, the MySQL database holding the user artist + track stats runs out of
//! space. To solve this, we periodically move track and artist stats to external blob storage.  New
//! updates are written to the database as per usual, and when they need to be read, we retrieve it
//! all and write it back to the database.
//!
//! To prevent multiple concurrent fetches from external storage, we use locks to ensure only one
//! fetch happens at the same time for each user.
//!
//! The external storage is a S3-compatible bucket hosted on Cloudflare R2.   The file format is
//! gzip-compressed parquet.

use std::{sync::Arc, time::Instant};

use arrow_schema::{DataType, Field, Schema, SchemaRef};
use dashmap::DashMap;
use diesel::prelude::*;
use lazy_static::lazy_static;
use object_store::{aws::AmazonS3Builder, ObjectStore};

use tokio::{
    sync::{watch, Mutex},
    task::block_in_place,
};

use crate::DbConn;

pub(crate) mod download;
pub(crate) mod upload;

const EXTERNAL_STORAGE_BUCKET_NAME: &'static str = "spotifytrack-cold-storage";
const BATCH_SIZE: usize = 5000;

lazy_static! {
    static ref EXTERNAL_STORAGE_ARROW_SCHEMA: SchemaRef = {
        let schema = Schema::new(vec![
            Field::new("id", DataType::UInt64, false),
            Field::new("user_id", DataType::UInt64, false),
            Field::new("update_time", DataType::Timestamp(arrow_schema::TimeUnit::Second, None), false),
            Field::new("mapped_spotify_id", DataType::UInt32, false),
            // tinyint, 0, 1, or 2
            Field::new("timeframe", DataType::UInt8, false),
            Field::new("ranking", DataType::UInt8, false),
        ]);
        Arc::new(schema)
    };
    static ref RETRIEVE_LOCKS: DashMap<String, watch::Receiver<()>> = DashMap::new();
    static ref WRITE_LOCKS: DashMap<String, ()> = DashMap::new();
}

struct CachedObjectStore {
    pub store: Arc<dyn ObjectStore>,
    pub cached_at: Instant,
}

lazy_static::lazy_static! {
    static ref CACHED_OBJECT_STORE: Mutex<Option<CachedObjectStore>> = Mutex::new(None);
}

async fn build_object_store() -> Result<Arc<dyn ObjectStore>, object_store::Error> {
    let mut cached_object_store = CACHED_OBJECT_STORE.lock().await;
    if let Some(object_store) = cached_object_store.as_ref() {
        if object_store.cached_at.elapsed().as_secs() < 60 {
            return Ok(object_store.store.clone());
        }
    }

    let object_store = block_in_place(|| {
        AmazonS3Builder::new()
            .with_access_key_id(
                std::env::var("AWS_ACCESS_KEY_ID").expect("AWS_ACCESS_KEY_ID not set"),
            )
            .with_secret_access_key(
                std::env::var("AWS_SECRET_ACCESS_KEY").expect("AWS_SECRET_ACCESS_KEY not set"),
            )
            .with_endpoint(std::env::var("AWS_S3_ENDPOINT").expect("AWS_S3_ENDPOINT not set"))
            .with_region("auto")
            .with_bucket_name(EXTERNAL_STORAGE_BUCKET_NAME.to_string())
            .build()
            .map(|s3| Arc::new(s3) as Arc<dyn ObjectStore + 'static>)
    })?;
    *cached_object_store = Some(CachedObjectStore {
        store: object_store.clone(),
        cached_at: Instant::now(),
    });
    Ok(object_store)
}

fn build_filenames(user_spotify_id: &str) -> (String, String) {
    (
        format!("{user_spotify_id}--SPOTIFYTRACK_INTERNAL_SEPARATOR--artists.parquet"),
        format!("{user_spotify_id}--SPOTIFYTRACK_INTERNAL_SEPARATOR--tracks.parquet"),
    )
}

async fn set_data_retrieved_flag_for_user(
    conn: &DbConn,
    user_spotify_id: String,
    is_now_retrieved: bool,
) {
    conn.run(move |conn| {
        use crate::schema::users;

        for _ in 0..20 {
            let query = diesel::update(users::table)
                .filter(users::dsl::spotify_id.eq(user_spotify_id.clone()));
            let res = if !is_now_retrieved {
                query
                    .set((
                        users::dsl::external_data_retrieved.eq(is_now_retrieved),
                        users::dsl::last_external_data_store.eq(diesel::dsl::now),
                    ))
                    .execute(conn)
            } else {
                query
                    .set(users::dsl::external_data_retrieved.eq(is_now_retrieved))
                    .execute(conn)
            };
            match res {
                Ok(_) => {
                    info!(
                        "Successfully updated users table to indicate that retrieval is complete \
                         for user {user_spotify_id}"
                    );
                    return;
                },
                Err(err) => {
                    error!("Error updating users table: {err}");
                    std::thread::sleep(std::time::Duration::from_secs(1));
                },
            }
        }
        error!(
            "Failed to update users table to indicate that retrieval is complete for user \
             {user_spotify_id} after many retries; it's genuinely over."
        );
    })
    .await;
}
