use std::env;

pub struct Conf {
    pub client_id: String,
    pub client_secret: String,
    pub server_base_url: String,
    pub redis_url: String,
    // Internal Config
    pub artists_cache_hash_name: String,
    pub tracks_cache_hash_name: String,
}

impl Conf {
    pub fn build_from_env() -> Self {
        dotenv::dotenv().expect("dotenv file parsing failed");

        Conf {
            client_id: env::var("SPOTIFY_CLIENT_ID")
                .expect("The `SPOTIFY_CLIENT_ID` environment variable must be set."),
            client_secret: env::var("SPOTIFY_CLIENT_SECRET")
                .expect("The `SPOTIFY_CLIENT_SECRET` environment variable must be set."),
            server_base_url: env::var("SERVER_BASE_URL")
                .expect("The `SERVER_BASE_URL` environment variable must be set."),
            redis_url: env::var("REDIS_URL")
                .expect("The `REDIS_URL` environment variable must be set."),
            artists_cache_hash_name: "artists".into(),
            tracks_cache_hash_name: "tracks".into(),
        }
    }

    pub fn build_redirect_uri(&self) -> String {
        format!("{}/oauth_cb", self.server_base_url)
    }
}

lazy_static! {
    pub static ref CONF: Conf = Conf::build_from_env();
}
