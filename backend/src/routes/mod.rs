use std::collections::HashMap;

use chrono::Utc;
use diesel::{self, prelude::*};
use rocket::http::RawStr;
use rocket::response::Redirect;
use rocket_contrib::json::Json;

use crate::conf::CONF;

use crate::models::{
    ArtistHistoryEntry, NewUser, OAuthTokenResponse, StatsSnapshot, TrackHistoryEntry,
};
use crate::DbConn;

use crate::db_util::{self, diesel_not_found_to_none};

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
) -> Result<Option<Json<StatsSnapshot>>, String> {
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        }
    };

    // TODO: Parallelize
    let artist_stats = {
        use crate::schema::artist_history::dsl::*;

        let artists_stats_opt = diesel_not_found_to_none(
            artist_history
                .filter(user_id.eq(user.id))
                .filter(update_time.eq(user.last_update_time))
                .order_by(update_time)
                .load::<ArtistHistoryEntry>(&conn.0),
        )?;

        let artists_stats = match artists_stats_opt {
            None => return Ok(None),
            Some(res) => res,
        };

        let artist_spotify_ids: Vec<&str> = artists_stats
            .iter()
            .map(|entry| entry.spotify_id.as_str())
            .collect();
        let artists_opts = crate::spotify_api::fetch_artists(&artist_spotify_ids)?;
        artists_opts
            .into_iter()
            .enumerate()
            .filter_map(|(i, opt)| {
                if opt.is_none() {
                    warn!(
                        "Missing artist for spotify ID \"{}\"",
                        artist_spotify_ids[i]
                    );
                    None
                } else {
                    let timeframe_id = artists_stats[i].timeframe;
                    opt.map(|artist| (timeframe_id, artist))
                }
            })
            .collect::<Vec<_>>()
    };

    let track_stats = {
        use crate::schema::track_history::dsl::*;

        let track_stats_opt = diesel_not_found_to_none(
            track_history
                .filter(user_id.eq(user.id))
                .filter(update_time.eq(user.last_update_time))
                .order_by(update_time)
                .load::<TrackHistoryEntry>(&conn.0),
        )?;

        let track_stats = match track_stats_opt {
            None => return Ok(None),
            Some(res) => res,
        };

        let track_spotify_ids: Vec<&str> = track_stats
            .iter()
            .map(|entry| entry.spotify_id.as_str())
            .collect();
        let track_opts = crate::spotify_api::fetch_tracks(&track_spotify_ids)?;
        track_opts
            .into_iter()
            .enumerate()
            .filter_map(|(i, opt)| {
                if opt.is_none() {
                    warn!("Missing artist for spotify ID \"{}\"", track_spotify_ids[i]);
                    None
                } else {
                    let timeframe_id = track_stats[i].timeframe;
                    opt.map(|track| (timeframe_id, track))
                }
            })
            .collect::<Vec<_>>()
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

#[post("/connect", data = "<account_data>")]
pub fn connect_to_spotify(conn: DbConn, account_data: String) -> Result<(), ()> {
    Ok(()) // TODO
}

fn get_absolute_oauth_cb_uri() -> String {
    format!("{}/oauth_cb", CONF.server_base_url)
}

/// Redirects to the Spotify authorization page for the application
#[get("/authorize")]
pub fn authorize() -> Redirect {
    let scopes = "user-read-recently-played%20user-top-read%20user-follow-read";
    let callback_uri = get_absolute_oauth_cb_uri();

    Redirect::to(format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}",
        CONF.client_id,
        callback_uri,
        scopes
    ))
}

#[get("/oauth_cb?<error>&<code>")]
pub fn oauth_cb(conn: DbConn, error: Option<&RawStr>, code: &RawStr) -> Result<Redirect, String> {
    if error.is_some() {
        error!("Error during Oauth authorization process: {:?}", error);
        unimplemented!();
    }

    // Shoot the code back to Spotify and get an API token for the user in return
    let mut params = HashMap::new();
    params.insert("grant_type", "authorization_code");
    params.insert("code", code.as_str());
    let oauth_cb_url = get_absolute_oauth_cb_uri();
    params.insert("redirect_uri", oauth_cb_url.as_str());
    params.insert("client_id", CONF.client_id.as_str());
    params.insert("client_secret", CONF.client_secret.as_str());

    let client = reqwest::Client::new();
    debug!("Making request to fetch user token from OAuth CB response...");
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

    debug!("Fetched user tokens.  Inserting user into database...");

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

    crate::spotify_api::store_stats_snapshot(conn, &user, cur_user_stats)?;

    // Redirect the user to their stats page
    Ok(Redirect::to(format!("/stats/{}", user_spotify_id)))
}
