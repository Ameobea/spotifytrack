use chrono;

pub(crate) struct SpotifyTokenData {
    pub token: String,
    pub expiry: chrono::DateTime<chrono::Local>,
}

impl SpotifyTokenData {
    #[allow(clippy::new_without_default)]
    pub(crate) async fn new() -> Self {
        let mut s = SpotifyTokenData {
            token: "".into(),
            expiry: chrono::Local::now(),
        };
        s.refresh()
            .await
            .expect("Failed to fetch initial spotify token for Rocket managed state");
        s
    }

    pub(crate) async fn refresh(&mut self) -> Result<(), String> {
        let crate::models::AccessTokenResponse {
            access_token,
            expires_in,
            ..
        } = crate::spotify_api::fetch_auth_token().await?;
        self.token = access_token;
        info!(
            "Got new Spotify access token; expires in: {} seconds",
            expires_in
        );
        self.expiry = chrono::Local::now() + chrono::Duration::seconds((expires_in as i64) - 10);
        info!("Current Spotify access token is good until {}", self.expiry);
        Ok(())
    }

    pub(crate) async fn get(&mut self) -> Result<String, String> {
        let now = chrono::Local::now();
        if now > self.expiry {
            info!(
                "Current token expired at {} (it's {} now); refreshing...",
                self.expiry, now
            );
            self.refresh().await?;
        }
        info!(
            "Current token doesn't expire until {} and is still valid.",
            self.expiry
        );
        Ok(self.token.clone())
    }
}
