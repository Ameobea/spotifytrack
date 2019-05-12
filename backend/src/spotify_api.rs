use diesel::prelude::*;
use reqwest;

use crate::models::{StatsSnapshot, User};
use crate::DbConn;

const SPOTIFY_USER_STATS_URL: &str = "https://api.spotify.com/v1/me/player/recently-played";

pub fn fetch_cur_stats(conn: DbConn, a_username: &str) -> Result<Option<StatsSnapshot>, String> {
    use crate::schema::users::dsl::*;

    // Fetch the user's token from the database
    let query_res = users
        .limit(1)
        .filter(username.eq(a_username))
        .load::<User>(&conn.0)
        .map_err(|_| -> String { "Error loading current user from the database.".into() })?;
    let user_data_opt = query_res.first();

    let user_data = match user_data_opt {
        Some(user_data) => user_data,
        None => {
            return Ok(None);
        }
    };

    // Use the user's token to fetch their current stats
    let client = reqwest::Client::new();
    let mut res = client
        .get(SPOTIFY_USER_STATS_URL)
        .bearer_auth(&user_data.token)
        .send()
        .map_err(|_err| -> String {
            "Error requesting latest user stats from the Spotify API".into()
        })?;

    println!("{}", res.text().unwrap());

    Ok(None)
}
