#![feature(
    proc_macro_hygiene,
    decl_macro,
    slice_patterns,
    bind_by_move_pattern_guards,
    box_patterns,
    nll
)]

extern crate arrayvec;
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

fn main() {
    dotenv::dotenv().expect("dotenv file parsing failed");

    rocket::ignite()
        .mount(
            "/",
            routes![
                routes::index,
                routes::get_current_stats,
                routes::connect_to_spotify,
                routes::oauth_cb,
                routes::authorize
            ],
        )
        .attach(DbConn::fairing())
        .attach(cors::CorsFairing)
        .launch();
}
