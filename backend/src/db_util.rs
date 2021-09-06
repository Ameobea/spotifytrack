use std::fmt::Debug;

use chrono::{NaiveDateTime, Utc};
use diesel::{
    mysql::{Mysql, MysqlConnection},
    prelude::*,
    query_builder::{QueryFragment, QueryId},
    query_dsl::LoadQuery,
};
use fnv::{FnvHashMap as HashMap, FnvHashSet as HashSet};
use futures::Future;
use rocket::{http::Status, response::status};
use serde::Serialize;

use crate::{
    benchmarking::{mark, start},
    cache::local_cache::{cache_id_entries, get_cached_internal_ids_by_spotify_id},
    models::{
        Artist, ArtistGenrePair, ArtistRankHistoryResItem, HasSpotifyId, NewRelatedArtistEntry,
        NewSpotifyIdMapping, SpotifyIdMapping, StatsHistoryQueryResItem, TimeFrames, Track,
        TrackArtistPair, User,
    },
    DbConn,
};

pub(crate) async fn get_user_by_spotify_id(
    conn: &DbConn,
    supplied_spotify_id: String,
) -> Result<Option<User>, String> {
    use crate::schema::users::dsl::*;

    conn.run(move |conn| {
        diesel_not_found_to_none(
            users
                .filter(spotify_id.eq(&supplied_spotify_id))
                .first::<User>(conn),
        )
    })
    .await
}

pub(crate) fn stringify_diesel_err(err: diesel::result::Error) -> String {
    error!("Error querying database: {:?}", err);
    String::from("Error querying database")
}

pub(crate) fn diesel_not_found_to_none<T>(
    res: Result<T, diesel::result::Error>,
) -> Result<Option<T>, String> {
    match res {
        Err(diesel::result::Error::NotFound) => Ok(None),
        Err(err) => Err(stringify_diesel_err(err)),
        Ok(res) => Ok(Some(res)),
    }
}

#[derive(Queryable)]
struct StatsQueryResultItem {
    timeframe: u8,
    spotify_id: String,
}

/// Returns the top artists for the last update for the given user.  Items are returned as
/// `(timeframe_id, artist)`.
pub(crate) async fn get_artist_stats(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
) -> Result<Option<Vec<(u8, Artist)>>, String> {
    use crate::schema::{
        artist_rank_snapshots::{self, dsl::*},
        spotify_items::{self, dsl::*},
    };

    let tok = start();
    let query = artist_rank_snapshots
        .filter(user_id.eq(user.id))
        .select(update_time)
        .order_by(update_time.desc());
    let last_update_time: Option<NaiveDateTime> = conn
        .run(move |conn| query.first(conn).optional())
        .await
        .map_err(stringify_diesel_err)?;
    let last_update_time = match last_update_time {
        Some(last_update_time) => last_update_time,
        None => return Ok(None),
    };

    let query = artist_rank_snapshots
        .filter(user_id.eq(user.id))
        .filter(update_time.eq(last_update_time))
        .inner_join(spotify_items)
        .select((artist_rank_snapshots::timeframe, spotify_items::spotify_id));
    let artist_stats = conn
        .run(move |conn| query.load::<StatsQueryResultItem>(conn))
        .await
        .map_err(stringify_diesel_err)?;
    mark(tok, "Got artist stats from database");

    if artist_stats.is_empty() {
        return Ok(None);
    }

    let tok = start();
    let artist_spotify_ids: Vec<&str> = artist_stats
        .iter()
        .map(|entry| entry.spotify_id.as_str())
        .collect();
    let fetched_artists =
        crate::spotify_api::fetch_artists(spotify_access_token, &artist_spotify_ids)
            .await?
            .into_iter()
            .enumerate()
            .map(|(i, artist)| {
                let timeframe_id = artist_stats[i].timeframe;
                (timeframe_id, artist)
            })
            .collect::<Vec<_>>();
    mark(tok, "Got artist metadata");
    Ok(Some(fetched_artists))
}

pub(crate) async fn get_artist_rank_history_single_artist(
    user: &User,
    conn: DbConn,
    artist_spotify_id: String,
) -> Result<Option<Vec<(NaiveDateTime, [Option<u8>; 3])>>, String> {
    use crate::schema::{artist_rank_snapshots::dsl::*, spotify_items::dsl::*};

    let query = artist_rank_snapshots
        .filter(user_id.eq(user.id))
        .inner_join(spotify_items)
        .filter(spotify_id.eq(artist_spotify_id))
        .order_by(update_time.asc())
        .select((update_time, ranking, timeframe));
    debug!(
        "{:?}",
        diesel::debug_query::<diesel::mysql::Mysql, _>(&query)
    );
    let res = match conn
        .run(move |conn| diesel_not_found_to_none(query.load::<ArtistRankHistoryResItem>(conn)))
        .await?
    {
        Some(res) => res,
        None => return Ok(None),
    };
    if res.is_empty() {
        return Ok(None);
    }

    let mut output: Vec<(NaiveDateTime, [Option<u8>; 3])> = Vec::new();

    let mut cur_update: (NaiveDateTime, [Option<u8>; 3]) =
        (res.first().unwrap().update_time.clone(), [None; 3]);
    for update in res {
        if update.update_time != cur_update.0 {
            output.push(std::mem::replace(
                &mut cur_update,
                (update.update_time.clone(), [None; 3]),
            ));
        }

        cur_update.1[update.timeframe as usize] = Some(update.ranking);
    }
    output.push(cur_update);

    Ok(Some(output))
}

pub(crate) fn group_updates_by_timestamp<T>(
    get_timestamp: fn(update: &T) -> NaiveDateTime,
    updates: &[T],
) -> HashMap<NaiveDateTime, Vec<&T>> {
    let mut entity_stats_by_update_timestamp: HashMap<NaiveDateTime, Vec<&T>> = HashMap::default();
    for update in updates {
        let timestamp = get_timestamp(update);
        let entries_for_update = entity_stats_by_update_timestamp
            .entry(timestamp.clone())
            .or_insert_with(Vec::new);
        entries_for_update.push(update);
    }

    entity_stats_by_update_timestamp
}

/// Generic function that handles executing a given SQL query to fetch metrics for a set of entities
/// of some type. Once the metrics are fetched, it also fetches entity metadata for all of the
/// fetched updates and returns them as a mapping from spotify id to entity along with the sorted +
/// grouped metrics.
///
/// The data returned by this function is useful for generating graphs on the frontend showing how
/// the rankings of different entities changes over time.
async fn get_entity_stats_history<
    T: HasSpotifyId + Debug,
    Q: RunQueryDsl<MysqlConnection>
        + QueryFragment<Mysql>
        + LoadQuery<MysqlConnection, StatsHistoryQueryResItem>
        + QueryId
        + Send
        + 'static,
    U: Serialize + Debug,
    F: Future<Output = Result<Vec<T>, String>>,
>(
    conn: DbConn,
    query: Q,
    spotify_access_token: &str,
    fetch_entities: fn(spotify_access_token: String, entity_spotify_ids: Vec<String>) -> F,
    get_update_item: fn(&StatsHistoryQueryResItem) -> U,
) -> Result<Option<(HashMap<String, T>, Vec<(NaiveDateTime, TimeFrames<U>)>)>, String> {
    debug!("{}", diesel::debug_query::<diesel::mysql::Mysql, _>(&query));
    let entity_stats_opt: Option<Vec<StatsHistoryQueryResItem>> = conn
        .run(|conn| diesel_not_found_to_none(query.load::<StatsHistoryQueryResItem>(conn)))
        .await?;

    let entity_stats: Vec<StatsHistoryQueryResItem> = match entity_stats_opt {
        None => return Ok(None),
        Some(res) => res,
    };

    let entity_spotify_ids: HashSet<&str> = entity_stats
        .iter()
        .map(|entry| entry.spotify_id.as_str())
        .collect();
    let entity_spotify_ids: Vec<String> =
        entity_spotify_ids.into_iter().map(String::from).collect();

    let fetched_tracks =
        fetch_entities(spotify_access_token.to_owned(), entity_spotify_ids).await?;
    let entities_by_id = fetched_tracks
        .into_iter()
        .fold(HashMap::default(), |mut acc, track| {
            acc.insert(track.get_spotify_id().to_string(), track);
            acc
        });

    // Group the entity stats by their update timestamp
    let entity_stats_by_update_timestamp = group_updates_by_timestamp(
        |update: &StatsHistoryQueryResItem| -> NaiveDateTime { update.update_time.clone() },
        &entity_stats,
    );

    let mut updates: Vec<(NaiveDateTime, TimeFrames<U>)> = entity_stats_by_update_timestamp
        .into_iter()
        .map(|(update_timestamp, mut entries_for_update)| {
            entries_for_update
                .sort_unstable_by_key(|track_history_entry| track_history_entry.ranking);

            let stats_for_update = entries_for_update.into_iter().fold(
                TimeFrames::default(),
                |mut acc, track_history_entry| {
                    acc.add_item_by_id(
                        track_history_entry.timeframe,
                        get_update_item(track_history_entry),
                    );
                    acc
                },
            );

            (update_timestamp, stats_for_update)
        })
        .collect();
    updates.sort_unstable_by_key(|update| update.0);

    return Ok(Some((entities_by_id, updates)));
}

pub(crate) async fn get_artist_stats_history(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
    restrict_to_timeframe_id: Option<u8>,
) -> Result<
    Option<(
        HashMap<String, Artist>,
        Vec<(NaiveDateTime, TimeFrames<String>)>,
    )>,
    String,
> {
    use crate::schema::{artist_rank_snapshots::dsl::*, spotify_items::dsl::*};

    let query = artist_rank_snapshots.filter(user_id.eq(user.id));
    if let Some(timeframe_id) = restrict_to_timeframe_id {
        let query = query
            .filter(timeframe.eq(timeframe_id))
            .inner_join(spotify_items)
            .select((spotify_id, update_time, ranking, timeframe));

        get_entity_stats_history(
            conn,
            query,
            spotify_access_token,
            |spotify_access_token: String, spotify_ids: Vec<String>| async move {
                let ref_spotify_ids: Vec<&str> = spotify_ids.iter().map(String::as_str).collect();
                let res =
                    crate::spotify_api::fetch_artists(&spotify_access_token, &ref_spotify_ids)
                        .await;
                res
            },
            |update: &StatsHistoryQueryResItem| update.spotify_id.clone(),
        )
        .await
    } else {
        let query =
            query
                .inner_join(spotify_items)
                .select((spotify_id, update_time, ranking, timeframe));

        get_entity_stats_history(
            conn,
            query,
            spotify_access_token,
            |spotify_access_token: String, spotify_ids: Vec<String>| async move {
                let ref_spotify_ids: Vec<&str> = spotify_ids.iter().map(String::as_str).collect();
                let res =
                    crate::spotify_api::fetch_artists(&spotify_access_token, &ref_spotify_ids)
                        .await;
                res
            },
            |update: &StatsHistoryQueryResItem| update.spotify_id.clone(),
        )
        .await
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct ArtistRanking {
    pub artist_spotify_id: String,
    pub ranking: u8,
}

pub(crate) async fn get_genre_stats_history(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
    target_genre: String,
) -> Result<
    Option<(
        HashMap<String, Artist>,
        Vec<(NaiveDateTime, TimeFrames<ArtistRanking>)>,
    )>,
    String,
> {
    // use crate::schema::{artist_rank_snapshots, artists_genres, spotify_items};
    //
    // let query = artist_rank_snapshots::table
    //     .filter(artist_rank_snapshots::dsl::user_id.eq(user.id))
    //     .filter(
    //         artist_rank_snapshots::dsl::mapped_spotify_id.eq_any(
    //             artists_genres::table
    //                 .filter(artists_genres::dsl::genre.eq(target_genre))
    //                 .inner_join(spotify_items::table)
    //                 .select(spotify_items::dsl::id),
    //         ),
    //     )
    //     .inner_join(spotify_items::table)
    //     .select((
    //         spotify_items::dsl::spotify_id,
    //         artist_rank_snapshots::dsl::update_time,
    //         artist_rank_snapshots::dsl::ranking,
    //         artist_rank_snapshots::dsl::timeframe,
    //     ));

    // Using a raw query here because the `STRAIGHT_JOIN` forces the MySQL query optimizer to do
    // something different which makes the query run several times faster.
    let query = diesel::sql_query(
        r#"
            SELECT STRAIGHT_JOIN
                `spotify_items`.`spotify_id`,
                `artist_rank_snapshots`.`update_time`,
                `artist_rank_snapshots`.`ranking`,
                `artist_rank_snapshots`.`timeframe`
            FROM `artist_rank_snapshots`
            INNER JOIN `spotify_items`
                ON `artist_rank_snapshots`.`mapped_spotify_id` = `spotify_items`.`id`
            WHERE `artist_rank_snapshots`.`user_id` = ?
                AND `artist_rank_snapshots`.`mapped_spotify_id` IN (
                    SELECT `spotify_items`.`id` FROM `artists_genres`
                        INNER JOIN `spotify_items`
                            ON `artists_genres`.`artist_id` = `spotify_items`.`id`
                        WHERE `artists_genres`.`genre` = ?
                )
    "#,
    )
    .bind::<diesel::sql_types::BigInt, _>(user.id)
    .bind::<diesel::sql_types::Text, _>(target_genre);

    get_entity_stats_history(
        conn,
        query,
        spotify_access_token,
        |spotify_access_token: String, spotify_ids: Vec<String>| async move {
            let ref_spotify_ids: Vec<&str> = spotify_ids.iter().map(String::as_str).collect();
            let res =
                crate::spotify_api::fetch_artists(&spotify_access_token, &ref_spotify_ids).await;
            res
        },
        |update: &StatsHistoryQueryResItem| ArtistRanking {
            artist_spotify_id: update.spotify_id.clone(),
            ranking: update.ranking,
        },
    )
    .await
}

/// Returns a list of track data items for each of the top tracks for the user's most recent update.
/// The first item of the tuple is the timeframe ID: short, medium, long.
pub(crate) async fn get_track_stats(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
) -> Result<Option<Vec<(u8, Track)>>, String> {
    use crate::schema::{spotify_items::dsl::*, track_rank_snapshots::dsl::*};

    let query = track_rank_snapshots
        .filter(user_id.eq(user.id))
        .select(update_time)
        .order_by(update_time.desc());
    let last_update_time: Option<NaiveDateTime> = conn
        .run(move |conn| query.first(conn).optional())
        .await
        .map_err(stringify_diesel_err)?;
    let last_update_time = match last_update_time {
        Some(last_update_time) => last_update_time,
        None => return Ok(None),
    };

    let query = track_rank_snapshots
        .filter(user_id.eq(user.id))
        // Only include tracks from the most recent update
        .filter(update_time.eq(last_update_time))
        .order_by(update_time)
        .inner_join(spotify_items)
        .select((timeframe, spotify_id));
    let track_stats_opt = conn
        .run(move |conn| diesel_not_found_to_none(query.load::<StatsQueryResultItem>(conn)))
        .await?;

    let track_stats = match track_stats_opt {
        None => return Ok(None),
        Some(res) => res,
    };

    let track_spotify_ids: Vec<&str> = track_stats
        .iter()
        .map(|entry| entry.spotify_id.as_str())
        .collect();
    let fetched_tracks = crate::spotify_api::fetch_tracks(spotify_access_token, &track_spotify_ids)
        .await?
        .into_iter()
        .enumerate()
        .map(|(i, track)| {
            let timeframe_id = track_stats[i].timeframe;
            (timeframe_id, track)
        })
        .collect::<Vec<_>>();
    Ok(Some(fetched_tracks))
}

/// Retrieves the top tracks for all timeframes for each update for a given user.  Rather than
/// duplicating track metadata, each timeframe simply stores the track ID and a `HashMap` is
/// returned which serves as a local lookup tool for the track metadata.
pub(crate) async fn get_track_stats_history(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
    parent_artist_id: String,
) -> Result<
    Option<(
        HashMap<String, Track>,
        Vec<(NaiveDateTime, TimeFrames<String>)>,
    )>,
    String,
> {
    use crate::schema::{
        spotify_items::{self, dsl::*},
        track_rank_snapshots::{self, dsl::*},
        tracks_artists::{self, dsl::*},
    };

    let query = spotify_items
        .filter(spotify_items::spotify_id.eq(parent_artist_id.clone()))
        .select(spotify_items::id);
    let artist_inner_id: i32 =
        conn.run(move |conn| query.first(conn))
            .await
            .map_err(|err| -> String {
                error!(
                    "Error querying inner id of artist with spotify id {:?}: {:?}",
                    parent_artist_id, err
                );
                "Error looking up parent artist".into()
            })?;

    let query = tracks_artists
        .filter(tracks_artists::artist_id.eq(artist_inner_id))
        .inner_join(
            track_rank_snapshots
                .on(track_rank_snapshots::mapped_spotify_id.eq(tracks_artists::track_id)),
        )
        .filter(user_id.eq(user.id))
        .inner_join(spotify_items.on(tracks_artists::track_id.eq(spotify_items::id)))
        .order_by(update_time)
        .select((spotify_id, update_time, ranking, timeframe));

    get_entity_stats_history(
        conn,
        query,
        spotify_access_token,
        |spotify_access_token: String, spotify_ids: Vec<String>| async move {
            let ref_spotify_ids: Vec<&str> = spotify_ids.iter().map(String::as_str).collect();
            let res =
                crate::spotify_api::fetch_tracks(&spotify_access_token, &ref_spotify_ids).await;
            res
        },
        |update: &StatsHistoryQueryResItem| update.spotify_id.clone(),
    )
    .await
}

/// Retrieves a list of the internal mapped Spotify ID for each of the provided spotify IDs,
/// inserting new entries as needed and taking care of it all behind the scenes.
pub(crate) async fn get_internal_ids_by_spotify_id<
    'a,
    T: Iterator<Item = &'a String> + Clone + Send + 'a,
>(
    conn: &DbConn,
    spotify_ids: T,
) -> Result<HashMap<String, i32>, String> {
    use crate::schema::spotify_items::dsl::*;

    let spotify_ids_v = spotify_ids.clone().collect::<Vec<_>>();
    let cached = get_cached_internal_ids_by_spotify_id(spotify_ids.cloned()).await;
    let mut mapped_ids_mapping: HashMap<String, i32> = HashMap::default();
    let mut missing_ids: Vec<String> = Vec::default();
    for (i, cached_val) in cached.into_iter().enumerate() {
        if let Some(cached_val) = cached_val {
            mapped_ids_mapping.insert(spotify_ids_v[i].clone(), cached_val);
        } else {
            missing_ids.push(spotify_ids_v[i].clone());
        }
    }
    if missing_ids.is_empty() {
        return Ok(mapped_ids_mapping);
    }

    let spotify_id_items: Vec<NewSpotifyIdMapping> = missing_ids
        .iter()
        .cloned()
        .map(|spotify_id_item| NewSpotifyIdMapping {
            spotify_id: spotify_id_item,
        })
        .collect();

    // Try to create new entries for all included spotify IDs, ignoring failures due to unique
    // constraint violations
    let query = diesel::insert_or_ignore_into(spotify_items).values(spotify_id_items);
    conn.run(move |conn| {
        query.execute(conn).map_err(|err| -> String {
            error!("Error inserting spotify ids into mapping table: {:?}", err);
            "Error inserting spotify ids into mapping table".into()
        })
    })
    .await?;

    // Retrieve the mapped spotify ids, including any inserted ones
    let query = spotify_items.filter(spotify_id.eq_any(missing_ids));
    let mapped_ids: Vec<SpotifyIdMapping> = conn
        .run(move |conn| {
            query.load(conn).map_err(|err| -> String {
                error!("Error retrieving mapped spotify ids: {:?}", err);
                "Error retrieving mapped spotify ids".into()
            })
        })
        .await?;

    cache_id_entries(
        mapped_ids
            .iter()
            .map(|mapping| (mapping.id, mapping.spotify_id.clone())),
    )
    .await;

    // Match up the orderings to that the mapped ids are in the same ordering as the provided ids
    for mapping in mapped_ids {
        mapped_ids_mapping.insert(mapping.spotify_id, mapping.id);
    }

    Ok(mapped_ids_mapping)
}

/// Using the list of all stored track spotify IDs, retrieves fresh track metadata for all of them
/// and populates the mapping table with artist-track pairs for all of them
pub(crate) async fn populate_tracks_artists_table(
    conn: &DbConn,
    spotify_access_token: &str,
) -> Result<(), String> {
    use crate::schema::{
        spotify_items::dsl::*,
        track_rank_snapshots::{self, dsl::*},
        tracks_artists::dsl::*,
    };

    #[derive(Queryable)]
    struct Ids {
        pub track_id: i32,
        pub spotify_id: String,
    }

    // Get all unique track ids in the database mapped to their corresponding spotify IDs
    let query = track_rank_snapshots
        .inner_join(spotify_items)
        .select((track_rank_snapshots::mapped_spotify_id, spotify_id))
        .distinct();
    let all_track_spotify_ids: Vec<Ids> = conn
        .run(move |conn| {
            query.load::<Ids>(conn).map_err(|err| -> String {
                error!(
                    "Unable to query distinct track spotify IDs from database: {:?}",
                    err
                );
                "Unable to query distinct track spotify IDs from database".into()
            })
        })
        .await?;
    let all_track_spotify_ids_refs = all_track_spotify_ids
        .iter()
        .map(|track_spotify_id| track_spotify_id.spotify_id.as_str())
        .collect::<Vec<&str>>();

    let mut track_spotify_id_to_internal_id_mapping = HashMap::default();
    for ids in &all_track_spotify_ids {
        track_spotify_id_to_internal_id_mapping.insert(ids.spotify_id.clone(), ids.track_id);
    }

    // Fetch track metadata for each of them
    let tracks =
        crate::spotify_api::fetch_tracks(spotify_access_token, &all_track_spotify_ids_refs).await?;

    // Map returned artist spotify ids to internal artist ids
    let artist_spotify_ids: Vec<String> = tracks
        .iter()
        .flat_map(|track| track.artists.iter().map(|artist| artist.id.clone()))
        .collect();
    let artist_internal_id_mapping =
        get_internal_ids_by_spotify_id(conn, artist_spotify_ids.iter()).await?;

    // Insert mapping items for each of the (track, artist) pairs
    let pairs: Vec<TrackArtistPair> = tracks
        .iter()
        .flat_map(|track| {
            let track_internal_id = track_spotify_id_to_internal_id_mapping[&track.id];

            track
                .artists
                .iter()
                .map(|artist| artist_internal_id_mapping[&artist.id])
                .map(move |artist_internal_id| TrackArtistPair {
                    artist_id: artist_internal_id,
                    track_id: track_internal_id,
                })
        })
        .collect();
    conn.run(move |conn| {
        diesel::insert_or_ignore_into(tracks_artists)
            .values(&pairs)
            .execute(conn)
    })
    .await
    .map_err(|err| -> String {
        error!(
            "Error inserting artist/track pairs into mapping table: {:?}",
            err
        );
        "Error inserting artist/track pairs into mapping table".into()
    })
    .map(|_| ())
}

pub(crate) async fn get_artist_spotify_ids_by_internal_id(
    conn: &DbConn,
    internal_ids: Vec<i32>,
) -> QueryResult<HashMap<i32, String>> {
    use crate::schema::spotify_items;

    #[derive(Queryable)]
    struct Ids {
        pub internal_id: i32,
        pub spotify_id: String,
    }

    let mut internal_id_by_spotify_id: HashMap<i32, String> = HashMap::default();

    for internal_ids in internal_ids.chunks(1000) {
        let query =
            spotify_items::table.filter(spotify_items::dsl::id.eq_any(internal_ids.to_owned()));
        let loaded_ids: Vec<Ids> = conn.run(move |conn| query.load(conn)).await?;
        for ids in loaded_ids {
            internal_id_by_spotify_id.insert(ids.internal_id, ids.spotify_id.clone());
        }
    }

    Ok(internal_id_by_spotify_id)
}

pub(crate) async fn populate_artists_genres_table(
    conn: &DbConn,
    spotify_access_token: &str,
) -> Result<(), String> {
    use crate::schema::{
        artist_rank_snapshots::{self, dsl::*},
        artists_genres::dsl::*,
        spotify_items::dsl::*,
    };

    #[derive(Queryable)]
    struct Ids {
        pub artist_id: i32,
        pub spotify_id: String,
    }

    // Get the full set of unique artist Spotify IDs for all stored updates
    let query = artist_rank_snapshots
        .inner_join(spotify_items)
        .select((artist_rank_snapshots::mapped_spotify_id, spotify_id))
        .distinct();
    let all_artist_ids = conn
        .run(move |conn| query.load::<Ids>(conn))
        .await
        .map_err(|err| -> String {
            error!("Error fetching all artist ids from database: {:?}", err);
            "Error fetching all artist ids from database".into()
        })?;

    let all_artist_spotify_ids = all_artist_ids
        .iter()
        .map(|ids| ids.spotify_id.as_str())
        .collect::<Vec<&str>>();

    let mut artist_internal_id_by_spotify_id: HashMap<String, i32> = HashMap::default();
    for ids in &all_artist_ids {
        artist_internal_id_by_spotify_id.insert(ids.spotify_id.clone(), ids.artist_id);
    }

    // Fetch artist metadata for each of them
    // println!("{:?}", all_artist_spotify_ids);
    let mut artists =
        crate::spotify_api::fetch_artists(spotify_access_token, &all_artist_spotify_ids).await?;
    artists.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    artists.dedup_by(|a, b| a.id == b.id);

    let pairs: Vec<ArtistGenrePair> = artists
        .into_iter()
        .filter_map(|artist| {
            let artist_internal_id: i32 = match artist_internal_id_by_spotify_id.get(&artist.id) {
                Some(&artist_internal_id) => artist_internal_id,
                None => {
                    warn!(
                        "No internal artist ID in mapping for artist with spotify id {}",
                        artist.id
                    );
                    return None;
                },
            };
            Some((artist, artist_internal_id))
        })
        .flat_map(|(artist, artist_internal_id)| {
            artist
                .genres
                .unwrap_or_else(Vec::new)
                .into_iter()
                .map(move |genre_item| ArtistGenrePair {
                    artist_id: artist_internal_id,
                    genre: genre_item,
                })
        })
        .collect();

    conn.run(move |conn| {
        conn.transaction::<_, diesel::result::Error, _>(|| {
            // Clear all existing artist/genre mapping entries
            diesel::delete(artists_genres).execute(conn)?;

            // Re-fill the table with the new ones we've created
            for pairs in pairs.chunks(500) {
                diesel::insert_into(artists_genres)
                    .values(pairs)
                    .execute(conn)?;
            }
            Ok(())
        })
    })
    .await
    .map_err(|err| -> String {
        error!(
            "Error clearing + refreshing artists/genres mapping table: {:?}",
            err
        );
        "Error clearing + refreshing artists/genres mapping table".into()
    })
    .map(|_| ())
}

/// Sets the `last_updated_time` column for the provided user to the provided `update_time`.
/// Returns the number of rows updated or an error message.
pub(crate) async fn update_user_last_updated(
    user: &User,
    conn: &DbConn,
    update_time: NaiveDateTime,
) -> Result<usize, String> {
    use crate::schema::users::dsl::*;

    let query = diesel::update(users.filter(id.eq(user.id))).set(last_update_time.eq(update_time));
    conn.run(move |conn| query.execute(conn))
        .await
        .map_err(|err| -> String {
            error!("Error updating user's last update time: {:?}", err);
            "Error updating user's last update time.".into()
        })
}

pub(crate) async fn get_artist_timeline_events(
    conn: &DbConn,
    user_id: i64,
    start_day: NaiveDateTime,
    end_day: NaiveDateTime,
) -> Result<Vec<(String, NaiveDateTime)>, diesel::result::Error> {
    use crate::schema::{artists_users_first_seen, spotify_items};

    let query = artists_users_first_seen::table
        .filter(
            artists_users_first_seen::dsl::user_id.eq(user_id).and(
                artists_users_first_seen::dsl::first_seen
                    .ge(start_day)
                    .and(artists_users_first_seen::dsl::first_seen.le(end_day)),
            ),
        )
        .order_by(artists_users_first_seen::dsl::first_seen)
        .inner_join(
            spotify_items::table
                .on(spotify_items::dsl::id.eq(artists_users_first_seen::dsl::mapped_spotify_id)),
        )
        .select((
            spotify_items::dsl::spotify_id,
            artists_users_first_seen::dsl::first_seen,
        ));
    conn.run(move |conn| query.load(conn)).await
}

pub(crate) async fn get_track_timeline_events(
    conn: &DbConn,
    user_id: i64,
    start_day: NaiveDateTime,
    end_day: NaiveDateTime,
) -> Result<Vec<(String, NaiveDateTime)>, diesel::result::Error> {
    use crate::schema::{spotify_items, tracks_users_first_seen};

    let query = tracks_users_first_seen::table
        .filter(
            tracks_users_first_seen::dsl::user_id.eq(user_id).and(
                tracks_users_first_seen::dsl::first_seen
                    .ge(start_day)
                    .and(tracks_users_first_seen::dsl::first_seen.le(end_day)),
            ),
        )
        .order_by(tracks_users_first_seen::dsl::first_seen)
        .inner_join(
            spotify_items::table
                .on(spotify_items::dsl::id.eq(tracks_users_first_seen::dsl::mapped_spotify_id)),
        )
        .select((
            spotify_items::dsl::spotify_id,
            tracks_users_first_seen::dsl::first_seen,
        ));
    conn.run(move |conn| query.load(conn)).await
}

pub(crate) async fn get_all_top_tracks_for_user(
    conn: &DbConn,
    user_id: i64,
) -> Result<Vec<(i32, String)>, diesel::result::Error> {
    use crate::schema::{spotify_items, tracks_users_first_seen};

    let query = tracks_users_first_seen::table
        .filter(tracks_users_first_seen::dsl::user_id.eq(user_id))
        .inner_join(
            spotify_items::table
                .on(spotify_items::dsl::id.eq(tracks_users_first_seen::dsl::mapped_spotify_id)),
        )
        .select((
            tracks_users_first_seen::dsl::mapped_spotify_id,
            spotify_items::dsl::spotify_id,
        ))
        .distinct();
    conn.run(move |conn| query.load(conn)).await
}

pub(crate) async fn get_all_top_artists_for_user(
    conn: &DbConn,
    user_id: i64,
) -> Result<Vec<(i32, String)>, diesel::result::Error> {
    use crate::schema::{artists_users_first_seen, spotify_items};

    let query = artists_users_first_seen::table
        .filter(artists_users_first_seen::dsl::user_id.eq(user_id))
        .inner_join(
            spotify_items::table
                .on(spotify_items::dsl::id.eq(artists_users_first_seen::dsl::mapped_spotify_id)),
        )
        .select((
            artists_users_first_seen::dsl::mapped_spotify_id,
            spotify_items::dsl::spotify_id,
        ))
        .distinct();
    conn.run(move |conn| query.load(conn)).await
}

pub(crate) async fn refresh_user_access_token(
    conn: &DbConn,
    user: &mut User,
) -> Result<Option<status::Custom<String>>, String> {
    use crate::schema::users;

    // Update the access token for that user using the refresh token
    let updated_access_token =
        match crate::spotify_api::refresh_user_token(&user.refresh_token).await {
            Ok(updated_access_token) => updated_access_token,
            Err(_) => {
                update_user_last_updated(&user, &conn, Utc::now().naive_utc()).await?;

                // TODO: Disable auto-updates for the user that has removed their permission grant
                // to prevent wasted updates in the future
                let msg = format!(
                    "Failed to refresh user token for user {}; updating last updated timestamp \
                     and not updating.",
                    user.username
                );
                info!("{}", msg);
                return Ok(Some(status::Custom(Status::Unauthorized, msg)));
            },
        };
    let query = diesel::update(users::table.filter(users::dsl::id.eq(user.id)))
        .set(users::dsl::token.eq(updated_access_token.clone()));
    conn.run(move |conn| query.execute(conn))
        .await
        .map_err(|err| -> String {
            error!("{:?}", err);
            "Error updating user with new access token".into()
        })?;
    user.token = updated_access_token;

    Ok(None)
}

pub(crate) async fn insert_related_artists(
    conn: &DbConn,
    related_artists: Vec<NewRelatedArtistEntry>,
) -> QueryResult<()> {
    use crate::schema::related_artists;

    let all_artist_ids: Vec<i32> = related_artists
        .iter()
        .map(|entry| entry.artist_spotify_id)
        .collect();

    conn.run(move |conn| {
        conn.transaction(|| -> QueryResult<()> {
            diesel::delete(
                related_artists::table
                    .filter(related_artists::dsl::artist_spotify_id.eq_any(all_artist_ids)),
            )
            .execute(conn)?;

            diesel::insert_into(related_artists::table)
                .values(related_artists)
                .execute(conn)?;

            Ok(())
        })
    })
    .await?;

    Ok(())
}
