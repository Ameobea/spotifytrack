use diesel::prelude::*;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use arrow_array::{
    builder::{TimestampSecondBuilder, UInt32Builder, UInt64Builder, UInt8Builder},
    ArrayRef, RecordBatch,
};
use object_store::ObjectStore;
use parquet::{
    arrow::AsyncArrowWriter,
    basic::GzipLevel,
    file::properties::{WriterProperties, WriterVersion},
};
use tokio::io::AsyncWrite;

use crate::{
    external_storage::download::load_external_user_data,
    metrics::{
        external_user_data_export_failure_total, external_user_data_export_success_total,
        external_user_data_export_time,
    },
    models::{ArtistHistoryEntry, TrackHistoryEntry, UserHistoryEntry},
    DbConn,
};

use super::{
    build_filenames, set_data_retrieved_flag_for_user, EXTERNAL_STORAGE_ARROW_SCHEMA,
    RETRIEVE_LOCKS, WRITE_LOCKS,
};

async fn build_parquet_writer<'a>(
    buf: &'a mut Vec<u8>,
) -> Result<
    AsyncArrowWriter<impl AsyncWrite + Send + Unpin + 'a>,
    Box<dyn std::error::Error + Send + Sync + 'static>,
> {
    let props = WriterProperties::builder()
        .set_writer_version(WriterVersion::PARQUET_2_0)
        .set_compression(parquet::basic::Compression::GZIP(
            GzipLevel::try_new(8).unwrap(),
        ))
        .build();

    let schema = &EXTERNAL_STORAGE_ARROW_SCHEMA;
    let writer = AsyncArrowWriter::try_new(buf, Arc::clone(&*schema), Some(props))?;

    Ok(writer)
}

fn build_record_batch(items: Vec<UserHistoryEntry>) -> RecordBatch {
    let mut id_array_builder = UInt64Builder::with_capacity(items.len());
    let mut user_id_array_builder = UInt64Builder::with_capacity(items.len());
    let mut update_time_array_builder = TimestampSecondBuilder::with_capacity(items.len());
    let mut mapped_spotify_id_array_builder = UInt32Builder::with_capacity(items.len());
    let mut timeframe_array_builder = UInt8Builder::with_capacity(items.len());
    let mut ranking_array_builder = UInt8Builder::with_capacity(items.len());

    for item in items {
        id_array_builder.append_value(item.id as u64);
        user_id_array_builder.append_value(item.user_id as u64);
        update_time_array_builder.append_value(item.update_time.and_utc().timestamp());
        mapped_spotify_id_array_builder.append_value(item.mapped_spotify_id as u32);
        timeframe_array_builder.append_value(item.timeframe as u8);
        ranking_array_builder.append_value(item.ranking as u8);
    }

    let id_array = id_array_builder.finish();
    let user_id_array = user_id_array_builder.finish();
    let update_time_array = update_time_array_builder.finish();
    let mapped_spotify_id_array = mapped_spotify_id_array_builder.finish();
    let timeframe_array = timeframe_array_builder.finish();
    let ranking_array = ranking_array_builder.finish();

    let schema = Arc::clone(&*EXTERNAL_STORAGE_ARROW_SCHEMA);
    let columns = vec![
        Arc::new(id_array) as ArrayRef,
        Arc::new(user_id_array) as ArrayRef,
        Arc::new(update_time_array) as ArrayRef,
        Arc::new(mapped_spotify_id_array) as ArrayRef,
        Arc::new(timeframe_array) as ArrayRef,
        Arc::new(ranking_array) as ArrayRef,
    ];
    RecordBatch::try_new(schema, columns).unwrap()
}

async fn store_external_user_data_inner(
    conn: &DbConn,
    user_spotify_id: String,
    extra_artist_entries: Vec<ArtistHistoryEntry>,
    extra_track_entries: Vec<TrackHistoryEntry>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let (artists_filename, tracks_filename) = build_filenames(&user_spotify_id);

    info!(
        "Fetching all local artist data for user {}...",
        user_spotify_id
    );
    let user_spotify_id_clone = user_spotify_id.clone();
    let mut artist_stats_for_user: Vec<UserHistoryEntry> = conn
        .run(move |conn| {
            use crate::schema::{artist_rank_snapshots, users};

            let mut last_err = None;
            for _ in 0..8 {
                match artist_rank_snapshots::table
                    .inner_join(users::table)
                    .filter(users::dsl::spotify_id.eq(user_spotify_id_clone.clone()))
                    .select(artist_rank_snapshots::all_columns)
                    .load::<UserHistoryEntry>(conn)
                {
                    Ok(rows) => return Ok(rows),
                    Err(err) => {
                        error!("Error loading artist rank snapshots: {}", err);
                        last_err = Some(err);
                        std::thread::sleep(std::time::Duration::from_secs(1));
                    },
                }
            }
            let err = last_err.unwrap();
            error!("Error loading artist rank snapshots after retries: {}", err);
            Err(err)
        })
        .await?;
    let local_artist_entry_count = artist_stats_for_user.len();
    let extra_artist_entry_count = extra_artist_entries.len();
    artist_stats_for_user.extend(extra_artist_entries.into_iter().map(Into::into));
    info!(
        "Successfully fetched all local artist data for user {}. Starting upload to external \
         storage...",
        user_spotify_id
    );

    let mut artists_data_buf = Vec::new();
    let mut artists_writer = build_parquet_writer(&mut artists_data_buf)
        .await
        .inspect_err(|err| {
            error!("Error building parquet writer: {}", err);
        })?;
    let artists_record_batch = build_record_batch(artist_stats_for_user);
    artists_writer
        .write(&artists_record_batch)
        .await
        .inspect_err(|err| {
            error!("Error writing artist data to parquet: {}", err);
        })?;
    artists_writer.close().await.inspect_err(|err| {
        error!("Error closing parquet writer: {}", err);
    })?;
    info!(
        "Successfully encoded all {local_artist_entry_count} local + {extra_artist_entry_count} \
         extra track data for user {user_spotify_id}. Starting upload to external storage at \
         {artists_filename}...",
    );
    let object_store = super::build_object_store().await?;
    let location: object_store::path::Path = artists_filename.into();
    let mut upload_attempts = 0usize;
    loop {
        match tokio::time::timeout(
            Duration::from_secs(30),
            object_store.put(&location, artists_data_buf.clone().into()),
        )
        .await
        {
            Ok(Ok(_)) => break,
            Err(err) => {
                error!("Timeout uploading artist data to external storage");
                if upload_attempts >= 8 {
                    return Err(err.into());
                }
            },
            Ok(Err(err)) => {
                error!("Error uploading artist data to external storage: {}", err);
                if upload_attempts >= 8 {
                    return Err(err.into());
                }
            },
        }
        upload_attempts += 1;
    }
    info!(
        "Successfully uploaded all {local_artist_entry_count} local + {extra_artist_entry_count} \
         extra artist data for user {user_spotify_id}",
    );

    info!(
        "Fetching all local track data for user {}...",
        user_spotify_id
    );
    let user_spotify_id_clone = user_spotify_id.clone();
    let mut track_stats_for_user: Vec<UserHistoryEntry> = conn
        .run(move |conn| {
            use crate::schema::{track_rank_snapshots, users};

            let mut last_err = None;
            for _ in 0..8 {
                match track_rank_snapshots::table
                    .inner_join(users::table)
                    .filter(users::dsl::spotify_id.eq(user_spotify_id_clone.clone()))
                    .select(track_rank_snapshots::all_columns)
                    .load::<UserHistoryEntry>(conn)
                {
                    Ok(rows) => return Ok(rows),
                    Err(err) => {
                        error!("Error loading track rank snapshots: {}", err);
                        last_err = Some(err);
                        std::thread::sleep(std::time::Duration::from_secs(1));
                    },
                }
            }
            let err = last_err.unwrap();
            error!("Error loading track rank snapshots after retries: {}", err);
            Err(err)
        })
        .await?;
    let local_track_entry_count = track_stats_for_user.len();
    let extra_track_entry_count = extra_track_entries.len();
    track_stats_for_user.extend(extra_track_entries.into_iter().map(Into::into));
    info!(
        "Successfully fetched all local track data for user {user_spotify_id}; Starting upload to \
         external storage...",
    );

    let mut tracks_data_buf = Vec::new();
    let mut tracks_writer = build_parquet_writer(&mut tracks_data_buf)
        .await
        .inspect_err(|err| {
            error!("Error building parquet writer: {}", err);
        })?;
    let tracks_record_batch = build_record_batch(track_stats_for_user);
    tracks_writer
        .write(&tracks_record_batch)
        .await
        .inspect_err(|err| {
            error!("Error writing track data to parquet: {}", err);
        })?;
    tracks_writer.close().await.inspect_err(|err| {
        error!("Error closing parquet writer: {}", err);
    })?;
    info!(
        "Successfully encoded all {local_track_entry_count} local + {extra_track_entry_count} \
         extra track data for user {user_spotify_id}. Starting upload to external storage at \
         {tracks_filename}...",
    );
    let object_store = super::build_object_store().await?;
    let location: object_store::path::Path = tracks_filename.into();
    let mut upload_attempts = 0usize;
    loop {
        match tokio::time::timeout(
            Duration::from_secs(30),
            object_store.put(&location, tracks_data_buf.clone().into()),
        )
        .await
        {
            Ok(Ok(_)) => break,
            Err(err) => {
                error!("Timeout uploading track data to external storage");
                if upload_attempts >= 8 {
                    return Err(err.into());
                }
            },
            Ok(Err(err)) => {
                error!("Error uploading track data to external storage: {}", err);
                if upload_attempts >= 8 {
                    return Err(err.into());
                }
            },
        }
        upload_attempts += 1;
    }
    info!(
        "Successfully uploaded all {local_track_entry_count} local + {extra_track_entry_count} \
         extra track data for user {user_spotify_id}",
    );

    info!(
        "Successfully uploaded all {} artist data and all {} track data for user {user_spotify_id}",
        local_artist_entry_count + extra_artist_entry_count,
        local_track_entry_count + extra_track_entry_count,
    );

    Ok(())
}

pub(crate) async fn store_external_user_data(conn: &DbConn, user_spotify_id: String) {
    let lock_exists = WRITE_LOCKS.insert(user_spotify_id.clone(), ()).is_some();
    if lock_exists {
        warn!(
            "Write lock already exists for user {}, skipping...",
            user_spotify_id
        );
        return;
    }

    // If we're super unlucky and there's currently a read operation ongoing for this user, wait
    // for it to finish first.  We'll hold the write lock while we wait.
    while RETRIEVE_LOCKS.contains_key(&user_spotify_id) {
        warn!(
            "Waiting for read lock to be released for user {} before writing...",
            user_spotify_id
        );
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    // To start, we first do a full retrieve for the user so that we can merge any existing external
    // data with the local data before writing it out.
    //
    // We're already holding the write lock, so no other reads or writes can happen for this user
    info!(
        "Starting full retrieval for user {} before writing...",
        user_spotify_id
    );

    let mut start = Instant::now();
    let (existing_external_artist_entries, existing_external_track_entries) =
        match load_external_user_data(user_spotify_id.clone()).await {
            Ok((artists, tracks)) => (artists, tracks),
            Err(err) => {
                error!(
                    "Error loading existing external data for user {}: {}",
                    user_spotify_id, err
                );
                return;
            },
        };
    info!(
        "Finished full retrieval for user {} before writing; pulled {} external artist entries \
         and {} external track entries",
        user_spotify_id,
        existing_external_artist_entries.len(),
        existing_external_track_entries.len()
    );

    info!("Starting external data upload for user {}", user_spotify_id);
    for _ in 0..10 {
        let user_spotify_id = user_spotify_id.clone();
        let res = store_external_user_data_inner(
            conn,
            user_spotify_id.clone(),
            existing_external_artist_entries.clone(),
            existing_external_track_entries.clone(),
        )
        .await;
        match res {
            Ok(()) => {
                external_user_data_export_success_total().inc();
                external_user_data_export_time().observe(start.elapsed().as_nanos() as u64);
                info!("Finished external data upload for user {}", user_spotify_id);

                // Update users table to indicate that upload is complete
                set_data_retrieved_flag_for_user(conn, user_spotify_id.clone(), false).await;

                // Actually delete the local data
                if let Err(err) = delete_local_user_data(conn, user_spotify_id.clone()).await {
                    error!(
                        "Error deleting local data for user {}: {}",
                        user_spotify_id, err
                    );
                }

                break;
            },
            Err(e) => {
                external_user_data_export_failure_total().inc();
                error!("Error storing data for user {}: {}", user_spotify_id, e);
                start = Instant::now();
            },
        }
    }

    WRITE_LOCKS.remove(&user_spotify_id);
}

async fn delete_local_user_data(conn: &DbConn, user_spotify_id: String) -> QueryResult<()> {
    let user_spotify_id_clone = user_spotify_id.clone();
    info!("Deleting local data for user {user_spotify_id} after upload to cold storage...");
    let fut = conn.run(move |conn| -> QueryResult<()> {
        use crate::schema::{artist_rank_snapshots, track_rank_snapshots, users};

        let user_internal_id = users::table
            .filter(users::dsl::spotify_id.eq(user_spotify_id.clone()))
            .select(users::dsl::id)
            .first::<i64>(conn)?;

        let mut total_deleted_artist_entry_count = 0usize;
        loop {
            // Delete in batches to try to avoid deadlocks and other issues with the table since
            // this is a huge, busy table with lots of reads and writes all the time
            let ids_to_delete = artist_rank_snapshots::table
                .filter(artist_rank_snapshots::dsl::user_id.eq(user_internal_id))
                .select(artist_rank_snapshots::dsl::id)
                .limit(500)
                .load::<i64>(conn)?;
            if ids_to_delete.is_empty() {
                break;
            }

            match diesel::delete(
                artist_rank_snapshots::table
                    .filter(artist_rank_snapshots::dsl::id.eq_any(ids_to_delete)),
            )
            .execute(conn)
            {
                Ok(deleted_artist_entry_count) =>
                    total_deleted_artist_entry_count += deleted_artist_entry_count,
                Err(err) => error!(
                    "Error deleting local artist data for user {} after upload to cold storage: {}",
                    user_spotify_id, err
                ),
            }
        }
        info!(
            "Deleted {total_deleted_artist_entry_count} local artist data entries for user {} \
             after upload to cold storage",
            user_spotify_id
        );

        let mut total_deleted_track_entry_count = 0usize;
        loop {
            // Delete in batches to try to avoid deadlocks and other issues with the table since
            // this is a huge, busy table with lots of reads and writes all the time
            let ids_to_delete = track_rank_snapshots::table
                .filter(track_rank_snapshots::dsl::user_id.eq(user_internal_id))
                .select(track_rank_snapshots::dsl::id)
                .limit(500)
                .load::<i64>(conn)?;
            if ids_to_delete.is_empty() {
                break;
            }

            match diesel::delete(
                track_rank_snapshots::table
                    .filter(track_rank_snapshots::dsl::id.eq_any(ids_to_delete)),
            )
            .execute(conn)
            {
                Ok(deleted_track_entry_count) =>
                    total_deleted_track_entry_count += deleted_track_entry_count,
                Err(err) => error!(
                    "Error deleting local track data for user {} after upload to cold storage: {}",
                    user_spotify_id, err
                ),
            }
        }
        info!(
            "Deleted {total_deleted_track_entry_count} local track data entries for user {} after \
             upload to cold storage",
            user_spotify_id
        );

        Ok(())
    });

    // Set a 10-minute timeout on the delete operation.  If it takes longer than that, something
    // is probably wrong (deadlock, etc.) and we should just give up.
    tokio::time::timeout(std::time::Duration::from_secs(600), fut)
        .await
        .map_err(move |_| {
            error!(
                "Timed out after 10 minutes while deleting local data for user {} after upload to \
                 cold storage",
                user_spotify_id_clone
            );
            diesel::result::Error::QueryBuilderError(
                "Timed out after 10 minutes while deleting local data after upload to cold storage"
                    .into(),
            )
        })?
}
