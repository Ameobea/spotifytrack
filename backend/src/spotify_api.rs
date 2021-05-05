use std::{
    ops::Try,
    sync::{Arc, Mutex},
    thread::{self, sleep},
    time::Duration,
};

use chrono::Utc;
use crossbeam::channel;
use diesel::prelude::*;
use fnv::FnvHashMap as HashMap;
use reqwest::{self, StatusCode};
use serde::{Deserialize, Serialize};

use crate::{
    conf::CONF,
    models::{
        AccessTokenResponse, Artist, ArtistGenrePair, CreatePlaylistRequest,
        GetRelatedArtistsResponse, NewArtistHistoryEntry, NewTrackHistoryEntry, Playlist,
        SpotifyBatchArtistsResponse, SpotifyBatchTracksResponse, SpotifyResponse, StatsSnapshot,
        TopArtistsResponse, TopTracksResponse, Track, TrackArtistPair, UpdatePlaylistResponse,
        User, UserProfile,
    },
    DbConn,
};

const _SPOTIFY_USER_RECENTLY_PLAYED_URL: &str =
    "https://api.spotify.com/v1/me/player/recently-played";
const SPOTIFY_USER_PROFILE_INFO_URL: &str = "https://api.spotify.com/v1/me";
const SPOTIFY_BATCH_TRACKS_URL: &str = "https://api.spotify.com/v1/tracks";
const SPOTIFY_BATCH_ARTISTS_URL: &str = "https://api.spotify.com/v1/artists";
const SPOTIFY_APP_TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const ENTITY_FETCH_COUNT: usize = 50;

fn get_top_entities_url(entity_type: &str, timeframe: &str) -> String {
    format!(
        "https://api.spotify.com/v1/me/top/{}?limit={}&time_range={}_term",
        entity_type, ENTITY_FETCH_COUNT, timeframe
    )
}

fn process_spotify_res<R: for<'de> Deserialize<'de> + Clone + std::fmt::Debug>(
    url: &str,
    res: Result<reqwest::blocking::Response, reqwest::Error>,
) -> Result<R, String> {
    let res = res.map_err(|err| -> String {
        error!("Error communicating with Spotify API: {:?}", err);
        "Error communicating with from the Spotify API".into()
    })?;

    if res.status() == StatusCode::TOO_MANY_REQUESTS {
        warn!("Rate limited when making request to URL={}", url);
        return Err("Rate Limited".into());
    }

    if !res.status().is_success() {
        error!(
            "Got bad status code of {} from Spotify API: {:?}",
            res.status(),
            res.text()
        );
        return Err("Got bad response from Spotify API".into());
    }

    res.json::<SpotifyResponse<R>>()
        .map_err(|err| -> String {
            error!("Error decoding response from Spotify API: {:?}.", err,);
            "Error decoding response from Spotify API".into()
        })?
        .into_result()
}

pub(crate) fn spotify_user_api_request<T: for<'de> Deserialize<'de> + std::fmt::Debug + Clone>(
    url: &str,
    token: &str,
) -> Result<T, String> {
    let client = reqwest::blocking::Client::new();
    let res = client.get(url).bearer_auth(token).send();

    match process_spotify_res(&url, res) {
        Ok(res) => Ok(res),
        Err(err) if err.contains("Rate Limited") => {
            sleep(Duration::from_secs(5));
            spotify_user_api_request(url, token)
        },
        Err(err) => Err(err),
    }
}

pub(crate) fn get_user_profile_info(token: &str) -> Result<UserProfile, String> {
    spotify_user_api_request(SPOTIFY_USER_PROFILE_INFO_URL, token)
}

pub(crate) fn spotify_server_api_request<T: for<'de> Deserialize<'de> + std::fmt::Debug + Clone>(
    url: &str,
    params: HashMap<&str, &str>,
) -> Result<T, String> {
    let client = reqwest::blocking::Client::new();

    info!("Hitting Spotify API at URL {}, params: {:?}", url, params);
    let res = client
        .post(url.clone())
        .header("Authorization", CONF.get_authorization_header_content())
        .form(&params)
        .send();

    match process_spotify_res(&url, res) {
        Ok(res) => Ok(res),
        Err(err) if err.contains("Rate Limited") => {
            sleep(Duration::from_secs(5));
            spotify_server_api_request(url, params)
        },
        Err(err) => Err(err),
    }
}

fn spotify_user_json_api_get_request<R: for<'de> Deserialize<'de> + Clone + std::fmt::Debug>(
    bearer_token: &str,
    url: String,
) -> Result<R, String> {
    let client = reqwest::blocking::Client::new();
    info!("Hitting Spotify API at URL {}", url);

    let res = client.get(&url).bearer_auth(bearer_token).send();
    match process_spotify_res(&url, res) {
        Ok(res) => Ok(res),
        Err(err) if err.contains("Rate Limited") => {
            sleep(Duration::from_secs(5));
            spotify_user_json_api_get_request(bearer_token, url)
        },
        Err(err) => Err(err),
    }
}

pub(crate) fn spotify_user_json_api_request<
    T: Serialize + std::fmt::Debug,
    R: for<'de> Deserialize<'de> + Clone + std::fmt::Debug,
>(
    bearer_token: &str,
    url: &str,
    body: &T,
) -> Result<R, String> {
    let client = reqwest::blocking::Client::new();

    info!(
        "Hitting Spotify API at URL {}, params: {:?}, bearer_token={}",
        url, body, bearer_token
    );
    let res = client
        .post(url.clone())
        .header("Authorization", format!("Bearer {}", bearer_token))
        .json(body)
        .send();

    process_spotify_res(url, res)
}

pub(crate) fn fetch_auth_token() -> Result<AccessTokenResponse, String> {
    let mut params = HashMap::default();
    params.insert("grant_type", "client_credentials");

    spotify_server_api_request(SPOTIFY_APP_TOKEN_URL, params)
}

pub(crate) fn refresh_user_token(refresh_token: &str) -> Result<String, String> {
    let mut params = HashMap::default();
    params.insert("grant_type", "refresh_token");
    params.insert("refresh_token", refresh_token);

    let res: AccessTokenResponse = spotify_server_api_request(SPOTIFY_APP_TOKEN_URL, params)?;
    Ok(res.access_token)
}

pub(crate) fn fetch_cur_stats(user: &User) -> Result<Option<StatsSnapshot>, String> {
    // Use the user's token to fetch their current stats
    let (tx, rx) = channel::unbounded::<(
        &'static str,
        &'static str,
        Result<reqwest::blocking::Response, String>,
    )>();

    // Create threads for each of the inner requests (we have to make 6; one for each of the three
    // timeframes, and then that multiplied by each of the two entities (tracks and artists)).
    info!("Kicking off 6 API requests on separate threads...");
    for entity_type in &["tracks", "artists"] {
        for timeframe in &["short", "medium", "long"] {
            let token = user.token.clone();
            let tx = tx.clone();

            thread::spawn(move || {
                let client = reqwest::blocking::Client::new();
                let res: Result<reqwest::blocking::Response, String> = client
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

    let mut stats_snapshot = StatsSnapshot::new(Utc::now().naive_utc());

    // Wait for all 6 requests to return back and then
    info!("Waiting for all 6 inner stats requests to return...");
    for _ in 0..6 {
        match rx.recv().unwrap() {
            ("tracks", timeframe, res) => {
                let parsed_res: TopTracksResponse = res?.json().map_err(|err| -> String {
                    error!("Error parsing top tracks response: {:?}", err);
                    "Error parsing response from Spotify".into()
                })?;

                for top_track in parsed_res.items.into_iter().filter_map(|x| x) {
                    stats_snapshot.tracks.add_item(timeframe, top_track);
                }
            },
            ("artists", timeframe, res) => {
                let parsed_res: TopArtistsResponse = res?.json().map_err(|err| -> String {
                    error!("Error parsing top artists response: {:?}", err);
                    "Error parsing response from Spotify".into()
                })?;

                for top_artist in parsed_res.items.into_iter() {
                    stats_snapshot.artists.add_item(timeframe, top_artist);
                }
            },
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
        _ => panic!(
            "Tried to convert invalid timeframe to id: \"{}\"",
            timeframe
        ),
    }
}

/// For each track and artist timeframe, store a row in the `track_rank_snapshots` and
/// `artist_rank_snapshots` tables respectively
pub(crate) fn store_stats_snapshot(
    conn: &DbConn,
    user: &User,
    stats: StatsSnapshot,
) -> Result<(), String> {
    let update_time = stats.last_update_time;

    let genres_by_artist_id: HashMap<String, Vec<String>> = stats
        .artists
        .iter()
        .flat_map(|(_artist_timeframe, artists)| artists.iter())
        // Also include all other artists included in track metadata
        .chain(stats.tracks.iter().flat_map(|(_track_timeframe, tracks)| {
            tracks.iter().flat_map(|track| track.artists.iter())
        }))
        .fold(HashMap::default(), |mut acc, artist| {
            acc.insert(
                artist.id.clone(),
                artist.genres.clone().unwrap_or_else(Vec::new),
            );
            acc
        });
    let mapped_artist_spotify_ids =
        crate::db_util::retrieve_mapped_spotify_ids(conn, genres_by_artist_id.keys())?;

    let artist_entries: Vec<NewArtistHistoryEntry> = stats
        .artists
        .into_iter()
        .flat_map(|(artist_timeframe, artists)| {
            artists
                .into_iter()
                .enumerate()
                .map(move |(artist_ranking, artist)| (artist_timeframe, artist_ranking, artist.id))
                .map(|(artist_timeframe, artist_ranking, artist_spotify_id)| {
                    NewArtistHistoryEntry {
                        user_id: user.id,
                        mapped_spotify_id: mapped_artist_spotify_ids[&artist_spotify_id],
                        update_time,
                        timeframe: map_timeframe_to_timeframe_id(&artist_timeframe),
                        ranking: artist_ranking as u16,
                    }
                })
        })
        .collect();

    diesel::insert_into(crate::schema::artist_rank_snapshots::table)
        .values(&artist_entries)
        .execute(&conn.0)
        .map_err(|err| -> String {
            println!("Error inserting row: {:?}", err);
            "Error inserting user into database".into()
        })?;

    let track_spotify_ids: Vec<String> = stats
        .tracks
        .iter()
        .flat_map(|(_artist_timeframe, tracks)| tracks.iter().map(|track| track.id.clone()))
        .collect::<Vec<_>>();
    let mapped_track_spotify_ids =
        crate::db_util::retrieve_mapped_spotify_ids(conn, track_spotify_ids.iter())?;

    // Create track/artist mapping entries for each (track, artist) pair
    let track_artist_pairs: Vec<TrackArtistPair> = stats
        .tracks
        .iter()
        .flat_map(|(_artist_timeframe, tracks)| {
            tracks.iter().flat_map(|track| {
                let track_internal_id = mapped_track_spotify_ids[&track.id];

                track
                    .artists
                    .iter()
                    .map(|artist| mapped_artist_spotify_ids[&artist.id])
                    .map(move |artist_internal_id| TrackArtistPair {
                        track_id: track_internal_id,
                        artist_id: artist_internal_id,
                    })
            })
        })
        .collect();
    diesel::insert_or_ignore_into(crate::schema::tracks_artists::table)
        .values(&track_artist_pairs)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("Error inserting track/artist mappings: {:?}", err);
            "Error inserting track/artist metadata into database".into()
        })?;

    // Create artist/genre mapping entries for each (artist, genre) pair
    let artist_genre_pairs: Vec<ArtistGenrePair> = genres_by_artist_id
        .into_iter()
        .flat_map(|(artist_id, genres)| {
            let artist_id: i32 = *mapped_artist_spotify_ids
                .get(&artist_id)
                .expect("No entry in artist id mapping");

            genres
                .into_iter()
                .map(move |genre| ArtistGenrePair { artist_id, genre })
        })
        .collect();

    // Delete all old artist/genre entries for the artists we have here and insert the new ones,
    // making sure that the entries we have are all valid and up-to-date
    diesel::insert_or_ignore_into(crate::schema::artists_genres::table)
        .values(&artist_genre_pairs)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("Error inserting artist/genre mappings: {:?}", err);
            "Error inserting artist/genre mappings into database".into()
        })?;

    let track_entries: Vec<NewTrackHistoryEntry> = stats
        .tracks
        .into_iter()
        .flat_map(|(track_timeframe, tracks)| {
            tracks
                .into_iter()
                .enumerate()
                .map(move |(track_ranking, track)| (track_timeframe, track_ranking, track.id))
                .map(
                    |(track_timeframe, track_ranking, track_spotify_id)| NewTrackHistoryEntry {
                        user_id: user.id,
                        mapped_spotify_id: mapped_track_spotify_ids[&track_spotify_id],
                        update_time,
                        timeframe: map_timeframe_to_timeframe_id(&track_timeframe),
                        ranking: track_ranking as u16,
                    },
                )
        })
        .collect();

    diesel::insert_into(crate::schema::track_rank_snapshots::table)
        .values(&track_entries)
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("Error inserting row: {:?}", err);
            "Error inserting user into database".into()
        })?;

    // Update the user to have a last update time that matches all of the new updates
    let updated_row_count = crate::db_util::update_user_last_updated(&user, &conn, update_time)?;

    if updated_row_count != 1 {
        error!(
            "Updated {} rows when setting last update time, but should have updated 1.",
            updated_row_count
        );
    }

    Ok(())
}

const MAX_BATCH_ENTITY_COUNT: usize = 50;

fn fetch_batch_entities<'a, T: for<'de> Deserialize<'de>>(
    base_url: &str,
    token: &str,
    spotify_entity_ids: &[&str],
) -> Result<T, String> {
    let url = format!("{}?ids={}", base_url, spotify_entity_ids.join(","));
    let client = reqwest::blocking::Client::new();
    client
        .get(&url)
        .bearer_auth(token)
        .send()
        .map_err(|_err| -> String { "Error requesting batch data from the Spotify API".into() })?
        .json()
        .map_err(|err| -> String {
            error!("Error decoding JSON from Spotify API: {:?}", err);
            "Error reading data from the Spotify API".into()
        })
}

fn fetch_with_cache<
    ResponseType: for<'de> Deserialize<'de>,
    T: Clone + Serialize + for<'de> Deserialize<'de>,
>(
    cache_key: &str,
    api_url: &str,
    spotify_access_token: &str,
    spotify_ids: &[&str],
    map_response_to_items: fn(ResponseType) -> Result<Vec<T>, String>,
) -> Result<Vec<T>, String> {
    // First, try to get as many items as we can from the cache
    info!("Checking cache for {} spotify ids...", spotify_ids.len());
    let cache_res = crate::cache::get_hash_items::<T>(cache_key, spotify_ids)?;

    // Fire off a request to Spotify to fill in the missing items
    let mut missing_indices = Vec::new();
    let mut missing_ids = Vec::new();
    for (i, datum) in cache_res.iter().enumerate() {
        if datum.is_none() {
            missing_indices.push(i);
            missing_ids.push(spotify_ids[i]);
        }
    }
    info!(
        "{}/{} items found in the cache.",
        cache_res.len() - missing_indices.len(),
        spotify_ids.len()
    );

    let mut fetched_entities = Vec::with_capacity(missing_indices.len());
    for (chunk_ix, chunk) in missing_ids.chunks(MAX_BATCH_ENTITY_COUNT).enumerate() {
        info!("Fetching chunk {}...", chunk_ix);
        let res: ResponseType = fetch_batch_entities(api_url, spotify_access_token, chunk)?;
        let fetched_artist_data = map_response_to_items(res)?;

        for i in 0..chunk.len() {
            debug_assert_eq!(
                chunk[i],
                missing_ids[(chunk_ix * MAX_BATCH_ENTITY_COUNT) + i]
            );
        }

        // Update the cache with the missing items
        crate::cache::set_hash_items(
            cache_key,
            &fetched_artist_data
                .iter()
                .enumerate()
                .map(|(i, datum)| (chunk[i], datum))
                .collect::<Vec<_>>(),
        )?;

        fetched_entities.extend(fetched_artist_data)
    }
    info!("Fetched all chunks.");

    let mut i = 0;
    let combined_results = cache_res
        .into_iter()
        .map(|opt| {
            opt.unwrap_or_else(|| {
                // We could avoid this clone by reversing the direction in which we fetch the items
                // but that's 100% premature and likely useless optimization
                let val = fetched_entities[i].clone();
                i += 1;
                val
            })
        })
        .collect::<Vec<_>>();
    Ok(combined_results)
}

pub(crate) fn fetch_artists(
    spotify_access_token: &str,
    spotify_ids: &[&str],
) -> Result<Vec<Artist>, String> {
    let mut entities = fetch_with_cache::<SpotifyBatchArtistsResponse, _>(
        &CONF.artists_cache_hash_name,
        SPOTIFY_BATCH_ARTISTS_URL,
        spotify_access_token,
        spotify_ids,
        |res: SpotifyBatchArtistsResponse| Ok(res.artists),
    )?;

    for artist in &mut entities {
        if let Some(images) = artist.images.as_mut() {
            while images.len() > 1 {
                images.pop();
            }
        }
    }

    Ok(entities)
}

pub(crate) fn fetch_tracks(
    spotify_access_token: &str,
    spotify_ids: &[&str],
) -> Result<Vec<Track>, String> {
    let mut entities = fetch_with_cache::<SpotifyBatchTracksResponse, _>(
        &CONF.tracks_cache_hash_name,
        SPOTIFY_BATCH_TRACKS_URL,
        spotify_access_token,
        spotify_ids,
        |res: SpotifyBatchTracksResponse| Ok(res.tracks),
    )?;

    for track in &mut entities {
        while track.album.images.len() > 1 {
            track.album.images.pop();
        }
    }

    Ok(entities)
}

pub(crate) fn create_playlist(
    bearer_token: &str,
    user: &User,
    name: String,
    description: Option<String>,
    track_spotify_ids: &[String],
) -> Result<Playlist, String> {
    let url = format!(
        "https://api.spotify.com/v1/users/{user_id}/playlists",
        user_id = user.spotify_id
    );
    let body = CreatePlaylistRequest {
        name,
        description,
        public: Some(true),
        ..Default::default()
    };

    let mut created_playlist: Playlist = spotify_user_json_api_request(bearer_token, &url, &body)?;
    info!(
        "Successfully created playlist with id={:?}",
        created_playlist.id
    );

    let url = format!(
        "https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
        playlist_id = created_playlist.id
    );
    // Can only add up to 100 tracks at a time
    created_playlist.tracks.total = 0;
    for track_spotify_ids in track_spotify_ids.chunks(100) {
        let body = json!({ "uris": track_spotify_ids });
        info!(
            "Adding {} tracks to playlist id {}...",
            track_spotify_ids.len(),
            created_playlist.id
        );
        let UpdatePlaylistResponse { snapshot_id } =
            spotify_user_json_api_request(bearer_token, &url, &body)?;
        info!(
            "Successfully added {} items to playlist id {}",
            track_spotify_ids.len(),
            created_playlist.id
        );
        created_playlist.snapshot_id = snapshot_id;
        created_playlist.tracks.total += track_spotify_ids.len();
    }

    Ok(created_playlist)
}

pub(crate) fn get_related_artists(
    bearer_token: &str,
    artist_id: &str,
) -> Result<Vec<Artist>, String> {
    let url = format!(
        "https://api.spotify.com/v1/artists/{}/related-artists",
        artist_id
    );
    let res: GetRelatedArtistsResponse = spotify_user_json_api_get_request(bearer_token, url)?;
    Ok(res.artists)
}

pub(crate) fn get_multiple_related_artists(
    bearer_token: String,
    artist_ids: &[&str],
) -> Result<Vec<Vec<String>>, String> {
    // Pull those from the cache that can be pulled
    let cache_results = crate::cache::get_hash_items::<Vec<String>>("related_artists", artist_ids)?;

    let mut output = vec![None; artist_ids.len()];
    let mut uncached_ids: Vec<String> = Vec::new();
    for (i, cache_res) in cache_results.into_iter().enumerate() {
        if let Some(related) = cache_res {
            output[i] = Some(related);
            continue;
        }

        uncached_ids.push(artist_ids[i].to_owned());
    }

    // Fetch all uncached ids and store in the cache
    const CONCURRENT_FETCHES: usize = 4;
    let total_to_fetch = uncached_ids.len();
    let uncached_ids_clone = uncached_ids.clone();
    let uncached_ids_clone_2 = uncached_ids_clone.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let (_, fetched_results) = rayon::join(
        move || {
            let work = Arc::new(Mutex::new(uncached_ids_clone_2));

            for _ in 0..CONCURRENT_FETCHES {
                let bearer_token = bearer_token.clone();
                let tx = tx.clone();
                let work = Arc::clone(&work);

                std::thread::spawn(move || loop {
                    let artist_id = match { work.lock().unwrap().pop() } {
                        Some(id) => id,
                        None => {
                            debug!("No more items to fetch, worker exiting");
                            break;
                        },
                    };

                    let related_artists_res = get_related_artists(&bearer_token, &artist_id);
                    tx.send((artist_id, related_artists_res))
                        .expect("Failed to send related artist over channel");
                });
            }
        },
        move || {
            let mut fetched = vec![Vec::new(); total_to_fetch];
            let mut fetched_so_far = 0;
            while fetched_so_far < total_to_fetch {
                let (artist_id, related_artists) = match rx.recv_timeout(Duration::from_secs(30)) {
                    Ok((artist_id, Ok(res))) => (artist_id, res),
                    Ok((artist_id, Err(err))) => {
                        error!(
                            "Error fetching related artist for artist_id={}: {:?}",
                            artist_id, err
                        );
                        (artist_id, Vec::new())
                    },
                    Err(_) => {
                        error!(
                            "No response on channel in 30 seconds when fetching related artists; \
                             giving up"
                        );
                        return Err(String::from(
                            "Error fetching related artists from Spotify API",
                        ));
                    },
                };
                fetched_so_far += 1;

                let ix = uncached_ids_clone
                    .iter()
                    .position(|id| *id == artist_id)
                    .expect("Received artist ID for related artist we didn't ask for");
                assert!(fetched[ix].is_empty());
                fetched[ix] = related_artists
                    .into_iter()
                    .map(|artist| artist.id)
                    .collect();
            }

            Ok(fetched)
        },
    );
    let fetched_results = fetched_results?;

    let mut kv_pairs_to_cache: Vec<(&str, Vec<String>)> = Vec::with_capacity(uncached_ids.len());
    for (i, related_artists) in fetched_results.into_iter().enumerate() {
        let artist_id = &uncached_ids[i];
        let output_ix = artist_ids
            .iter()
            .position(|o_artist_id| *o_artist_id == artist_id.as_str())
            .unwrap();
        output[output_ix] = Some(related_artists.clone());

        kv_pairs_to_cache.push((artist_id, related_artists));
    }
    crate::cache::set_hash_items("related_artists", &kv_pairs_to_cache)?;

    Ok(output
        .into_iter()
        .map(|opt| {
            opt.expect(
                "All artists must have been filled in at this point by either the cache or \
                 dynamic fetching",
            )
        })
        .collect())
}
