use std::collections::HashMap;
use std::default::Default;
use std::vec;

use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::{artist_history, track_history, users};

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

#[derive(Serialize, Insertable, Associations)]
#[belongs_to(User)]
#[table_name = "track_history"]
pub struct NewTrackHistoryEntry {
    pub user_id: i64,
    pub spotify_id: String,
    pub update_time: NaiveDateTime,
    pub timeframe: u8,
    pub ranking: u16,
}

#[derive(Serialize, Queryable, Associations)]
#[belongs_to(User)]
#[table_name = "track_history"]
pub struct TrackHistoryEntry {
    pub id: i64,
    pub user_id: i64,
    pub update_time: NaiveDateTime,
    pub spotify_id: String,
    pub timeframe: u8,
    pub ranking: u16,
}

#[derive(Serialize, Insertable, Associations)]
#[belongs_to(User)]
#[table_name = "artist_history"]
pub struct NewArtistHistoryEntry {
    pub user_id: i64,
    pub spotify_id: String,
    pub update_time: NaiveDateTime,
    pub timeframe: u8,
    pub ranking: u16,
}

#[derive(Serialize, Queryable, Associations, Debug)]
#[belongs_to(User)]
#[table_name = "artist_history"]
pub struct ArtistHistoryEntry {
    pub id: i64,
    pub user_id: i64,
    pub update_time: NaiveDateTime,
    pub spotify_id: String,
    pub timeframe: u8,
    pub ranking: u16,
}

impl Default for ArtistHistoryEntry {
    fn default() -> Self {
        ArtistHistoryEntry {
            id: 0,
            user_id: 0,
            update_time: Utc::now().naive_utc(),
            spotify_id: "".into(),
            timeframe: 0,
            ranking: 0,
        }
    }
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

    pub fn add_item_by_id(&mut self, timeframe_id: u8, item: T) {
        let collection = match timeframe_id {
            0 => &mut self.short,
            1 => &mut self.medium,
            2 => &mut self.long,
            _ => panic!("Invalid timeframe id passed to `TimeFrames::add_item_by_id`"),
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

impl<'a, T: Serialize> TimeFrames<T> {
    pub fn iter(&'a self) -> impl Iterator<Item = (&'static str, &'a Vec<T>)> {
        vec![
            ("short", &self.short),
            ("medium", &self.medium),
            ("long", &self.long),
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

impl StatsSnapshot {
    pub fn new(last_update_time: NaiveDateTime) -> Self {
        StatsSnapshot {
            last_update_time,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Followers {
    pub href: Option<String>,
    pub total: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Image {
    pub height: Option<usize>,
    pub url: String,
    pub width: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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

#[derive(Clone, Deserialize, Debug)]
pub struct TopTracksResponse {
    pub items: Vec<Track>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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

#[derive(Clone, Deserialize, Debug)]
pub struct TopArtistsResponse {
    pub items: Vec<Artist>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserProfile {
    pub display_name: String,
    pub followers: Followers,
    pub href: String,
    pub images: Vec<Image>,
    pub id: String,
    pub uri: String,
}

// {
//     "error": {
//         "status": 401,
//         "message": "Invalid access token"
//     }
// }
#[derive(Deserialize, Clone, Debug)]
pub struct SpotifyBatchArtistsResponse {
    pub artists: Vec<Artist>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct SpotifyErrorInner {
    status: Option<i32>,
    message: Option<String>,
    #[serde(flatten)]
    other: HashMap<String, Value>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct SpotifyError {
    pub error: SpotifyErrorInner,
    #[serde(flatten)]
    other: HashMap<String, Value>,
}

#[serde(untagged)]
#[derive(Deserialize, Clone, Debug)]
#[serde(bound = "T: for<'d> ::serde::Deserialize<'d>")]
pub enum SpotifyResponse<T: std::fmt::Debug + Clone> {
    Success(T),
    Error(SpotifyError),
}

impl<T: for<'de> Deserialize<'de> + std::fmt::Debug + Clone> std::ops::Try for SpotifyResponse<T> {
    type Ok = T;
    type Error = String;

    fn into_result(self) -> Result<Self::Ok, String> {
        match self {
            SpotifyResponse::Success(val) => Ok(val),
            SpotifyResponse::Error(err) => {
                error!("Error fetching data from Spotify API: {:?}", err);

                Err(err
                    .error
                    .message
                    .unwrap_or_else(|| -> String { "No error message supplied".into() }))
            }
        }
    }

    fn from_error(err_msg: String) -> Self {
        SpotifyResponse::Error(SpotifyError {
            error: SpotifyErrorInner {
                status: None,
                message: Some(err_msg),
                other: HashMap::new(),
            },
            other: HashMap::new(),
        })
    }

    fn from_ok(val: T) -> Self {
        SpotifyResponse::Success(val)
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct SpotifyBatchTracksResponse {
    pub tracks: Vec<Track>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct AccessTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: usize,
}
