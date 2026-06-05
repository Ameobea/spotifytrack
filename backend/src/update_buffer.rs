//! In-memory buffer that batches user stats updates for periodic flush to MariaDB.
//!
//! A background task drains on a timer or when the buffer crosses a size threshold; per-user
//! flush is exposed for paths that need a user's data durable before reading it back.
//! Buffer contents are lost on process restart — losing up to one flush window of snapshots is
//! an accepted trade-off. The flusher also drains on graceful shutdown.
//!
//! `*_users_first_seen` rows used to be populated by per-row BEFORE INSERT triggers; we now
//! replicate that by computing `(user_id, mapped_spotify_id) -> min(update_time)` per flush
//! batch and bulk `INSERT IGNORE`ing.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use chrono::NaiveDateTime;
use diesel::{
    prelude::*,
    result::{DatabaseErrorKind, Error as DieselError},
};
use fnv::FnvHashSet;
use rocket::tokio::{
    self,
    sync::{Mutex, Notify},
};

use crate::{
    metrics::{
        update_buffer_dropped_rows_total, update_buffer_flush_failure_total,
        update_buffer_flush_success_total, update_buffer_flush_time,
    },
    models::{ArtistGenrePair, NewArtistHistoryEntry, NewTrackHistoryEntry, TrackArtistPair},
    DbConn,
};

const FLUSH_CHUNK_SIZE: usize = 2000;
const RETRY_MAX_ELAPSED: Duration = Duration::from_secs(60);
const RETRY_INITIAL_BACKOFF: Duration = Duration::from_millis(250);
const RETRY_MAX_BACKOFF: Duration = Duration::from_secs(8);

#[derive(Default)]
struct Inner {
    artist_snapshots: Vec<NewArtistHistoryEntry>,
    track_snapshots: Vec<NewTrackHistoryEntry>,
    /// Keyed by user so a per-user flush drains only that user's pairs, not the global set.
    track_artist_pairs: HashMap<i64, HashSet<(i32, i32)>>,
    artist_genre_pairs: HashMap<i64, HashSet<(i32, String)>>,
    spotify_id_by_user_id: HashMap<i64, String>,
    /// Written at flush time rather than pre-fetch so a crash leaves the user immediately
    /// eligible for re-pick instead of waiting `MIN_UPDATE_INTERVAL_SECONDS` to age out.
    user_last_update_times: HashMap<i64, NaiveDateTime>,
}

impl Inner {
    fn pending_row_count(&self) -> usize {
        self.artist_snapshots.len()
            + self.track_snapshots.len()
            + self.track_artist_pairs.values().map(|s| s.len()).sum::<usize>()
            + self.artist_genre_pairs.values().map(|s| s.len()).sum::<usize>()
            + self.user_last_update_times.len()
    }

    fn is_empty(&self) -> bool { self.pending_row_count() == 0 }
}

pub(crate) struct UpdateBuffer {
    inner: Mutex<Inner>,
    /// Users with pushed-but-not-yet-flushed data. The cron's SELECT filters these out.
    in_flight: StdMutex<FnvHashSet<i64>>,
    /// Serializes `flush_all` against `flush_user_by_spotify_id` so a per-user caller can't
    /// silently no-op while the background flusher is mid-write on the same data.
    flush_serialize: Mutex<()>,
    flush_notify: Notify,
    max_pending_rows: usize,
}

/// RAII guard for an in-flight claim. Drop releases unless `commit()` was called, in which
/// case the next flush takes over releasing it.
pub(crate) struct InFlightUserGuard<'a> {
    buffer: &'a UpdateBuffer,
    user_id: Option<i64>,
}

impl<'a> InFlightUserGuard<'a> {
    pub(crate) fn commit(mut self) { self.user_id = None; }
}

impl<'a> Drop for InFlightUserGuard<'a> {
    fn drop(&mut self) {
        if let Some(user_id) = self.user_id.take() {
            self.buffer.release_user(user_id);
        }
    }
}

impl UpdateBuffer {
    pub(crate) fn new(max_pending_rows: usize) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            in_flight: StdMutex::new(FnvHashSet::default()),
            flush_serialize: Mutex::new(()),
            flush_notify: Notify::new(),
            max_pending_rows,
        }
    }

    /// Returned guard releases the claim on drop unless `.commit()` is called first. If
    /// `user_id` was already claimed (e.g. cron pushed and committed but the buffer hasn't
    /// flushed yet, then an explicit `/update_user?user_id=` request arrives), the guard is a
    /// no-op — it neither owns the existing claim nor releases it on drop. Otherwise a failed
    /// explicit update would release the cron's claim and let the next cron iter re-pick the
    /// user while the original batch is still pending flush.
    pub(crate) fn claim_user(&self, user_id: i64) -> InFlightUserGuard<'_> {
        let mut set = self.in_flight.lock().unwrap_or_else(|p| p.into_inner());
        let newly_inserted = set.insert(user_id);
        InFlightUserGuard {
            buffer: self,
            user_id: if newly_inserted { Some(user_id) } else { None },
        }
    }

    pub(crate) fn in_flight_user_ids(&self) -> Vec<i64> {
        self.in_flight
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .copied()
            .collect()
    }

    fn release_user(&self, user_id: i64) {
        let mut set = self.in_flight.lock().unwrap_or_else(|p| p.into_inner());
        set.remove(&user_id);
    }

    pub(crate) async fn push_user_stats(
        &self,
        user_id: i64,
        user_spotify_id: String,
        update_time: NaiveDateTime,
        artist_snapshots: Vec<NewArtistHistoryEntry>,
        track_snapshots: Vec<NewTrackHistoryEntry>,
        track_artist_pairs: Vec<TrackArtistPair>,
        artist_genre_pairs: Vec<ArtistGenrePair>,
    ) {
        let pending = {
            let mut inner = self.inner.lock().await;
            inner.spotify_id_by_user_id.insert(user_id, user_spotify_id);
            inner.user_last_update_times.insert(user_id, update_time);
            inner.artist_snapshots.extend(artist_snapshots);
            inner.track_snapshots.extend(track_snapshots);
            let user_track_pairs = inner.track_artist_pairs.entry(user_id).or_default();
            for p in track_artist_pairs {
                user_track_pairs.insert((p.track_id, p.artist_id));
            }
            let user_genre_pairs = inner.artist_genre_pairs.entry(user_id).or_default();
            for p in artist_genre_pairs {
                user_genre_pairs.insert((p.artist_id, p.genre));
            }
            inner.pending_row_count()
        };
        if pending >= self.max_pending_rows {
            self.flush_notify.notify_one();
        }
    }

    /// Drains and flushes everything for one user (snapshots, mapping pairs, `last_update_time`).
    ///
    /// `Err` means a chunk was dropped after retry exhaustion; callers must not proceed with
    /// anything that requires the user's data being fully durable (e.g. truncate-after-upload).
    pub(crate) async fn flush_user_by_spotify_id(
        &self,
        conn: &DbConn,
        spotify_id: &str,
    ) -> Result<(), String> {
        let _flush_guard = self.flush_serialize.lock().await;
        let (
            artist_snapshots,
            track_snapshots,
            track_artist_pairs,
            artist_genre_pairs,
            user_id,
            last_update_time,
        ) = {
            let mut inner = self.inner.lock().await;
            let user_id = match inner
                .spotify_id_by_user_id
                .iter()
                .find(|(_, sid)| sid.as_str() == spotify_id)
                .map(|(id, _)| *id)
            {
                // No buffered data — either never pushed, or already drained by a concurrent
                // `flush_all` (which by now has committed thanks to `flush_serialize`).
                None => return Ok(()),
                Some(id) => id,
            };
            let (artists, tracks) = extract_user(&mut inner, user_id);
            let track_artist_pairs = inner
                .track_artist_pairs
                .remove(&user_id)
                .unwrap_or_default();
            let artist_genre_pairs = inner
                .artist_genre_pairs
                .remove(&user_id)
                .unwrap_or_default();
            let last_update_time = inner.user_last_update_times.remove(&user_id);
            (
                artists,
                tracks,
                track_artist_pairs,
                artist_genre_pairs,
                user_id,
                last_update_time,
            )
        };
        info!(
            "Flushing per-user data for {spotify_id}: {} artist + {} track snapshots, {} \
             track_artist pairs, {} artist_genre pairs",
            artist_snapshots.len(),
            track_snapshots.len(),
            track_artist_pairs.len(),
            artist_genre_pairs.len()
        );
        let start = Instant::now();
        let outcomes = [
            flush_artist_snapshots(conn, artist_snapshots).await,
            flush_track_snapshots(conn, track_snapshots).await,
            flush_track_artist_pairs(conn, track_artist_pairs).await,
            flush_artist_genre_pairs(conn, artist_genre_pairs).await,
            match last_update_time {
                Some(ts) => {
                    let mut map: HashMap<i64, NaiveDateTime> = HashMap::with_capacity(1);
                    map.insert(user_id, ts);
                    flush_user_last_update_times(conn, map).await
                },
                None => true,
            },
        ];
        self.release_user(user_id);

        let any_failed = outcomes.iter().any(|ok| !*ok);
        if any_failed {
            update_buffer_flush_failure_total().inc();
        } else {
            update_buffer_flush_success_total().inc();
        }
        update_buffer_flush_time().observe(start.elapsed().as_nanos() as u64);

        if any_failed {
            Err(format!(
                "Per-user flush for {spotify_id} dropped at least one chunk after retry \
                 exhaustion; some rows are permanently lost"
            ))
        } else {
            Ok(())
        }
    }

    /// Drains and flushes the entire buffer, releasing in-flight claims at the end.
    ///
    /// `last_update_time` is updated even when a rank-snapshot chunk fails — otherwise a
    /// permanently-failing batch (e.g. genre > VARCHAR(191)) would loop forever as the cron
    /// re-picks, re-pushes, and re-fails. A misadvanced timestamp on rare drops is the lesser evil.
    pub(crate) async fn flush_all(&self, conn: &DbConn) {
        let _flush_guard = self.flush_serialize.lock().await;
        let snapshot = {
            let mut inner = self.inner.lock().await;
            std::mem::take(&mut *inner)
        };
        if snapshot.is_empty() {
            return;
        }

        let start = Instant::now();
        let total_pending = snapshot.pending_row_count();
        let track_artist_pair_total: usize =
            snapshot.track_artist_pairs.values().map(|s| s.len()).sum();
        let artist_genre_pair_total: usize =
            snapshot.artist_genre_pairs.values().map(|s| s.len()).sum();
        info!(
            "Flushing update buffer: {} artist + {} track snapshots, {} (track,artist) pairs, {} \
             (artist,genre) pairs, {} user last_update_time updates",
            snapshot.artist_snapshots.len(),
            snapshot.track_snapshots.len(),
            track_artist_pair_total,
            artist_genre_pair_total,
            snapshot.user_last_update_times.len(),
        );

        let user_ids_to_release: Vec<i64> =
            snapshot.user_last_update_times.keys().copied().collect();

        // Flatten and dedupe across users — popular artists/tracks would otherwise produce
        // the same `(track,artist)` / `(artist,genre)` pair from many users in one batch.
        let track_artist_pairs: HashSet<(i32, i32)> = snapshot
            .track_artist_pairs
            .into_values()
            .flatten()
            .collect();
        let artist_genre_pairs: HashSet<(i32, String)> = snapshot
            .artist_genre_pairs
            .into_values()
            .flatten()
            .collect();

        let outcomes = [
            flush_artist_snapshots(conn, snapshot.artist_snapshots).await,
            flush_track_snapshots(conn, snapshot.track_snapshots).await,
            flush_track_artist_pairs(conn, track_artist_pairs).await,
            flush_artist_genre_pairs(conn, artist_genre_pairs).await,
            flush_user_last_update_times(conn, snapshot.user_last_update_times).await,
        ];

        for user_id in user_ids_to_release {
            self.release_user(user_id);
        }

        let any_failed = outcomes.iter().any(|ok| !*ok);
        if any_failed {
            update_buffer_flush_failure_total().inc();
        } else {
            update_buffer_flush_success_total().inc();
        }
        update_buffer_flush_time().observe(start.elapsed().as_nanos() as u64);
        info!(
            "Flushed {} pending rows in {:?} (any_chunk_dropped={any_failed})",
            total_pending,
            start.elapsed()
        );
    }
}

fn extract_user(
    inner: &mut Inner,
    user_id: i64,
) -> (Vec<NewArtistHistoryEntry>, Vec<NewTrackHistoryEntry>) {
    let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut inner.artist_snapshots)
        .into_iter()
        .partition(|e| e.user_id == user_id);
    inner.artist_snapshots = rest;
    let artists = mine;

    let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut inner.track_snapshots)
        .into_iter()
        .partition(|e| e.user_id == user_id);
    inner.track_snapshots = rest;
    let tracks = mine;

    inner.spotify_id_by_user_id.remove(&user_id);
    (artists, tracks)
}

#[derive(Clone, Copy)]
enum ErrorKind {
    Transient,
    Permanent,
}

fn classify_error(err: &DieselError) -> ErrorKind {
    match err {
        DieselError::DatabaseError(kind, _) => match kind {
            DatabaseErrorKind::UniqueViolation
            | DatabaseErrorKind::ForeignKeyViolation
            | DatabaseErrorKind::NotNullViolation
            | DatabaseErrorKind::CheckViolation => ErrorKind::Permanent,
            // SerializationFailure = deadlock; Unknown wraps lock-wait timeouts and conn blips.
            _ => ErrorKind::Transient,
        },
        DieselError::QueryBuilderError(_)
        | DieselError::DeserializationError(_)
        | DieselError::SerializationError(_)
        | DieselError::AlreadyInTransaction
        | DieselError::NotInTransaction
        | DieselError::NotFound => ErrorKind::Permanent,
        _ => ErrorKind::Transient,
    }
}

async fn run_with_retry<F, Fut>(table_name: &'static str, mut op: F) -> Result<(), String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = QueryResult<usize>>,
{
    let start = Instant::now();
    let mut backoff = RETRY_INITIAL_BACKOFF;
    let mut attempt = 0usize;
    loop {
        attempt += 1;
        match op().await {
            Ok(_) => return Ok(()),
            Err(err) => match classify_error(&err) {
                ErrorKind::Permanent => {
                    error!(
                        "Permanent DB error flushing to {table_name} (attempt {attempt}); \
                         dropping chunk: {err}"
                    );
                    return Err(err.to_string());
                },
                ErrorKind::Transient => {
                    if start.elapsed() >= RETRY_MAX_ELAPSED {
                        error!(
                            "Gave up flushing to {table_name} after {:?} ({attempt} attempts): \
                             {err}",
                            start.elapsed()
                        );
                        return Err(err.to_string());
                    }
                    warn!(
                        "Transient DB error flushing to {table_name} (attempt {attempt}), backing \
                         off {backoff:?}: {err}"
                    );
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(RETRY_MAX_BACKOFF);
                },
            },
        }
    }
}

/// Returns `true` if every chunk made it; `false` if any chunk was dropped.
async fn flush_artist_snapshots(conn: &DbConn, entries: Vec<NewArtistHistoryEntry>) -> bool {
    if entries.is_empty() {
        return true;
    }
    let first_seen = compute_artist_first_seen(&entries);

    let mut all_ok = true;
    let chunks: Vec<Vec<NewArtistHistoryEntry>> = entries
        .chunks(FLUSH_CHUNK_SIZE)
        .map(|c| c.to_vec())
        .collect();
    for chunk in chunks {
        let row_count = chunk.len();
        let chunk = Arc::new(chunk);
        let res = run_with_retry("artist_rank_snapshots", || {
            let chunk = Arc::clone(&chunk);
            async move {
                conn.run(move |conn| {
                    diesel::insert_into(crate::schema::artist_rank_snapshots::table)
                        .values(chunk.as_ref())
                        .execute(conn)
                })
                .await
            }
        })
        .await;
        if res.is_err() {
            update_buffer_dropped_rows_total("artist_rank_snapshots").inc_by(row_count as u64);
            all_ok = false;
        }
    }

    let first_seen_ok = flush_artist_first_seen(conn, first_seen).await;
    all_ok && first_seen_ok
}

async fn flush_track_snapshots(conn: &DbConn, entries: Vec<NewTrackHistoryEntry>) -> bool {
    if entries.is_empty() {
        return true;
    }
    let first_seen = compute_track_first_seen(&entries);

    let mut all_ok = true;
    let chunks: Vec<Vec<NewTrackHistoryEntry>> = entries
        .chunks(FLUSH_CHUNK_SIZE)
        .map(|c| c.to_vec())
        .collect();
    for chunk in chunks {
        let row_count = chunk.len();
        let chunk = Arc::new(chunk);
        let res = run_with_retry("track_rank_snapshots", || {
            let chunk = Arc::clone(&chunk);
            async move {
                conn.run(move |conn| {
                    diesel::insert_into(crate::schema::track_rank_snapshots::table)
                        .values(chunk.as_ref())
                        .execute(conn)
                })
                .await
            }
        })
        .await;
        if res.is_err() {
            update_buffer_dropped_rows_total("track_rank_snapshots").inc_by(row_count as u64);
            all_ok = false;
        }
    }

    let first_seen_ok = flush_track_first_seen(conn, first_seen).await;
    all_ok && first_seen_ok
}

fn compute_artist_first_seen(
    entries: &[NewArtistHistoryEntry],
) -> HashMap<(i64, i32), NaiveDateTime> {
    let mut out: HashMap<(i64, i32), NaiveDateTime> = HashMap::with_capacity(entries.len());
    for e in entries {
        let key = (e.user_id, e.mapped_spotify_id);
        out.entry(key)
            .and_modify(|t| {
                if e.update_time < *t {
                    *t = e.update_time;
                }
            })
            .or_insert(e.update_time);
    }
    out
}

fn compute_track_first_seen(
    entries: &[NewTrackHistoryEntry],
) -> HashMap<(i64, i32), NaiveDateTime> {
    let mut out: HashMap<(i64, i32), NaiveDateTime> = HashMap::with_capacity(entries.len());
    for e in entries {
        let key = (e.user_id, e.mapped_spotify_id);
        out.entry(key)
            .and_modify(|t| {
                if e.update_time < *t {
                    *t = e.update_time;
                }
            })
            .or_insert(e.update_time);
    }
    out
}

#[derive(Clone, Insertable)]
#[diesel(table_name = crate::schema::artists_users_first_seen)]
struct ArtistFirstSeenRow {
    user_id: i64,
    mapped_spotify_id: i32,
    first_seen: NaiveDateTime,
}

#[derive(Clone, Insertable)]
#[diesel(table_name = crate::schema::tracks_users_first_seen)]
struct TrackFirstSeenRow {
    user_id: i64,
    mapped_spotify_id: i32,
    first_seen: NaiveDateTime,
}

async fn flush_artist_first_seen(
    conn: &DbConn,
    map: HashMap<(i64, i32), NaiveDateTime>,
) -> bool {
    if map.is_empty() {
        return true;
    }
    let rows: Vec<ArtistFirstSeenRow> = map
        .into_iter()
        .map(|((user_id, mapped_spotify_id), first_seen)| ArtistFirstSeenRow {
            user_id,
            mapped_spotify_id,
            first_seen,
        })
        .collect();
    let mut all_ok = true;
    for chunk in rows.chunks(FLUSH_CHUNK_SIZE) {
        let row_count = chunk.len();
        let chunk = Arc::new(chunk.to_vec());
        let res = run_with_retry("artists_users_first_seen", || {
            let chunk = Arc::clone(&chunk);
            async move {
                conn.run(move |conn| {
                    diesel::insert_or_ignore_into(crate::schema::artists_users_first_seen::table)
                        .values(chunk.as_ref())
                        .execute(conn)
                })
                .await
            }
        })
        .await;
        if res.is_err() {
            update_buffer_dropped_rows_total("artists_users_first_seen").inc_by(row_count as u64);
            all_ok = false;
        }
    }
    all_ok
}

async fn flush_track_first_seen(conn: &DbConn, map: HashMap<(i64, i32), NaiveDateTime>) -> bool {
    if map.is_empty() {
        return true;
    }
    let rows: Vec<TrackFirstSeenRow> = map
        .into_iter()
        .map(|((user_id, mapped_spotify_id), first_seen)| TrackFirstSeenRow {
            user_id,
            mapped_spotify_id,
            first_seen,
        })
        .collect();
    let mut all_ok = true;
    for chunk in rows.chunks(FLUSH_CHUNK_SIZE) {
        let row_count = chunk.len();
        let chunk = Arc::new(chunk.to_vec());
        let res = run_with_retry("tracks_users_first_seen", || {
            let chunk = Arc::clone(&chunk);
            async move {
                conn.run(move |conn| {
                    diesel::insert_or_ignore_into(crate::schema::tracks_users_first_seen::table)
                        .values(chunk.as_ref())
                        .execute(conn)
                })
                .await
            }
        })
        .await;
        if res.is_err() {
            update_buffer_dropped_rows_total("tracks_users_first_seen").inc_by(row_count as u64);
            all_ok = false;
        }
    }
    all_ok
}

async fn flush_track_artist_pairs(conn: &DbConn, pairs: HashSet<(i32, i32)>) -> bool {
    if pairs.is_empty() {
        return true;
    }
    let rows: Vec<TrackArtistPair> = pairs
        .into_iter()
        .map(|(track_id, artist_id)| TrackArtistPair {
            track_id,
            artist_id,
        })
        .collect();
    let mut all_ok = true;
    for chunk in rows.chunks(FLUSH_CHUNK_SIZE) {
        let row_count = chunk.len();
        let chunk = Arc::new(chunk.to_vec());
        let res = run_with_retry("tracks_artists", || {
            let chunk = Arc::clone(&chunk);
            async move {
                conn.run(move |conn| {
                    diesel::insert_or_ignore_into(crate::schema::tracks_artists::table)
                        .values(chunk.as_ref())
                        .execute(conn)
                })
                .await
            }
        })
        .await;
        if res.is_err() {
            update_buffer_dropped_rows_total("tracks_artists").inc_by(row_count as u64);
            all_ok = false;
        }
    }
    all_ok
}

async fn flush_user_last_update_times(
    conn: &DbConn,
    updates: HashMap<i64, NaiveDateTime>,
) -> bool {
    if updates.is_empty() {
        return true;
    }
    let count = updates.len();
    let updates: Vec<(i64, NaiveDateTime)> = updates.into_iter().collect();
    let updates = Arc::new(updates);
    let res = run_with_retry("users.last_update_time", || {
        let updates = Arc::clone(&updates);
        async move {
            conn.run(move |conn| {
                conn.transaction::<usize, DieselError, _>(|conn| {
                    let mut total = 0usize;
                    for (user_id, ts) in updates.iter() {
                        total += diesel::update(
                            crate::schema::users::table
                                .filter(crate::schema::users::dsl::id.eq(user_id)),
                        )
                        .set(crate::schema::users::dsl::last_update_time.eq(*ts))
                        .execute(conn)?;
                    }
                    Ok(total)
                })
            })
            .await
        }
    })
    .await;
    if res.is_err() {
        update_buffer_dropped_rows_total("users_last_update_time").inc_by(count as u64);
        return false;
    }
    true
}

async fn flush_artist_genre_pairs(conn: &DbConn, pairs: HashSet<(i32, String)>) -> bool {
    if pairs.is_empty() {
        return true;
    }
    let rows: Vec<ArtistGenrePair> = pairs
        .into_iter()
        .map(|(artist_id, genre)| ArtistGenrePair { artist_id, genre })
        .collect();
    let mut all_ok = true;
    for chunk in rows.chunks(FLUSH_CHUNK_SIZE) {
        let row_count = chunk.len();
        let chunk = Arc::new(chunk.to_vec());
        let res = run_with_retry("artists_genres", || {
            let chunk = Arc::clone(&chunk);
            async move {
                conn.run(move |conn| {
                    diesel::insert_or_ignore_into(crate::schema::artists_genres::table)
                        .values(chunk.as_ref())
                        .execute(conn)
                })
                .await
            }
        })
        .await;
        if res.is_err() {
            update_buffer_dropped_rows_total("artists_genres").inc_by(row_count as u64);
            all_ok = false;
        }
    }
    all_ok
}

/// Periodic flusher loop. Flushes on interval, on size-threshold notify, and once on shutdown.
pub(crate) async fn run_flusher(
    buffer: Arc<UpdateBuffer>,
    conn: DbConn,
    flush_interval: Duration,
    mut shutdown: rocket::Shutdown,
) {
    info!(
        "Update buffer flusher started: interval={:?}, max_pending_rows={}",
        flush_interval, buffer.max_pending_rows
    );

    loop {
        tokio::select! {
            _ = tokio::time::sleep(flush_interval) => {
                buffer.flush_all(&conn).await;
            }
            _ = buffer.flush_notify.notified() => {
                info!("Update buffer crossed size threshold; flushing");
                buffer.flush_all(&conn).await;
            }
            _ = &mut shutdown => {
                info!("Update buffer flusher: shutdown requested; doing final flush");
                buffer.flush_all(&conn).await;
                break;
            }
        }
    }

    info!("Update buffer flusher exited");
}
