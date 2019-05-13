use diesel::prelude::*;
use reqwest;

use crate::models::{NewArtistHistoryEntry, NewTrackHistoryEntry, StatsSnapshot, User};
use crate::DbConn;

const SPOTIFY_USER_STATS_URL: &str = "https://api.spotify.com/v1/me/player/recently-played";

pub fn fetch_cur_stats(
    user: &User,
    user_spotify_id: &str,
) -> Result<Option<StatsSnapshot>, String> {
    // Use the user's token to fetch their current stats
    let client = reqwest::Client::new();
    let mut res = client
        .get(SPOTIFY_USER_STATS_URL)
        .bearer_auth(&user.token)
        .send()
        .map_err(|_err| -> String {
            "Error requesting latest user stats from the Spotify API".into()
        })?;

    println!("{:?}", res.text());
    // TODO: Parse response

    Ok(None)
}

fn map_timeframe_to_timeframe_id(timeframe: &str) -> u8 {
    match timeframe {
        "short" => 0,
        "meduim" => 1,
        "long" => 2,
        _ => panic!(format!(
            "Tried to convert invalid timeframe to id: \"{}\"",
            timeframe
        )),
    }
}

/// For each track and artist timeframe, store a row in the `track_history` and `artist_history`
/// tables respectively
pub fn store_stats_snapshot(conn: DbConn, user: &User, stats: StatsSnapshot) -> Result<(), String> {
    let artist_entries: Vec<NewArtistHistoryEntry> = stats
        .artists
        .into_iter()
        .flat_map(|(artist_timeframe, artists)| {
            artists
                .into_iter()
                .enumerate()
                .map(move |(artist_ranking, artist)| NewArtistHistoryEntry {
                    user_id: user.id,
                    spotify_id: artist.spotify_id,
                    timeframe: map_timeframe_to_timeframe_id(&artist_timeframe),
                    ranking: artist_ranking as u16,
                })
        })
        .collect();

    diesel::insert_into(crate::schema::artist_history::table)
        .values(&artist_entries)
        .execute(&conn.0)
        .map_err(|err| -> String {
            println!("Error inserting row: {:?}", err);
            "Error inserting user into database".into()
        })?;

    let track_entries: Vec<NewTrackHistoryEntry> = stats
        .tracks
        .into_iter()
        .flat_map(|(track_timeframe, tracks)| {
            tracks
                .into_iter()
                .enumerate()
                .map(move |(track_ranking, track)| NewTrackHistoryEntry {
                    user_id: user.id,
                    spotify_id: track.spotify_id,
                    timeframe: map_timeframe_to_timeframe_id(&track_timeframe),
                    ranking: track_ranking as u16,
                })
        })
        .collect();

    diesel::insert_into(crate::schema::track_history::table)
        .values(&track_entries)
        .execute(&conn.0)
        .map_err(|err| -> String {
            println!("Error inserting row: {:?}", err);
            "Error inserting user into database".into()
        })?;

    Ok(())
}
