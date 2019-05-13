use std::vec;

use chrono::NaiveDateTime;
use serde::Serialize;

use crate::schema::{users, track_history, artist_history};

#[derive(Insertable)]
#[table_name = "users"]
pub struct NewUser {
    pub creation_time: NaiveDateTime,
    pub last_update_time: NaiveDateTime,
    pub spotify_id: String,
    pub username: String,
    pub token: String,
    pub refresh_token: String,
}

#[derive(Serialize, Queryable, Debug)]
pub struct User {
    pub id: i64,
    pub creation_time: NaiveDateTime,
    pub last_update_time: NaiveDateTime,
    pub spotify_id: String,
    pub username: String,
    pub token: String,
    pub refresh_token: String,
}

#[derive(Serialize)]
pub struct Track {
    pub id: i64,
    pub spotify_id: String,
    pub title: String,
    pub artists: String,
    pub preview_url: String,
    pub album: String,
    pub image_url: String,
}

#[derive(Serialize, Insertable, Queryable, Associations)]
#[belongs_to(User)]
#[table_name = "track_history"]
pub struct NewTrackHistoryEntry {
    pub user_id: i64,
    pub spotify_id: String,
    pub timeframe: u8,
    pub ranking: u16,
}

#[derive(Serialize)]
pub struct Artist {
    pub id: i64,
    pub spotify_id: String,
    pub name: String,
    pub genres: String,
    pub image_url: String,
    pub uri: String,
}

#[derive(Serialize, Insertable, Queryable, Associations)]
#[belongs_to(User)]
#[table_name = "artist_history"]
pub struct NewArtistHistoryEntry {
    pub user_id: i64,
    pub spotify_id: String,
    pub timeframe: u8,
    pub ranking: u16,
}

#[derive(Serialize)]
pub struct TimeFrames<T: Serialize> {
    pub short: Vec<T>,
    pub medium: Vec<T>,
    pub long: Vec<T>,
}

impl<T: Serialize> IntoIterator for TimeFrames<T> {
    type Item = (&'static str, Vec<T>);
    type IntoIter = vec::IntoIter<Self::Item>;

    fn into_iter(self) -> Self::IntoIter {
        vec![("short", self.short), ("medium", self.medium), ("long", self.long)].into_iter()
    }
}

#[derive(Serialize)]
pub struct StatsSnapshot {
    pub last_update_time: NaiveDateTime,
    pub tracks: TimeFrames<Track>,
    pub artists: TimeFrames<Artist>,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum OAuthTokenResponse {
    Success {
        access_token: String,
        token_type: String,
        scope: String,
        expires_in: isize,
        refresh_token: String,
    },
    Error {
        error: String,
        error_description: String,
    }
}
