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

use rocket_contrib::compression::Compression;

pub mod cache;
pub mod conf;
pub mod cors;
pub mod db_util;
pub mod models;
pub mod routes;
pub mod schema;
pub mod spotify_api;

#[database("spotify_homepage")]
pub struct DbConn(diesel::MysqlConnection);

pub struct SpotifyTokenData {
    token: String,
    pub expiry: chrono::DateTime<chrono::Local>,
}

impl SpotifyTokenData {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        let mut s = SpotifyTokenData {
            token: "".into(),
            expiry: chrono::Local::now(),
        };
        s.refresh()
            .expect("Failed to fetch initial spotify token for Rocket managed state");
        s
    }

    pub fn refresh(&mut self) -> Result<(), String> {
        let models::AccessTokenResponse {
            access_token,
            expires_in,
            ..
        } = spotify_api::fetch_auth_token()?;
        self.token = access_token;
        self.expiry = chrono::Local::now() + chrono::Duration::seconds((expires_in as i64) - 10);
        Ok(())
    }

    pub fn get(&mut self) -> Result<&str, String> {
        let now = chrono::Local::now();
        if now < self.expiry {
            self.refresh()?;
        }
        Ok(&self.token)
    }
}

fn main() {
    dotenv::dotenv().expect("dotenv file parsing failed");

    rocket::ignite()
        .mount(
            "/",
            routes![
                routes::index,
                routes::get_current_stats,
                routes::oauth_cb,
                routes::authorize
            ],
        )
        .attach(DbConn::fairing())
        .attach(cors::CorsFairing)
        .attach(Compression::fairing())
        .manage(Mutex::new(SpotifyTokenData::new()))
        .launch();
}
