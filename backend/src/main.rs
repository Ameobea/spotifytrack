#![feature(proc_macro_hygiene, decl_macro, box_patterns, try_trait)]
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

pub mod benchmarking;
pub mod cache;
pub mod conf;
pub mod cors;
pub mod db_util;
pub mod models;
pub mod routes;
pub mod schema;
pub mod shared_playlist_gen;
pub mod spotify_api;
pub mod spotify_token;
pub mod stats;

use self::spotify_token::SpotifyTokenData;

#[database("spotify_homepage")]
pub(crate) struct DbConn(diesel::MysqlConnection);

fn main() {
    dotenv::dotenv().expect("dotenv file parsing failed");

    let all_routes = routes![
        routes::index,
        routes::get_current_stats,
        routes::oauth_cb,
        routes::authorize,
        routes::update_user,
        routes::get_artist_stats,
        routes::get_genre_history,
        routes::populate_tracks_artists_mapping_table,
        routes::populate_artists_genres_mapping_table,
        routes::get_genre_stats,
        routes::get_timeline,
        routes::compare_users,
        routes::get_related_artists_graph,
        routes::get_related_artists,
        routes::get_display_name,
        routes::dump_redis_related_artists_to_database,
        routes::crawl_related_artists,
        routes::search_artist
    ];

    rocket::ignite()
        .mount("/", all_routes.clone())
        .mount("/api/", all_routes)
        .attach(DbConn::fairing())
        .attach(cors::CorsFairing)
        .attach(Compression::fairing())
        .manage(Mutex::new(SpotifyTokenData::new()))
        .launch();
}
