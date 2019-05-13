use crate::schema::{artist_history, track_history, users};
use chrono::{NaiveDateTime, Utc};
use serde::Serialize;
use std::default::Default;
use std::vec;


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

#[derive(Serialize, Queryable, Clone, Debug)]
pub struct User {
    pub id: i64,
    pub creation_time: NaiveDateTime,
    pub last_update_time: NaiveDateTime,
    pub spotify_id: String,
    pub username: String,
    pub token: String,
    pub refresh_token: String,
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

impl<T: Serialize> TimeFrames<T> {
    pub fn add_item(&mut self, timeframe: &str, item: T) {
        let collection = match timeframe {
            "short" => &mut self.short,
            "medium" => &mut self.medium,
            "long" => &mut self.long,
            _ => panic!("Invalid timeframe passed to `TimeFrames::add_item`"),
        };

        collection.push(item);
    }
}

impl<T: Serialize> Default for TimeFrames<T> {
    fn default() -> Self {
        TimeFrames {
            short: Vec::new(),
            medium: Vec::new(),
            long: Vec::new(),
        }
    }
}

impl<T: Serialize> IntoIterator for TimeFrames<T> {
    type Item = (&'static str, Vec<T>);
    type IntoIter = vec::IntoIter<Self::Item>;

    fn into_iter(self) -> Self::IntoIter {
        vec![
            ("short", self.short),
            ("medium", self.medium),
            ("long", self.long),
        ]
        .into_iter()
    }
}

#[derive(Serialize)]
pub struct StatsSnapshot {
    pub last_update_time: NaiveDateTime,
    pub tracks: TimeFrames<Track>,
    pub artists: TimeFrames<Artist>,
}

impl Default for StatsSnapshot {
    fn default() -> Self {
        StatsSnapshot {
            last_update_time: Utc::now().naive_utc(),
            tracks: TimeFrames::default(),
            artists: TimeFrames::default(),
        }
    }
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
    },
}

#[derive(Serialize, Deserialize)]
pub struct Followers {
    pub href: Option<String>,
    pub total: usize,
}

#[derive(Serialize, Deserialize)]
pub struct Image {
    pub height: Option<usize>,
    pub url: String,
    pub width: Option<usize>,
}

#[derive(Serialize, Deserialize)]
pub struct Album {
    pub album_group: Option<String>,
    pub album_type: String,
    pub artists: Vec<Artist>,
    pub available_markets: Vec<String>,
    pub href: String,
    pub id: String,
    pub images: Vec<Image>,
    pub name: String,
    pub release_date: String,
    pub release_date_precision: String,
    pub uri: String,
}

#[derive(Deserialize)]
pub struct TopTracksResponse {
    pub items: Vec<Track>,
}

#[derive(Serialize, Deserialize)]
pub struct Track {
    pub album: Album,
    pub available_markets: Vec<String>,
    pub disc_number: usize,
    pub duration_ms: usize,
    pub explicit: bool,
    pub href: Option<String>,
    pub id: String,
    pub is_playable: Option<bool>,
    pub name: String,
    pub popularity: usize,
    pub preview_url: Option<String>,
    pub track_number: usize,
    pub uri: String,
}

#[derive(Deserialize)]
pub struct TopArtistsResponse {
    pub items: Vec<Artist>,
}

#[derive(Serialize, Deserialize)]
pub struct Artist {
    pub followers: Option<Followers>,
    pub genres: Option<Vec<String>>,
    pub href: String,
    pub id: String,
    pub images: Option<Vec<Image>>,
    pub name: String,
    pub popularity: Option<usize>,
    pub uri: String,
}

#[derive(Serialize, Deserialize)]
pub struct UserProfile {
    pub display_name: String,
    pub followers: Followers,
    pub href: String,
    pub images: Vec<Image>,
    pub id: String,
    pub uri: String,
}
