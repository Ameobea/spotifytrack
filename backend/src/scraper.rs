#![feature(
    proc_macro_hygiene,
    decl_macro,
    slice_patterns,
    bind_by_move_pattern_guards,
    box_patterns,
    nll
)]
#![allow(clippy::identity_conversion)]

extern crate base64;
extern crate chrono;
extern crate crossbeam;
#[macro_use]
extern crate diesel;
extern crate dotenv;
#[macro_use]
extern crate lazy_static;
#[macro_use]
extern crate log;
extern crate r2d2_redis;
extern crate rayon;
extern crate redis;
#[macro_use]
extern crate rocket;
#[macro_use]
extern crate rocket_contrib;
extern crate serde;
extern crate serde_json;
#[macro_use]
extern crate serde_derive;

use std::sync::Mutex;

use diesel::prelude::*;

pub mod cache;
pub mod conf;
pub mod cors;
pub mod db_util;
pub mod models;
pub mod routes;
pub mod schema;
pub mod spotify_api;
pub mod spotify_token;

use crate::models::User;
use crate::spotify_token::SpotifyTokenData;

#[database("spotify_homepage")]
pub struct DbConn(diesel::MysqlConnection);

#[get("/update_user")]
pub fn update_user(conn: DbConn) -> Result<(), String> {
    use crate::schema::users::dsl::*;

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
        info!(
            "{} since last update; not updating anything right now.",
            diff
        );
        return Ok(());
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

    spotify_api::store_stats_snapshot(&conn, &user, stats)
}

pub fn main() {
    dotenv::dotenv().expect("dotenv file parsing failed");

    rocket::ignite()
        .mount("/", routes![update_user])
        .attach(DbConn::fairing())
        .manage(Mutex::new(SpotifyTokenData::new()))
        .launch();
}
