use std::env;

use base64;
use chrono::Duration;

pub(crate) struct Conf {
    pub client_id: String,
    pub client_secret: String,
    pub api_server_url: String,
    pub website_url: String,
    pub redis_url: String,
    // Internal Config
    pub artists_cache_hash_name: String,
    pub tracks_cache_hash_name: String,
    // Scraper config
    pub min_update_interval: Duration,
    pub admin_api_token: String,
    pub telemetry_server_port: u16,
}

impl Conf {
    pub(crate) fn build_from_env() -> Self {
        dotenv::dotenv().expect("dotenv file parsing failed");

        Conf {
            client_id: env::var("SPOTIFY_CLIENT_ID")
                .expect("The `SPOTIFY_CLIENT_ID` environment variable must be set."),
            client_secret: env::var("SPOTIFY_CLIENT_SECRET")
                .expect("The `SPOTIFY_CLIENT_SECRET` environment variable must be set."),
            api_server_url: env::var("API_SERVER_URL")
                .expect("The `API_SERVER_URL` environment variable must be set."),
            website_url: env::var("WEBSITE_URL").expect("The `WEBSITE_URL` must be set."),
            redis_url: env::var("REDIS_URL")
                .expect("The `REDIS_URL` environment variable must be set."),
            artists_cache_hash_name: "artists".into(),
            tracks_cache_hash_name: "tracks".into(),
            min_update_interval: Duration::seconds(
                env::var("MIN_UPDATE_INTERVAL_SECONDS")
                    .unwrap_or_else(|_| -> String { (60 * 60 * 6).to_string() })
                    .parse()
                    .expect(
                        "Invalid value provided for `MIN_UPDATE_INTERVAL_SECONDS`; must be an \
                         unsigned integer",
                    ),
            ),
            admin_api_token: env::var("ADMIN_API_TOKEN")
                .expect("The `ADMIN_API_TOKEN` environment variable must be set"),
            telemetry_server_port: env::var("TELEMETRY_SERVER_PORT")
                .unwrap_or_else(|_| -> String { "4101".to_string() })
                .parse()
                .expect("Invalid value provided for `TELEMETRY_SERVER_PORT`; must be a u16"),
        }
    }

    pub(crate) fn get_absolute_oauth_cb_uri(&self) -> String {
        format!("{}/oauth_cb", CONF.api_server_url)
    }

    pub(crate) fn get_authorization_header_content(&self) -> String {
        format!(
            "Basic {}",
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &format!("{}:{}", self.client_id, self.client_secret)
            )
        )
    }
}

lazy_static::lazy_static! {
    pub(crate) static ref CONF: Conf = Conf::build_from_env();
}
