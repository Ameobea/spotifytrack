use chrono::NaiveDateTime;
use diesel::prelude::*;
use hashbrown::{HashMap, HashSet};

use crate::benchmarking::mark;
use crate::models::{
    Artist, NewSpotifyIdMapping, SpotifyIdMapping, TimeFrames, Track, TrackArtistPair, User,
};
use crate::DbConn;

pub fn get_user_by_spotify_id(
    conn: &DbConn,
    supplied_spotify_id: &str,
) -> Result<Option<User>, String> {
    use crate::schema::users::dsl::*;

    diesel_not_found_to_none(
        users
            .filter(spotify_id.eq(&supplied_spotify_id))
            .first::<User>(&conn.0),
    )
}

pub fn diesel_not_found_to_none<T>(
    res: Result<T, diesel::result::Error>,
) -> Result<Option<T>, String> {
    match res {
        Err(diesel::result::Error::NotFound) => Ok(None),
        Err(err) => {
            error!("Error querying user from database: {:?}", err);
            Err("Error querying database for user.".into())
        }
        Ok(res) => Ok(Some(res)),
    }
}

#[derive(Queryable)]
struct StatsQueryResultItem {
    timeframe: u8,
    spotify_id: String,
}

/// Returns the top artists for the last update for the given user.  Items are returned as `(timeframe_id, artist)`.
pub fn get_artist_stats(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
) -> Result<Option<Vec<(u8, Artist)>>, String> {
    use crate::schema::artist_rank_snapshots::{self, dsl::*};
    use crate::schema::spotify_items::{self, dsl::*};

    let artists_stats_opt = diesel_not_found_to_none(
        artist_rank_snapshots
            .filter(user_id.eq(user.id))
            .filter(update_time.eq(user.last_update_time))
            .order_by(update_time)
            .inner_join(spotify_items)
            .select((artist_rank_snapshots::timeframe, spotify_items::spotify_id))
            .load::<StatsQueryResultItem>(&conn.0),
    )?;
    mark("Got artist stats from database");

    let artist_stats = match artists_stats_opt {
        None => return Ok(None),
        Some(res) => res,
    };

    let artist_spotify_ids: Vec<&str> = artist_stats
        .iter()
        .map(|entry| entry.spotify_id.as_str())
        .collect();
    let fetched_artists =
        crate::spotify_api::fetch_artists(spotify_access_token, &artist_spotify_ids)?
            .into_iter()
            .enumerate()
            .map(|(i, artist)| {
                let timeframe_id = artist_stats[i].timeframe;
                (timeframe_id, artist)
            })
            .collect::<Vec<_>>();
    mark("Got artist metadata");
    Ok(Some(fetched_artists))
}

#[derive(Queryable)]
struct StatsHistoryQueryResItem {
    spotify_id: String,
    update_time: NaiveDateTime,
    ranking: u16,
    timeframe: u8,
}

#[derive(Queryable)]
struct ArtistRankHistoryResItem {
    update_time: NaiveDateTime,
    ranking: u16,
    timeframe: u8,
}

pub fn get_artist_rank_history_single_artist(
    user: &User,
    conn: DbConn,
    artist_spotify_id: &str,
) -> Result<Option<Vec<(NaiveDateTime, [Option<u16>; 3])>>, String> {
    use crate::schema::artist_rank_snapshots::dsl::*;
    use crate::schema::spotify_items::dsl::*;

    let query = artist_rank_snapshots
        .filter(user_id.eq(user.id))
        .inner_join(spotify_items)
        .filter(spotify_id.eq(artist_spotify_id))
        .order_by(update_time.asc())
        .select((update_time, ranking, timeframe));
    // debug!(
    //     "{:?}",
    //     diesel::debug_query::<diesel::mysql::Mysql, _>(&query)
    // );
    let res = match diesel_not_found_to_none(query.load::<ArtistRankHistoryResItem>(&conn.0))? {
        Some(res) => res,
        None => return Ok(None),
    };
    if res.is_empty() {
        return Ok(None);
    }

    let mut output: Vec<(NaiveDateTime, [Option<u16>; 3])> = Vec::new();

    let mut cur_update: (NaiveDateTime, [Option<u16>; 3]) =
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

pub fn get_artist_stats_history(
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
    use crate::schema::artist_rank_snapshots::dsl::*;
    use crate::schema::spotify_items::dsl::*;

    let mut query = artist_rank_snapshots
        .filter(user_id.eq(user.id))
        .into_boxed();
    if let Some(timeframe_id) = restrict_to_timeframe_id {
        query = query.filter(timeframe.eq(timeframe_id))
    }
    let query =
        query
            .inner_join(spotify_items)
            .select((spotify_id, update_time, ranking, timeframe));
    let artists_stats_opt: Option<Vec<StatsHistoryQueryResItem>> =
        diesel_not_found_to_none(query.load::<StatsHistoryQueryResItem>(&conn.0))?;

    let artist_stats: Vec<StatsHistoryQueryResItem> = match artists_stats_opt {
        None => return Ok(None),
        Some(res) => res,
    };

    let artist_spotify_ids: HashSet<&str> = artist_stats
        .iter()
        .map(|entry| entry.spotify_id.as_str())
        .collect();
    let artist_spotify_ids: Vec<&str> = artist_spotify_ids.into_iter().collect();

    let fetched_artists =
        crate::spotify_api::fetch_artists(spotify_access_token, &artist_spotify_ids)?;
    let artists_by_id = fetched_artists
        .into_iter()
        .fold(HashMap::new(), |mut acc, artist| {
            acc.insert(artist.id.clone(), artist);
            acc
        });

    // Group the artist stats by their update timestamp
    let mut artist_stats_by_update_timestamp: HashMap<
        NaiveDateTime,
        Vec<&StatsHistoryQueryResItem>,
    > = HashMap::new();
    for history_entry in &artist_stats {
        let entries_for_update = artist_stats_by_update_timestamp
            .entry(history_entry.update_time.clone())
            .or_insert_with(Vec::new);
        entries_for_update.push(history_entry);
    }

    let mut updates: Vec<(NaiveDateTime, TimeFrames<String>)> = artist_stats_by_update_timestamp
        .into_iter()
        .map(|(update_timestamp, mut entries_for_update)| {
            entries_for_update.sort_unstable_by_key(|artist_rank_snapshots_entry| {
                artist_rank_snapshots_entry.ranking
            });

            let stats_for_update = entries_for_update.into_iter().fold(
                TimeFrames::default(),
                |mut acc, artist_rank_snapshots_entry| {
                    let timeframe_id = artist_rank_snapshots_entry.timeframe;

                    acc.add_item_by_id(
                        timeframe_id,
                        artist_rank_snapshots_entry.spotify_id.clone(),
                    );
                    acc
                },
            );

            (update_timestamp, stats_for_update)
        })
        .collect();
    updates.sort_unstable_by_key(|update| update.0);

    return Ok(Some((artists_by_id, updates)));
}

/// Returns a list of track data items for each of the top tracks for the user's most recent update.  The first item
/// of the tuple is the timeframe ID: short, medium, long.
pub fn get_track_stats(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
) -> Result<Option<Vec<(u8, Track)>>, String> {
    use crate::schema::spotify_items::dsl::*;
    use crate::schema::track_rank_snapshots::dsl::*;

    let track_stats_opt = diesel_not_found_to_none(
        track_rank_snapshots
            .filter(user_id.eq(user.id))
            // Only include tracks from the most recent update
            .filter(update_time.eq(user.last_update_time))
            .order_by(update_time)
            .inner_join(spotify_items)
            .select((timeframe, spotify_id))
            .load::<StatsQueryResultItem>(&conn.0),
    )?;

    let track_stats = match track_stats_opt {
        None => return Ok(None),
        Some(res) => res,
    };

    let track_spotify_ids: Vec<&str> = track_stats
        .iter()
        .map(|entry| entry.spotify_id.as_str())
        .collect();
    let fetched_tracks =
        crate::spotify_api::fetch_tracks(spotify_access_token, &track_spotify_ids)?
            .into_iter()
            .enumerate()
            .map(|(i, track)| {
                let timeframe_id = track_stats[i].timeframe;
                (timeframe_id, track)
            })
            .collect::<Vec<_>>();
    Ok(Some(fetched_tracks))
}

/// Retrieves the top tracks for all timeframes for each update for a given user.  Rather than duplicating track metadata,
/// each timeframe simply stores the track ID and a `HashMap` is returned which serves as a local lookup tool for the track metadata.
///
/// TODO: Deduplicate with `get_artist_stats_history` if you ever care enough
pub fn get_track_stats_history(
    user: &User,
    conn: DbConn,
    spotify_access_token: &str,
    parent_artist_id: &str,
) -> Result<
    Option<(
        HashMap<String, Track>,
        Vec<(NaiveDateTime, TimeFrames<String>)>,
    )>,
    String,
> {
    use crate::schema::spotify_items::{self, dsl::*};
    use crate::schema::track_rank_snapshots::{self, dsl::*};
    use crate::schema::tracks_artists::{self, dsl::*};

    let artist_inner_id: i32 = spotify_items
        .filter(spotify_items::spotify_id.eq(parent_artist_id))
        .select(spotify_items::id)
        .first(&conn.0)
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
    info!("{}", diesel::debug_query::<diesel::mysql::Mysql, _>(&query));
    let track_stats_opt: Option<Vec<StatsHistoryQueryResItem>> =
        diesel_not_found_to_none(query.load::<StatsHistoryQueryResItem>(&conn.0))?;

    let track_stats: Vec<StatsHistoryQueryResItem> = match track_stats_opt {
        None => return Ok(None),
        Some(res) => res,
    };

    let track_spotify_ids: HashSet<&str> = track_stats
        .iter()
        .map(|entry| entry.spotify_id.as_str())
        .collect();
    let track_spotify_ids: Vec<&str> = track_spotify_ids.into_iter().collect();

    let fetched_tracks =
        crate::spotify_api::fetch_tracks(spotify_access_token, &track_spotify_ids)?;
    let tracks_by_id = fetched_tracks
        .into_iter()
        .fold(HashMap::new(), |mut acc, track| {
            acc.insert(track.id.clone(), track);
            acc
        });

    // Group the track stats by their update timestamp
    let mut track_stats_by_update_timestamp: HashMap<
        NaiveDateTime,
        Vec<&StatsHistoryQueryResItem>,
    > = HashMap::new();
    for history_entry in &track_stats {
        let entries_for_update = track_stats_by_update_timestamp
            .entry(history_entry.update_time.clone())
            .or_insert_with(Vec::new);
        entries_for_update.push(history_entry);
    }

    let updates: Vec<(NaiveDateTime, TimeFrames<String>)> = track_stats_by_update_timestamp
        .into_iter()
        .map(|(update_timestamp, mut entries_for_update)| {
            entries_for_update.sort_unstable_by_key(|track_rank_snapshots_entry| {
                track_rank_snapshots_entry.ranking
            });

            let stats_for_update = entries_for_update.into_iter().enumerate().fold(
                TimeFrames::default(),
                |mut acc, (i, track_rank_snapshots_entry)| {
                    let timeframe_id = track_stats[i].timeframe;

                    acc.add_item_by_id(timeframe_id, track_rank_snapshots_entry.spotify_id.clone());
                    acc
                },
            );

            (update_timestamp, stats_for_update)
        })
        .collect();

    return Ok(Some((tracks_by_id, updates)));
}

/// Retrieves a list of the internal mapped Spotify ID for each of the provided spotify IDs,
/// inserting new entries as needed and taking care of it all behind the scenes.
pub fn retrieve_mapped_spotify_ids<'a, T: Iterator<Item = &'a String> + Clone>(
    conn: &DbConn,
    spotify_ids: T,
) -> Result<HashMap<String, i32>, String> {
    use crate::schema::spotify_items::dsl::*;

    let spotify_id_items: Vec<NewSpotifyIdMapping> = spotify_ids
        .clone()
        .map(|spotify_id_item| NewSpotifyIdMapping {
            spotify_id: spotify_id_item,
        })
        .collect();

    // Try to create new entries for all included spotify IDs, ignoring failures due to unique
    // constraint violations
    diesel::insert_or_ignore_into(spotify_items)
        .values(spotify_id_items)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("Error inserting spotify ids into mapping table: {:?}", err);
            "Error inserting spotify ids into mapping table".into()
        })?;

    // Retrieve the mapped spotify ids, including any inserted ones
    let mapped_ids: Vec<SpotifyIdMapping> = spotify_items
        .filter(spotify_id.eq_any(spotify_ids))
        .load(&conn.0)
        .map_err(|err| -> String {
            error!("Error retrieving mapped spotify ids: {:?}", err);
            "Error retrieving mapped spotify ids".into()
        })?;

    // Match up the orderings to that the mapped ids are in the same ordering as the provided ids
    let mut mapped_ids_mapping: HashMap<String, i32> = HashMap::new();
    for mapping in mapped_ids {
        mapped_ids_mapping.insert(mapping.spotify_id, mapping.id);
    }

    Ok(mapped_ids_mapping)
}

/// Using the list of all stored track spotify IDs, retrieves fresh track metadata for all of them and populates
/// the mapping table with artist-track pairs for all of them
pub fn populate_tracks_artists_table(
    conn: &DbConn,
    spotify_access_token: &str,
) -> Result<(), String> {
    use crate::schema::spotify_items::dsl::*;
    use crate::schema::track_rank_snapshots::{self, dsl::*};
    use crate::schema::tracks_artists::dsl::*;

    #[derive(Queryable)]
    struct Ids {
        pub track_id: i32,
        pub spotify_id: String,
    }

    // Get all unique track ids in the database mapped to their corresponding spotify IDs
    let all_track_spotify_ids: Vec<Ids> = track_rank_snapshots
        .inner_join(spotify_items)
        .select((track_rank_snapshots::mapped_spotify_id, spotify_id))
        .distinct()
        .load::<Ids>(&conn.0)
        .map_err(|err| -> String {
            error!(
                "Unable to query distinct track spotify IDs from database: {:?}",
                err
            );
            "Unable to query distinct track spotify IDs from database".into()
        })?;
    let all_track_spotify_ids_refs = all_track_spotify_ids
        .iter()
        .map(|track_spotify_id| track_spotify_id.spotify_id.as_str())
        .collect::<Vec<&str>>();

    let mut track_spotify_id_to_internal_id_mapping = HashMap::new();
    for ids in &all_track_spotify_ids {
        track_spotify_id_to_internal_id_mapping.insert(ids.spotify_id.clone(), ids.track_id);
    }

    // Fetch track metadata for each of them
    let tracks =
        crate::spotify_api::fetch_tracks(spotify_access_token, &all_track_spotify_ids_refs)?;

    // Map returned artist spotify ids to internal artist ids
    let artist_spotify_ids: Vec<String> = tracks
        .iter()
        .flat_map(|track| track.artists.iter().map(|artist| artist.id.clone()))
        .collect();
    let artist_internal_id_mapping = retrieve_mapped_spotify_ids(conn, artist_spotify_ids.iter())?;

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
    diesel::insert_or_ignore_into(tracks_artists)
        .values(&pairs)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!(
                "Error inserting artist/track pairs into mapping table: {:?}",
                err
            );
            "Error inserting artist/track pairs into mapping table".into()
        })
        .map(|_| ())
}
