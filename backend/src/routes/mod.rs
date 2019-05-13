use std::collections::HashMap;

use chrono::Utc;
use diesel::{self, prelude::*};
use rocket::http::RawStr;
use rocket::response::Redirect;
use rocket_contrib::json::Json;

use crate::conf::CONF;
use crate::models::{NewUser, OAuthTokenResponse, StatsSnapshot};
use crate::DbConn;

const SPOTIFY_TOKEN_FETCH_URL: &str = "https://accounts.spotify.com/api/token";

#[get("/")]
pub fn index() -> &'static str {
    "Application successfully started!"
}

/// Retrieves the current top tracks and artist for the current user
#[get("/stats/<username>")]
pub fn get_current_stats(conn: DbConn, username: String) -> Result<Json<StatsSnapshot>, String> {
    unimplemented!(); // TODO
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
    let state = "TODO";
    let scopes = "user-read-recently-played%20user-top-read";
    let callback_uri = get_absolute_oauth_cb_uri();

    Redirect::to(format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&state={}&scope={}",
        CONF.client_id,
        callback_uri,
        state,
        scopes
    ))
}


#[get("/oauth_cb?<error>&<code>&<state>")]
pub fn oauth_cb(
    conn: DbConn,
    error: Option<&RawStr>,
    code: &RawStr,
    state: Option<&RawStr>,
) -> Result<Redirect, String> {
    if error.is_some() {
        println!("Error during Oauth authorization process: {:?}", error);
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
    let mut res = client
        .post(SPOTIFY_TOKEN_FETCH_URL)
        .form(&params)
        .send()
        .map_err(|_| -> String {
            "Error fetching token from Spotify from response Oauth code".into()
        })?;

    let res: OAuthTokenResponse = match res.json() {
        Ok(res) => res,
        Err(_) => return Err("Error parsing response from token fetch endpoint".into()),
    };

    // Fetch the user's username from the Spotify API
    let username: String = "TODO".into();

    let user = NewUser {
        creation_time: Utc::now().naive_utc(),
        last_update_time: Utc::now().naive_utc(),
        username: username.clone(),
        token: res.access_token,
        refresh_token: res.refresh_token,
    };

    diesel::insert_into(crate::schema::users::table)
        .values(&user)
        .execute(&conn.0)
        .map_err(|err| -> String {
            println!("Error inserting row: {:?}", err);
            "Error inserting user into database".into()
        })?;


    let cur_user_stats = crate::spotify_api::fetch_cur_stats(conn, &username)?.expect(
        "Failed to load user's data from the database even though we should have just inserted it",
    );

    // Redirect the user to their stats page
    Ok(Redirect::to("/"))
}
