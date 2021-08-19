#![feature(
    proc_macro_hygiene,
    decl_macro,
    box_patterns,
    try_trait_v2,
    label_break_value,
    box_syntax
)]
#![allow(clippy::identity_conversion)]

#[macro_use]
extern crate diesel;
#[macro_use]
extern crate serde_derive;
#[macro_use]
extern crate rocket;

use artist_embedding::{init_artist_embedding_ctx, map_3d::get_packed_3d_artist_coords};
use rocket_async_compression::Compression;
use tokio::sync::Mutex;

pub mod artist_embedding;
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

#[rocket_sync_db_pools::database("spotify_homepage")]
pub struct DbConn(diesel::MysqlConnection);

#[rocket::main]
pub async fn main() {
    dotenv::dotenv().expect("dotenv file parsing failed");

    init_artist_embedding_ctx("https://ameo.dev/artist_embedding_8d.w2v").await;

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
        routes::search_artist,
        routes::get_average_artists_route,
        routes::get_artist_image_url,
        routes::get_packed_3d_artist_coords_route,
        routes::refetch_cached_artists_missing_popularity,
        routes::get_artists_by_internal_ids,
    ];

    // Pre-populate the packed 3D artist map embedding to make the first request for it instant
    tokio::task::spawn(async {
        get_packed_3d_artist_coords().await;
    });

    rocket::build()
        .mount("/", all_routes.clone())
        .mount("/api/", all_routes)
        .manage(Mutex::new(SpotifyTokenData::new().await))
        .attach(DbConn::fairing())
        .attach(cors::CorsFairing)
        .attach(Compression::fairing())
        .launch()
        .await
        .expect("Error launching Rocket");
    info!("Rocket exited cleanly");
}
