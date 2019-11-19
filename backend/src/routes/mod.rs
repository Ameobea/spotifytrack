use std::io::Read;
use std::sync::Mutex;

use chrono::{NaiveDateTime, Utc};
use diesel::{self, prelude::*};
use hashbrown::HashMap;
use rocket::http::{RawStr, Status};
use rocket::response::status;
use rocket::{response::Redirect, State};
use rocket_contrib::json::Json;

use crate::benchmarking::{mark, start};
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
    conn2: DbConn,
    username: String,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<StatsSnapshot>>, String> {
    start();
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        }
    };
    mark("Finished getting spotify user by id");

    let token_data = &mut *(&*token_data).lock().unwrap();
    let spotify_access_token = token_data.get()?;
    mark("Got spotify access token");

    let (artist_stats, track_stats) = match rayon::join(
        || db_util::get_artist_stats(&user, conn, spotify_access_token),
        || db_util::get_track_stats(&user, conn2, spotify_access_token),
    ) {
        (Err(err), _) | (Ok(_), Err(err)) => return Err(err),
        (Ok(None), _) | (_, Ok(None)) => return Ok(None),
        (Ok(Some(artist_stats)), Ok(Some(track_stats))) => (artist_stats, track_stats),
    };
    mark("Fetched artist and track stats");

    let mut snapshot = StatsSnapshot::new(user.last_update_time);

    for (timeframe_id, artist) in artist_stats {
        snapshot.artists.add_item_by_id(timeframe_id, artist);
    }

    for (timeframe_id, track) in track_stats {
        snapshot.tracks.add_item_by_id(timeframe_id, track);
    }
    mark("Constructed snapshot");

    Ok(Some(Json(snapshot)))
}

#[derive(Serialize)]
pub struct ArtistStats {
    pub artist: Artist,
    pub tracks_by_id: HashMap<String, Track>,
    pub popularity_history: Vec<(NaiveDateTime, [Option<u16>; 3])>,
    pub top_tracks: Vec<(String, usize)>,
}

#[get("/stats/<username>/artist/<artist_id>")]
pub fn get_artist_stats(
    conn: DbConn,
    conn2: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    username: String,
    artist_id: String,
) -> Result<Option<Json<ArtistStats>>, String> {
    start();
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        }
    };
    mark("Finished getting spotify user by id");

    let token_data = &mut *(&*token_data).lock().unwrap();
    let spotify_access_token = token_data.get()?;
    mark("Got spotify access token");

    let (artist_popularity_history, (tracks_by_id, top_track_scores)) = match rayon::join(
        || crate::db_util::get_artist_rank_history_single_artist(&user, conn, &artist_id),
        || -> Result<Option<(HashMap<String, Track>, Vec<(String, usize)>)>, String> {
            let (tracks_by_id, track_history) = match db_util::get_track_stats_history(
                &user,
                conn2,
                spotify_access_token,
                &artist_id,
            )? {
                Some(res) => res,
                None => return Ok(None),
            };
            let top_track_scores = crate::stats::compute_track_popularity_scores(&track_history);

            Ok(Some((tracks_by_id, top_track_scores)))
        },
    ) {
        (Err(err), _) | (Ok(_), Err(err)) => return Err(err),
        (Ok(None), _) | (_, Ok(None)) => return Ok(None),
        (Ok(Some(a)), Ok(Some(b))) => (a, b),
    };
    mark("Fetched artists stats and top tracks");

    let artist = match crate::spotify_api::fetch_artists(spotify_access_token, &[&artist_id])?
        .drain(..)
        .next()
    {
        Some(artist) => artist,
        None => return Ok(None),
    };
    mark("Found matching artist to use");

    let stats = ArtistStats {
        artist,
        tracks_by_id,
        popularity_history: artist_popularity_history,
        top_tracks: top_track_scores,
    };
    Ok(Some(Json(stats)))
}

#[derive(Serialize)]
pub struct GenresHistory {
    pub timestamps: Vec<NaiveDateTime>,
    pub history_by_genre: HashMap<String, Vec<Option<usize>>>,
}

#[get("/stats/<username>/genre_history")]
pub fn get_genre_history(
    conn: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    username: String,
) -> Result<Option<Json<GenresHistory>>, String> {
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        }
    };
    let token_data = &mut *(&*token_data).lock().unwrap();
    let spotify_access_token = token_data.get()?;

    // Only include data from the "short" timeframe since we're producing a timeseries
    let (artists_by_id, artist_stats_history) =
        match db_util::get_artist_stats_history(&user, conn, spotify_access_token, Some(0))? {
            Some(res) => res,
            None => return Ok(None),
        };

    let (timestamps, history_by_genre) =
        crate::stats::get_top_genres_by_artists(&artists_by_id, &artist_stats_history, true);
    Ok(Some(Json(GenresHistory {
        timestamps,
        history_by_genre,
    })))
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

    let oauth_cb_url = crate::conf::CONF.get_absolute_oauth_cb_uri();

    // Shoot the code back to Spotify and get an API token for the user in return
    let mut params = HashMap::new();
    params.insert("grant_type", "authorization_code");
    params.insert("code", code.as_str());
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

    match diesel::insert_into(crate::schema::users::table)
        .values(&user)
        .execute(&conn.0)
    {
        Err(diesel::result::Error::DatabaseError(
            diesel::result::DatabaseErrorKind::UniqueViolation,
            _,
        )) => info!("Already have a row for user; skipping manual update and redirecting diretly."),
        Err(err) => {
            error!("Error inserting row: {:?}", err);
            return Err("Error inserting user into database".into());
        }
        Ok(_) => {
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
        }
    };

    // Redirect the user to their stats page
    Ok(Redirect::to(format!(
        "{}/stats/{}",
        CONF.website_url, user_spotify_id
    )))
}

/// Returns `true` if the token is valid, false if it's not
fn validate_api_token(api_token_data: rocket::data::Data) -> Result<bool, String> {
    let mut api_token: String = String::new();
    api_token_data
        .open()
        .take(1024 * 1024)
        .read_to_string(&mut api_token)
        .map_err(|err| {
            error!("Error reading provided admin API token: {:?}", err);
            String::from("Error reading post data body")
        })
        .map(|_| api_token == CONF.admin_api_token)
}

/// This route is internal and hit by the cron job that is called to periodically update the stats
/// for the least recently updated user.
#[post("/update_user", data = "<api_token_data>")]
pub fn update_user(
    conn: DbConn,
    api_token_data: rocket::data::Data,
) -> Result<status::Custom<String>, String> {
    use crate::schema::users::dsl::*;

    if !validate_api_token(api_token_data)? {
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
    let updated_access_token = match crate::spotify_api::refresh_user_token(&user.refresh_token) {
        Ok(updated_access_token) => updated_access_token,
        Err(_) => {
            db_util::update_user_last_updated(&user, &conn, Utc::now().naive_utc())?;

            // TODO: Disable auto-updates for the user that has removed their permission grant to prevent wasted updates in the future
            let msg = format!("Failed to refresh user token for user {}; updating last updated timestamp and not updating.", user.username);
            info!("{}", msg);
            return Ok(status::Custom(Status::Unauthorized, msg));
        }
    };
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

#[post("/populate_mapping_table", data = "<api_token_data>")]
pub fn populate_mapping_table(
    conn: DbConn,
    api_token_data: rocket::data::Data,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data)? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let token_data = &mut *(&*token_data).lock().unwrap();
    let spotify_access_token = token_data.get()?;

    crate::db_util::populate_tracks_artists_table(&conn, &spotify_access_token)?;

    Ok(status::Custom(
        Status::Ok,
        "Sucessfully populated mapping table".into(),
    ))
}
