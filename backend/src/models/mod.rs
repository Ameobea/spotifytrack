use std::default::Default;
use std::fmt::Debug;
use std::vec;

use chrono::{NaiveDate, NaiveDateTime};
use fnv::FnvHashMap as HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::{
    artist_rank_snapshots, artists_genres, spotify_items, track_rank_snapshots, tracks_artists,
    users,
};

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
#[table_name = "track_rank_snapshots"]
pub struct NewTrackHistoryEntry {
    pub user_id: i64,
    pub mapped_spotify_id: i32,
    pub update_time: NaiveDateTime,
    pub timeframe: u8,
    pub ranking: u16,
}

#[derive(Serialize, Insertable, Associations)]
#[belongs_to(User)]
#[table_name = "artist_rank_snapshots"]
pub struct NewArtistHistoryEntry {
    pub user_id: i64,
    pub mapped_spotify_id: i32,
    pub update_time: NaiveDateTime,
    pub timeframe: u8,
    pub ranking: u16,
}

#[derive(Serialize, Associations, Debug, Queryable)]
#[table_name = "spotify_items"]
pub struct SpotifyIdMapping {
    pub id: i32,
    pub spotify_id: String,
}

#[derive(Serialize, Insertable)]
#[table_name = "spotify_items"]
pub struct NewSpotifyIdMapping<'a> {
    pub spotify_id: &'a str,
}

#[derive(Insertable)]
#[table_name = "tracks_artists"]
pub struct TrackArtistPair {
    pub track_id: i32,
    pub artist_id: i32,
}

#[derive(Insertable)]
#[table_name = "artists_genres"]
pub struct ArtistGenrePair {
    pub artist_id: i32,
    pub genre: String,
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

    pub fn set(&mut self, timeframe: &str, items: Vec<T>) {
        let collection = match timeframe {
            "short" => &mut self.short,
            "medium" => &mut self.medium,
            "long" => &mut self.long,
            _ => panic!("Invalid timeframe passed to `TimeFrames::add_item`"),
        };

        *collection = items;
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

    pub fn map<U: Serialize>(self, pred: fn(val: T) -> U) -> TimeFrames<U> {
        TimeFrames {
            short: self.short.into_iter().map(pred).collect(),
            medium: self.medium.into_iter().map(pred).collect(),
            long: self.long.into_iter().map(pred).collect(),
        }
    }

    pub fn flat_map<U: Serialize, I: Iterator<Item = TimeFrames<T>>>(
        timeframes: I,
        pred: fn(items: Vec<T>) -> U,
    ) -> TimeFrames<U> {
        let mut short = Vec::new();
        let mut medium = Vec::new();
        let mut long = Vec::new();

        for timeframe in timeframes {
            short.push(pred(timeframe.short));
            medium.push(pred(timeframe.medium));
            long.push(pred(timeframe.long));
        }

        TimeFrames {
            short,
            medium,
            long,
        }
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

impl<T: Serialize> Debug for TimeFrames<T>
where
    T: Debug,
{
    fn fmt(&self, fmt: &mut std::fmt::Formatter) -> std::fmt::Result {
        fmt.debug_struct("TimeFrames")
            .field("short", &self.short)
            .field("medium", &self.medium)
            .field("long", &self.long)
            .finish()
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
    #[serde(skip_serializing)]
    pub height: Option<usize>,
    pub url: String,
    #[serde(skip_serializing)]
    pub width: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Album {
    #[serde(skip_serializing)]
    pub album_group: Option<String>,
    #[serde(skip_serializing)]
    pub album_type: String,
    pub artists: Vec<Artist>,
    #[serde(skip_serializing)]
    pub available_markets: Vec<String>,
    #[serde(skip_serializing)]
    pub href: String,
    pub id: String,
    pub images: Vec<Image>,
    pub name: String,
    #[serde(skip_serializing)]
    pub release_date: String,
    #[serde(skip_serializing)]
    pub release_date_precision: String,
    #[serde(skip_serializing)]
    pub uri: String,
}

#[derive(Clone, Deserialize, Debug)]
pub struct TopTracksResponse {
    pub items: Vec<Track>,
}

#[derive(Queryable)]
pub struct StatsHistoryQueryResItem {
    pub spotify_id: String,
    pub update_time: NaiveDateTime,
    pub ranking: u16,
    pub timeframe: u8,
}

#[derive(Queryable)]
pub struct ArtistRankHistoryResItem {
    pub update_time: NaiveDateTime,
    pub ranking: u16,
    pub timeframe: u8,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Track {
    pub album: Album,
    pub artists: Vec<Artist>,
    #[serde(skip_serializing)]
    pub available_markets: Vec<String>,
    #[serde(skip_serializing)]
    pub disc_number: usize,
    #[serde(skip_serializing)]
    pub duration_ms: usize,
    #[serde(skip_serializing)]
    pub explicit: bool,
    #[serde(skip_serializing)]
    pub href: Option<String>,
    pub id: String,
    #[serde(skip_serializing)]
    pub is_playable: Option<bool>,
    pub name: String,
    #[serde(skip_serializing)]
    pub popularity: usize,
    pub preview_url: Option<String>,
    #[serde(skip_serializing)]
    pub track_number: usize,
    #[serde(skip_serializing)]
    pub uri: String,
}

#[derive(Clone, Deserialize, Debug)]
pub struct TopArtistsResponse {
    pub items: Vec<Artist>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Artist {
    #[serde(skip_serializing)]
    pub followers: Option<Followers>,
    pub genres: Option<Vec<String>>,
    #[serde(skip_serializing)]
    pub href: String,
    pub id: String,
    pub images: Option<Vec<Image>>,
    pub name: String,
    #[serde(skip_serializing)]
    pub popularity: Option<usize>,
    #[serde(skip_serializing)]
    pub uri: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserProfile {
    pub display_name: String,
    #[serde(skip_serializing)]
    pub followers: Followers,
    #[serde(skip_serializing)]
    pub href: String,
    pub images: Vec<Image>,
    pub id: String,
    #[serde(skip_serializing)]
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
                other: HashMap::default(),
            },
            other: HashMap::default(),
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

pub trait HasSpotifyId {
    fn get_spotify_id(&self) -> &str;
}

impl HasSpotifyId for Artist {
    fn get_spotify_id(&self) -> &str {
        &self.id
    }
}

impl HasSpotifyId for Track {
    fn get_spotify_id(&self) -> &str {
        &self.id
    }
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub enum TimelineEventType {
    #[serde(rename = "firstUpdate")]
    FirstUpdate,
    #[serde(rename = "artistFirstSeen")]
    ArtistFirstSeen { artist: Artist },
    #[serde(rename = "topTrackFirstSeen")]
    TopTrackFirstSeen { track: Track },
}

#[derive(Serialize)]
pub struct TimelineEvent {
    pub date: NaiveDate,
    pub id: usize,
    #[serde(flatten)]
    pub event_type: TimelineEventType,
}

#[derive(Serialize)]
pub struct Timeline {
    pub events: Vec<TimelineEvent>,
}
