use chrono;

pub struct SpotifyTokenData {
    pub token: String,
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
        let crate::models::AccessTokenResponse {
            access_token,
            expires_in,
            ..
        } = crate::spotify_api::fetch_auth_token()?;
        self.token = access_token;
        info!(
            "Got new Spotify access token; expires in: {} seconds",
            expires_in
        );
        self.expiry = chrono::Local::now() + chrono::Duration::seconds((expires_in as i64) - 10);
        info!("Current Spotify access token is good until {}", self.expiry);
        Ok(())
    }

    pub fn get(&mut self) -> Result<&str, String> {
        let now = chrono::Local::now();
        if now > self.expiry {
            info!(
                "Current token expired at {} (it's {} now); refreshing...",
                self.expiry, now
            );
            self.refresh()?;
        }
        info!(
            "Current token doesn't expire until {} and is still valid.",
            self.expiry
        );
        Ok(&self.token)
    }
}
