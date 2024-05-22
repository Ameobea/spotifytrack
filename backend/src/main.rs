#![feature(proc_macro_hygiene, decl_macro, box_patterns, try_trait_v2)]
#![allow(clippy::identity_conversion)]

#[macro_use]
extern crate diesel;
#[macro_use]
extern crate serde_derive;
#[macro_use]
extern crate rocket;

use std::time::Duration;

use artist_embedding::{init_artist_embedding_ctx, map_3d::get_packed_3d_artist_coords};
use foundations::telemetry::{
    settings::{MetricsSettings, ServiceNameFormat, TelemetryServerSettings, TelemetrySettings},
    tokio_runtime_metrics::record_runtime_metrics_sample,
};
// use rocket_async_compression::Compression;
use tokio::sync::Mutex;

pub mod artist_embedding;
pub mod benchmarking;
pub mod cache;
pub mod conf;
pub mod cors;
pub mod db_util;
pub mod external_storage;
pub mod metrics;
pub mod models;
pub mod routes;
pub mod schema;
pub mod shared_playlist_gen;
pub mod spotify_api;
pub mod spotify_token;
pub mod stats;

use crate::{cache::local_cache::init_spotify_id_map_cache, conf::CONF};

use self::spotify_token::SpotifyTokenData;

#[rocket_sync_db_pools::database("spotify_homepage")]
pub struct DbConn(diesel::MysqlConnection);

#[rocket::main]
pub async fn main() {
    dotenv::dotenv().expect("dotenv file parsing failed");

    let tele_serv_fut = foundations::telemetry::init_with_server(
        &foundations::service_info!(),
        &TelemetrySettings {
            metrics: MetricsSettings {
                service_name_format: ServiceNameFormat::default(),
                report_optional: true,
            },
            server: TelemetryServerSettings {
                enabled: true,
                addr: format!("0.0.0.0:{}", CONF.telemetry_server_port)
                    .parse()
                    .unwrap(),
            },
        },
        Vec::new(),
    )
    .expect("Failed to initialize telemetry server");
    let tele_serv_addr = tele_serv_fut.server_addr().unwrap();
    println!("Telemetry server is listening on http://{}", tele_serv_addr);
    tokio::task::spawn(tele_serv_fut);

    let handle = tokio::runtime::Handle::current();
    foundations::telemetry::tokio_runtime_metrics::register_runtime(None, None, &handle);
    println!("Registered tokio runtime metrics");

    tokio::task::spawn(async move {
        loop {
            record_runtime_metrics_sample();

            // record metrics roughly twice a second
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });

    tokio::task::spawn(init_spotify_id_map_cache());
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
        routes::get_packed_artist_relationships_by_internal_ids,
        routes::get_preview_urls_by_internal_id,
        routes::get_top_artists_internal_ids_for_user,
        routes::get_artist_relationships_chunk,
        routes::transfer_user_data_to_external_storage,
        routes::transfer_user_data_from_external_storage,
        routes::bulk_transfer_user_data_to_external_storage,
    ];

    // Pre-populate the packed 3D artist map embedding to make the first request for it instant
    // tokio::task::spawn(async {
    //     get_packed_3d_artist_coords().await;
    // });

    let builder = rocket::build()
        .mount("/", all_routes.clone())
        .mount("/api/", all_routes)
        .manage(Mutex::new(SpotifyTokenData::new().await))
        .attach(DbConn::fairing())
        .attach(cors::CorsFairing);

    builder.launch().await.expect("Error launching Rocket");
    info!("Rocket exited cleanly");
}
