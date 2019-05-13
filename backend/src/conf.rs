use std::env;

pub struct Conf {
    pub client_id: String,
    pub client_secret: String,
    pub server_base_url: String,
    // pub update_auth_token: String,
}

impl Conf {
    pub fn build_from_env() -> Self {
        Conf {
            client_id: env::var("SPOTIFY_CLIENT_ID")
                .expect("The `SPOTIFY_CLIENT_ID` environment variable must be set."),
            client_secret: env::var("SPOTIFY_CLIENT_SECRET")
                .expect("The `SPOTIFY_CLIENT_SECRET` environment variable must be set."),
            server_base_url: env::var("SERVER_BASE_URL")
                .expect("The `SERVER_BASE_URL` environment variable must be set."),
            // update_auth_token: env::var("UPDATE_AUTH_TOKEN").expect("The `UPDATE_AUTH_TOKEN` environment variable must be set."),
        }
    }

    pub fn build_redirect_uri(&self) -> String {
        format!("{}/oauth_cb", self.server_base_url)
    }
}

lazy_static! {
    pub static ref CONF: Conf = Conf::build_from_env();
}
