use std::thread;

use chrono::Utc;
use crossbeam::channel;
use diesel::prelude::*;
use reqwest;

use crate::models::{
    NewArtistHistoryEntry, NewTrackHistoryEntry, StatsSnapshot, TopArtistsResponse,
    TopTracksResponse, User, UserProfile,
};
use crate::DbConn;

const SPOTIFY_USER_RECENTLY_PLAYED_URL: &str =
    "https://api.spotify.com/v1/me/player/recently-played";
const SPOTIFY_USER_PROFILE_INFO_URL: &str = "https://api.spotify.com/v1/me";
const ENTITY_FETCH_COUNT: usize = 50;

fn get_top_entities_url(entity_type: &str, timeframe: &str) -> String {
    format!(
        "https://api.spotify.com/v1/me/top/{}?limit={}&time_range={}_term",
        entity_type, ENTITY_FETCH_COUNT, timeframe
    )
}

pub fn get_user_profile_info(token: &str) -> Result<UserProfile, String> {
    let client = reqwest::Client::new();
    let mut res = client
        .get(SPOTIFY_USER_PROFILE_INFO_URL)
        .bearer_auth(token)
        .send()
        .map_err(|_err| -> String {
            "Error requesting latest user profile info from the Spotify API".into()
        })?;

    res.json().map_err(|err| -> String {
        error!(
            "Error parsing user profile info response from Spotify API: {:?}",
            err
        );
        "Error parsing user profile infor response from Spotify API".into()
    })
}

pub fn fetch_cur_stats(user: &User) -> Result<Option<StatsSnapshot>, String> {
    // Use the user's token to fetch their current stats
    let (tx, rx) = channel::unbounded::<(
        &'static str,
        &'static str,
        Result<reqwest::Response, String>,
    )>();

    // Create threads for each of the inner requests (we have to make 6; one for each of the three
    // timeframes, and then that multiplied by each of the two entities (tracks and artists)).
    debug!("Kicking off 6 API requests on separate threads...");
    for entity_type in &["tracks", "artists"] {
        for timeframe in &["short", "medium", "long"] {
            let token = user.token.clone();
            let tx = tx.clone();

            thread::spawn(move || {
                let client = reqwest::Client::new();
                let res: Result<reqwest::Response, String> = client
                    .get(&get_top_entities_url(entity_type, timeframe))
                    .bearer_auth(token)
                    .send()
                    .map_err(|_err| -> String {
                        "Error requesting latest user stats from the Spotify API".into()
                    });

                tx.send((entity_type, timeframe, res))
            });
        }
    }

    let mut tracks_responses: Vec<NewTrackHistoryEntry> = Vec::new();
    let mut artists_responses: Vec<NewArtistHistoryEntry> = Vec::new();

    let mut stats_snapshot = StatsSnapshot::default();
    stats_snapshot.last_update_time = Utc::now().naive_utc();

    // Wait for all 6 requests to return back and then
    debug!("Waiting for all 6 inner stats requests to return...");
    for _ in 0..6 {
        match rx.recv().unwrap() {
            ("tracks", timeframe, res) => {
                let parsed_res: TopTracksResponse = res?.json().map_err(|err| -> String {
                    error!("Error parsing top tracks response: {:?}", err);
                    "Error parsing response from Spotify".into()
                })?;

                for (ranking, top_track) in parsed_res.items.into_iter().enumerate() {
                    let entry = NewTrackHistoryEntry {
                        ranking: ranking as u16,
                        spotify_id: top_track.id.clone(),
                        timeframe: map_timeframe_to_timeframe_id(timeframe),
                        user_id: user.id,
                    };
                    stats_snapshot.tracks.add_item(timeframe, top_track);
                    tracks_responses.push(entry);
                }
            }
            ("artists", timeframe, res) => {
                let parsed_res: TopArtistsResponse = res?.json().map_err(|err| -> String {
                    error!("Error parsing top artists response: {:?}", err);
                    "Error parsing response from Spotify".into()
                })?;

                for (ranking, top_artist) in parsed_res.items.into_iter().enumerate() {
                    let entry = NewArtistHistoryEntry {
                        ranking: ranking as u16,
                        spotify_id: top_artist.id.clone(),
                        timeframe: map_timeframe_to_timeframe_id(timeframe),
                        user_id: user.id,
                    };
                    stats_snapshot.artists.add_item(timeframe, top_artist);
                    artists_responses.push(entry);
                }
            }
            _ => unreachable!(),
        }
    }

    Ok(Some(stats_snapshot))
}

fn map_timeframe_to_timeframe_id(timeframe: &str) -> u8 {
    match timeframe {
        "short" => 0,
        "medium" => 1,
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
                    spotify_id: artist.id,
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
                    spotify_id: track.id,
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
