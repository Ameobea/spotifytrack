use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;

use chrono::{NaiveDateTime, Utc};
use diesel::{self, prelude::*};
use rocket::http::{RawStr, Status};
use rocket::response::status;
use rocket::{response::Redirect, State};
use rocket_contrib::json::Json;

use crate::conf::CONF;

use crate::db_util;
use crate::models::{Artist, NewUser, OAuthTokenResponse, StatsSnapshot, Track, User};
use crate::DbConn;
use crate::SpotifyTokenData;

const SPOTIFY_TOKEN_FETCH_URL: &str = "https://accounts.spotify.com/api/token";

#[get("/")]
pub fn index() -> &'static str {
    "Application successfully started!"
}

/// Retrieves the current top tracks and artist for the current user
#[get("/stats/<username>")]
pub fn get_current_stats(
    conn: DbConn,
    username: String,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<StatsSnapshot>>, String> {
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        }
    };

    let token_data = &mut *(&*token_data).lock().unwrap();
    let spotify_access_token = token_data.get()?;

    // TODO: Parallelize, if possible.  We only have one connection and that's the bottleneck here...
    let artist_stats = match db_util::get_artist_stats(&user, &conn, spotify_access_token)? {
        Some(stats) => stats,
        None => return Ok(None),
    };
    let track_stats = match db_util::get_track_stats(&user, &conn, spotify_access_token)? {
        Some(stats) => stats,
        None => return Ok(None),
    };

    let mut snapshot = StatsSnapshot::new(user.last_update_time);

    for (timeframe_id, artist) in artist_stats {
        snapshot.artists.add_item_by_id(timeframe_id, artist);
    }

    for (timeframe_id, track) in track_stats {
        snapshot.tracks.add_item_by_id(timeframe_id, track);
    }

    Ok(Some(Json(snapshot)))
}

#[derive(Serialize)]
pub struct ArtistStats {
    pub tracks_by_id: HashMap<String, Track>,
    pub popularity_history: Vec<(NaiveDateTime, [Option<usize>; 3])>,
    pub top_tracks: Vec<(String, usize)>,
}

#[get("/stats/<username>/artist/<artist_id>")]
pub fn get_artist_stats(
    conn: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    username: String,
    artist_id: String,
) -> Result<Option<Json<ArtistStats>>, String> {
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        }
    };
    let token_data = &mut *(&*token_data).lock().unwrap();
    let spotify_access_token = token_data.get()?;

    // TODO: This is dumb inefficient; no need to fetch ALL artist metadata.  Need to improve once we set up the alternative metadata mappings.
    let (_artists_by_id, artist_stats_history) =
        match db_util::get_artist_stats_history(&user, &conn, spotify_access_token)? {
            Some(res) => res,
            None => return Ok(None),
        };

    let popularity_history =
        crate::stats::get_artist_popularity_history(&artist_id, &artist_stats_history);

    let (mut tracks_by_id, track_history) =
        match db_util::get_track_stats_history(&user, &conn, spotify_access_token)? {
            Some(res) => res,
            None => return Ok(None),
        };
    let top_tracks = crate::stats::get_tracks_for_artist(&artist_id, &tracks_by_id, &track_history);
    // Only send track metadata for this artist's tracks
    tracks_by_id.retain(|track_id, _| {
        top_tracks
            .iter()
            .find(|(retained_track_id, _)| track_id == retained_track_id)
            .is_some()
    });

    let stats = ArtistStats {
        tracks_by_id,
        popularity_history,
        top_tracks,
    };
    Ok(Some(Json(stats)))
}

/// Redirects to the Spotify authorization page for the application
#[get("/authorize")]
pub fn authorize() -> Redirect {
    let scopes = "user-read-recently-played%20user-top-read%20user-follow-read";
    let callback_uri = crate::conf::CONF.get_absolute_oauth_cb_uri();

    Redirect::to(format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}",
        CONF.client_id,
        callback_uri,
        scopes
    ))
}

/// This handles the OAuth authentication process for new users.  It is hit as the callback for the
/// authentication request and handles retrieving user tokens, creating an entry for the user in the
/// users table, and fetching an initial stats snapshot.
#[get("/oauth_cb?<error>&<code>")]
pub fn oauth_cb(conn: DbConn, error: Option<&RawStr>, code: &RawStr) -> Result<Redirect, String> {
    if error.is_some() {
        error!("Error during Oauth authorization process: {:?}", error);
        return Err("An error occured while authenticating with Spotify.".into());
    }

    // Shoot the code back to Spotify and get an API token for the user in return
    let mut params = HashMap::new();
    params.insert("grant_type", "authorization_code");
    params.insert("code", code.as_str());
    let oauth_cb_url = crate::conf::CONF.get_absolute_oauth_cb_uri();
    params.insert("redirect_uri", oauth_cb_url.as_str());
    params.insert("client_id", CONF.client_id.as_str());
    params.insert("client_secret", CONF.client_secret.as_str());

    let client = reqwest::Client::new();
    info!("Making request to fetch user token from OAuth CB response...");
    let mut res = client
        .post(SPOTIFY_TOKEN_FETCH_URL)
        .form(&params)
        .send()
        .map_err(|_| -> String {
            "Error fetching token from Spotify from response Oauth code".into()
        })?;

    let res: OAuthTokenResponse = match res.json() {
        Ok(res) => res,
        Err(err) => {
            error!("Failed to fetch user tokens from OAuth CB code: {:?}", err);
            return Err("Error parsing response from token fetch endpoint".into());
        }
    };

    let (access_token, refresh_token) = match res {
        OAuthTokenResponse::Success {
            access_token,
            refresh_token,
            ..
        } => (access_token, refresh_token),
        OAuthTokenResponse::Error {
            error,
            error_description,
        } => {
            error!(
                "Error fetching tokens for user: {}; {}",
                error, error_description
            );
            return Err("Error fetching user access tokens from Spotify API.".into());
        }
    };

    info!("Fetched user tokens.  Inserting user into database...");

    // Fetch the user's username and spotify ID from the Spotify API
    let user_profile_info = crate::spotify_api::get_user_profile_info(&access_token)?;
    let user_spotify_id = user_profile_info.id;
    let username = user_profile_info.display_name;

    let user = NewUser {
        creation_time: Utc::now().naive_utc(),
        last_update_time: Utc::now().naive_utc(),
        spotify_id: user_spotify_id.clone(),
        username: username.clone(),
        token: access_token,
        refresh_token,
    };

    diesel::insert_into(crate::schema::users::table)
        .values(&user)
        .execute(&conn.0)
        .map_err(|err| -> String {
            println!("Error inserting row: {:?}", err);
            "Error inserting user into database".into()
        })?;

    // Retrieve the inserted user row
    let user = crate::db_util::get_user_by_spotify_id(&conn, &user_spotify_id)?
        .expect("Failed to load just inserted user from database");

    // Create an initial stats snapshot to store for the user
    let cur_user_stats = match crate::spotify_api::fetch_cur_stats(&user)? {
        Some(stats) => stats,
        None => {
            error!(
                "Failed to fetch stats for user \"{}\"; bad response from Spotify API?",
                username
            );
            return Err("Error fetching user stats from the Spotify API.".into());
        }
    };

    crate::spotify_api::store_stats_snapshot(&conn, &user, cur_user_stats)?;

    // Redirect the user to their stats page
    Ok(Redirect::to(format!("/stats/{}", user_spotify_id)))
}

/// This route is internal and hit by the cron job that is called to periodically update the stats
/// for the least recently updated user.
#[post("/update_user", data = "<api_token_data>")]
pub fn update_user(
    conn: DbConn,
    api_token_data: rocket::data::Data,
) -> Result<status::Custom<String>, String> {
    use crate::schema::users::dsl::*;

    let mut api_token: String = String::new();
    api_token_data
        .open()
        .take(1024 * 1024)
        .read_to_string(&mut api_token)
        .map_err(|err| {
            error!("Error reading provided admin API token: {:?}", err);
            String::from("Error reading post data body")
        })?;

    if api_token != CONF.admin_api_token {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    // Get the least recently updated user
    let mut user: User =
        users
            .order_by(last_update_time)
            .first(&conn.0)
            .map_err(|err| -> String {
                error!("{:?}", err);
                "Error querying user to update from database".into()
            })?;

    // Update the access token for that user using the refresh token
    let updated_access_token = crate::spotify_api::refresh_user_token(&user.refresh_token)?;
    diesel::update(users.filter(id.eq(user.id)))
        .set(token.eq(&updated_access_token))
        .execute(&conn.0)
        .map_err(|err| -> String {
            error!("{:?}", err);
            "Error updating user with new access token".into()
        })?;
    user.token = updated_access_token;

    // Only update the user if it's been longer than the minimum update interval
    let min_update_interval_seconds = crate::conf::CONF.min_update_interval;
    let now = chrono::Utc::now().naive_utc();
    let diff = now - user.last_update_time;
    if diff < min_update_interval_seconds {
        let msg = format!(
            "{} since last update; not updating anything right now.",
            diff
        );
        info!("{}", msg);
        return Ok(status::Custom(Status::Ok, msg));
    }
    info!("{} since last update; proceeding with update.", diff);

    let stats = match crate::spotify_api::fetch_cur_stats(&user)? {
        Some(stats) => stats,
        None => {
            error!(
                "Error when fetching stats for user {:?}; no stats returned.",
                user
            );
            return Err("No data from Spotify API for that user".into());
        }
    };

    crate::spotify_api::store_stats_snapshot(&conn, &user, stats)?;

    Ok(status::Custom(
        Status::Ok,
        format!("Successfully updated user {}", user.username),
    ))
}
