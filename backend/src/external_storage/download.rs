use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use arrow_array::{RecordBatch, TimestampSecondArray, UInt32Array, UInt64Array, UInt8Array};
use chrono::NaiveDateTime;
use diesel::{prelude::*, QueryResult};
use futures::StreamExt;
use object_store::ObjectStore;
use parquet::arrow::{
    async_reader::{ParquetObjectReader, ParquetRecordBatchStream},
    ParquetRecordBatchStreamBuilder,
};
use tokio::sync::watch;

use crate::{
    metrics::{
        external_user_data_retrieval_failure_total, external_user_data_retrieval_success_total,
        external_user_data_retrieval_time,
    },
    models::{ArtistHistoryEntry, TrackHistoryEntry},
    DbConn,
};

use super::{
    build_filenames, build_object_store, set_data_retrieved_flag_for_user, BATCH_SIZE,
    RETRIEVE_LOCKS, WRITE_LOCKS,
};

/// Returns `(artists_reader, tracks_reader)`
async fn build_parquet_readers(
    user_spotify_id: &str,
) -> Result<
    (Option<ParquetObjectReader>, Option<ParquetObjectReader>),
    Box<dyn std::error::Error + Send + Sync + 'static>,
> {
    let object_store = Arc::new(build_object_store()?) as Arc<dyn ObjectStore>;
    let object_store_clone = Arc::clone(&object_store);

    let (artists_filename, tracks_filename) = build_filenames(user_spotify_id);
    let artists_location: object_store::path::Path = artists_filename.into();
    let tracks_location: object_store::path::Path = tracks_filename.into();
    let artists_obj_meta = match object_store_clone.head(&artists_location).await {
        Ok(meta) => Some(meta),
        Err(object_store::Error::NotFound { .. }) => None,
        Err(err) => {
            error!("Error getting artists object metadata: {}", err);
            return Err(err.into());
        },
    };
    let tracks_artist_meta = match object_store_clone.head(&tracks_location).await {
        Ok(meta) => Some(meta),
        Err(object_store::Error::NotFound { .. }) => None,
        Err(err) => {
            error!("Error getting tracks object metadata: {}", err);
            return Err(err.into());
        },
    };

    let artists_reader = artists_obj_meta.map(|artists_obj_meta| {
        ParquetObjectReader::new(Arc::clone(&object_store), artists_obj_meta)
    });
    let tracks_reader = tracks_artist_meta.map(|tracks_artist_meta| {
        ParquetObjectReader::new(Arc::clone(&object_store), tracks_artist_meta)
    });
    Ok((artists_reader, tracks_reader))
}

async fn insert_artist_snapshots(
    conn: &DbConn,
    records: Vec<ArtistHistoryEntry>,
) -> QueryResult<usize> {
    conn.run(move |conn| {
        use crate::schema::artist_rank_snapshots;

        diesel::insert_or_ignore_into(artist_rank_snapshots::table)
            .values(records)
            .execute(conn)
    })
    .await
}

async fn insert_track_snapshots(
    conn: &DbConn,
    records: Vec<TrackHistoryEntry>,
) -> QueryResult<usize> {
    conn.run(move |conn| {
        use crate::schema::track_rank_snapshots;

        diesel::insert_or_ignore_into(track_rank_snapshots::table)
            .values(records)
            .execute(conn)
    })
    .await
}

fn record_batch_to_history_entries(record_batch: RecordBatch) -> Vec<ArtistHistoryEntry> {
    let id = record_batch
        .column(0)
        .as_any()
        .downcast_ref::<UInt64Array>()
        .expect("id column should be UInt64Array");
    let user_id = record_batch
        .column(1)
        .as_any()
        .downcast_ref::<UInt64Array>()
        .expect("user_id column should be UInt64Array");
    let update_time = record_batch
        .column(2)
        .as_any()
        .downcast_ref::<TimestampSecondArray>()
        .expect("update_time column should be TimestampSecondArray");
    let mapped_spotify_id = record_batch
        .column(3)
        .as_any()
        .downcast_ref::<UInt32Array>()
        .expect("mapped_spotify_id column should be UInt32Array");
    let timeframe = record_batch
        .column(4)
        .as_any()
        .downcast_ref::<UInt8Array>()
        .expect("timeframe column should be UInt8Array");
    let ranking = record_batch
        .column(5)
        .as_any()
        .downcast_ref::<UInt8Array>()
        .expect("ranking column should be UInt8Array");

    let mut artist_history_entries = Vec::with_capacity(record_batch.num_rows());
    for i in 0..record_batch.num_rows() {
        artist_history_entries.push(ArtistHistoryEntry {
            id: id.value(i) as i64,
            user_id: user_id.value(i) as i64,
            update_time: NaiveDateTime::from_timestamp_opt(update_time.value(i), 0)
                .unwrap_or_else(|| panic!("Invalid timestamp: {}", update_time.value(i))),
            mapped_spotify_id: mapped_spotify_id.value(i) as i32,
            timeframe: timeframe.value(i),
            ranking: ranking.value(i),
        });
    }

    artist_history_entries
}

async fn consume_and_insert_track_record_batches(
    mut tracks_record_batch_reader: ParquetRecordBatchStream<ParquetObjectReader>,
    conn: &DbConn,
    user_spotify_id: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let mut total_records_received = 0usize;
    let mut total_records_written_to_db = 0usize;
    'outer: while let Some(res) = tracks_record_batch_reader.next().await {
        let record_batch = match res {
            Ok(record_batch) => record_batch,
            Err(err) => {
                error!("Error reading parquet record batch: {}", err);
                return Err(err.into());
            },
        };

        let track_history_entries = record_batch_to_history_entries(record_batch);
        // ;)
        let track_history_entries: Vec<TrackHistoryEntry> =
            unsafe { std::mem::transmute(track_history_entries) };
        total_records_received += track_history_entries.len();
        let mut last_err = None;
        for _ in 0..8 {
            match insert_track_snapshots(conn, track_history_entries.clone()).await {
                Ok(count_written) => {
                    total_records_written_to_db += count_written;
                    continue 'outer;
                },
                Err(err) => {
                    error!("Error inserting track snapshots: {}", err);
                    last_err = Some(err);
                    std::thread::sleep(std::time::Duration::from_secs(1));
                },
            }
        }
        let err = last_err.unwrap();
        error!("Error inserting track snapshots after retries: {}", err);
        return Err(err.into());
    }
    info!(
        "Successfully downloaded track data for user {}; {} records received, {} records written \
         to db",
        user_spotify_id, total_records_received, total_records_written_to_db
    );
    Ok(())
}

async fn consume_and_insert_artist_record_batches(
    mut artists_record_batch_reader: ParquetRecordBatchStream<ParquetObjectReader>,
    conn: &DbConn,
    user_spotify_id: &String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let mut total_records_received = 0usize;
    let mut total_records_written_to_db = 0usize;
    'outer: while let Some(res) = artists_record_batch_reader.next().await {
        let record_batch = match res {
            Ok(record_batch) => record_batch,
            Err(err) => {
                error!("Error reading parquet record batch: {}", err);
                return Err(err.into());
            },
        };

        let artist_history_entries = record_batch_to_history_entries(record_batch);
        total_records_received += artist_history_entries.len();
        let mut last_err = None;
        for _ in 0..8 {
            match insert_artist_snapshots(conn, artist_history_entries.clone()).await {
                Ok(count_written) => {
                    total_records_written_to_db += count_written;
                    continue 'outer;
                },
                Err(err) => {
                    error!("Error inserting artist snapshots: {}", err);
                    last_err = Some(err);
                    std::thread::sleep(std::time::Duration::from_secs(1));
                },
            }
        }
        let err = last_err.unwrap();
        error!("Error inserting artist snapshots after retries: {}", err);
        return Err(err.into());
    }
    info!(
        "Successfully downloaded artist data for user {}; {} records received, {} records written \
         to db",
        user_spotify_id, total_records_received, total_records_written_to_db
    );
    Ok(())
}

/// Loads external user data from cloud storage and returns the record batches directly.  Does NOT
/// load into the database.
pub(crate) async fn load_external_user_data(
    user_spotify_id: String,
) -> Result<
    (Vec<ArtistHistoryEntry>, Vec<TrackHistoryEntry>),
    Box<dyn std::error::Error + Send + Sync + 'static>,
> {
    info!("Building parquet readers...");
    let (artists_reader_opt, tracks_reader_opt) = loop {
        match tokio::time::timeout(
            Duration::from_secs(10),
            build_parquet_readers(&user_spotify_id),
        )
        .await
        {
            Err(err) => {
                error!("Error building parquet readers: {}", err);
                continue;
            },
            Ok(res) => break res,
        };
    }
    .inspect_err(|err| {
        error!("Error building parquet reader: {}", err);
    })?;

    let mut artist_entries: Vec<ArtistHistoryEntry> = Vec::new();
    let mut track_entries: Vec<TrackHistoryEntry> = Vec::new();

    if let Some(artists_reader) = artists_reader_opt {
        let mut artists_record_batch_reader = build_record_batch_reader(artists_reader).await?;

        while let Some(res) = artists_record_batch_reader.next().await {
            let record_batch = match res {
                Ok(record_batch) => record_batch,
                Err(err) => {
                    error!("Error reading parquet record batch: {}", err);
                    return Err(err.into());
                },
            };

            let artist_history_chunk = record_batch_to_history_entries(record_batch);
            artist_entries.extend(artist_history_chunk);
        }
    }

    if let Some(tracks_reader) = tracks_reader_opt {
        let mut tracks_record_batch_reader = build_record_batch_reader(tracks_reader).await?;

        while let Some(res) = tracks_record_batch_reader.next().await {
            let record_batch = match res {
                Ok(record_batch) => record_batch,
                Err(err) => {
                    error!("Error reading parquet record batch: {}", err);
                    return Err(err.into());
                },
            };

            let track_history_chunk = record_batch_to_history_entries(record_batch);
            // ;)
            let track_history_chunk: Vec<TrackHistoryEntry> =
                unsafe { std::mem::transmute(track_history_chunk) };

            track_entries.extend(track_history_chunk);
        }
    }

    Ok((artist_entries, track_entries))
}

async fn build_record_batch_reader(
    reader: ParquetObjectReader,
) -> Result<
    ParquetRecordBatchStream<ParquetObjectReader>,
    Box<dyn std::error::Error + Send + Sync + 'static>,
> {
    let record_batch_reader_builder = ParquetRecordBatchStreamBuilder::new(reader)
        .await
        .inspect_err(|err| {
            error!(
                "Error building parquet record batch stream builder: {}",
                err
            );
        })?;
    let record_batch_reader = record_batch_reader_builder
        .with_batch_size(BATCH_SIZE)
        .build()
        .inspect_err(|err| {
            error!("Error building parquet record batch stream: {}", err);
        })?;
    Ok(record_batch_reader)
}

/// Loads external user data from cloud storage into the local database.
async fn retrieve_external_user_data_inner(
    conn: &DbConn,
    user_spotify_id: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    info!("Building parquet readers...");
    let (artists_reader_opt, tracks_reader_opt) = loop {
        match tokio::time::timeout(
            Duration::from_secs(10),
            build_parquet_readers(&user_spotify_id),
        )
        .await
        {
            Err(err) => {
                error!("Error building parquet readers: {}", err);
                continue;
            },
            Ok(res) => break res,
        };
    }
    .inspect_err(|err| {
        error!("Error building parquet reader: {}", err);
    })?;
    info!("Successfully built parquet readers");
    if let Some(artists_reader) = artists_reader_opt {
        info!(
            "Starting download of artist data for user {}...",
            user_spotify_id
        );

        let artists_record_batch_reader = build_record_batch_reader(artists_reader).await?;

        consume_and_insert_artist_record_batches(
            artists_record_batch_reader,
            conn,
            &user_spotify_id,
        )
        .await
        .inspect_err(|err| {
            error!(
                "Error consuming and inserting artist record batches: {}",
                err
            );
        })?;
        info!(
            "Successfully downloaded artist data for user {} and inserted into db",
            user_spotify_id
        );
    } else {
        warn!(
            "No artist data found for user {}; skipping artist data download",
            user_spotify_id
        );
    }

    if let Some(tracks_reader) = tracks_reader_opt {
        info!(
            "Starting download of track data for user {}...",
            user_spotify_id
        );

        let tracks_record_batch_reader = build_record_batch_reader(tracks_reader).await?;

        consume_and_insert_track_record_batches(tracks_record_batch_reader, conn, &user_spotify_id)
            .await
            .inspect_err(|err| {
                error!(
                    "Error consuming and inserting track record batches: {}",
                    err
                );
            })?;
        info!(
            "Successfully downloaded + loaded track data for user {} into local DB",
            user_spotify_id
        );
    } else {
        warn!(
            "No track data found for user {}; skipping track data download",
            user_spotify_id
        );
    }

    info!(
        "Successfully downloaded all data for user {} from external storage and loaded into local \
         DB",
        user_spotify_id
    );

    Ok(())
}

/// Retrieve user data from external storage and write it to the database.  If there is currently a
/// retrieval operation ongoing for this user, it is waited on instead.
pub(crate) async fn retrieve_external_user_data(
    conn: &DbConn,
    user_spotify_id: String,
    ignore_write_lock: bool,
) {
    let mut tx_opt = None;
    let mut rx = RETRIEVE_LOCKS
        .entry(user_spotify_id.clone())
        .or_insert_with(|| {
            let (tx, rx) = watch::channel(());
            tx_opt = Some(tx);
            rx
        })
        .value()
        .clone();

    // If we're super unlucky and there's currently a write operation ongoing for this user, wait
    // for it to finish first.  We'll hold the read lock while we wait.
    if !ignore_write_lock {
        while WRITE_LOCKS.contains_key(&user_spotify_id) {
            warn!(
                "Waiting for write lock to be released for user {} before reading...",
                user_spotify_id
            );
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    if let Some(tx) = tx_opt {
        info!("Starting retrieval for user {}", user_spotify_id);
        for _ in 0..10 {
            let user_spotify_id = user_spotify_id.clone();
            let start = Instant::now();
            let res = retrieve_external_user_data_inner(conn, user_spotify_id.clone()).await;
            match res {
                Ok(()) => {
                    external_user_data_retrieval_success_total().inc();
                    external_user_data_retrieval_time().observe(start.elapsed().as_nanos() as u64);
                    info!("Finished retrieval for user {}", user_spotify_id);
                    // Update users table to indicate that retrieval is complete
                    set_data_retrieved_flag_for_user(conn, user_spotify_id, true).await;
                    break;
                },
                Err(e) => {
                    external_user_data_retrieval_failure_total().inc();
                    error!("Error retrieving data for user {}: {}", user_spotify_id, e);
                },
            }
        }
        tx.send(()).unwrap();

        RETRIEVE_LOCKS.remove(&user_spotify_id);

        return;
    }

    let _ = rx.changed().await;
}
