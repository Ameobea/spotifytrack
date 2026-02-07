use std::{default::Default, fmt::Debug, vec};

use chrono::{NaiveDate, NaiveDateTime};
use float_ord::FloatOrd;
use fnv::FnvHashMap as HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::{
    artist_rank_snapshots, artists_genres, related_artists, spotify_items, track_rank_snapshots,
    tracks_artists, users,
};

#[derive(Insertable)]
#[diesel(table_name = users)]
pub(crate) struct NewUser {
    pub creation_time: NaiveDateTime,
    pub last_update_time: NaiveDateTime,
    pub spotify_id: String,
    pub username: String,
    pub token: String,
    pub refresh_token: String,
}

#[derive(Serialize, Queryable, Clone, Debug)]
pub(crate) struct User {
    pub id: i64,
    pub creation_time: NaiveDateTime,
    pub last_update_time: NaiveDateTime,
    pub spotify_id: String,
    pub username: String,
    pub token: String,
    pub refresh_token: String,
    pub external_data_retrieved: bool,
    pub last_viewed: NaiveDateTime,
    pub last_external_data_store: NaiveDateTime,
}

#[derive(Serialize, Insertable, Associations)]
#[diesel(belongs_to(User))]
#[diesel(table_name = track_rank_snapshots)]
pub(crate) struct NewTrackHistoryEntry {
    pub user_id: i64,
    pub mapped_spotify_id: i32,
    pub update_time: NaiveDateTime,
    pub timeframe: u8,
    pub ranking: u8,
}

#[derive(Serialize, Insertable, Associations)]
#[diesel(belongs_to(User))]
#[diesel(table_name = artist_rank_snapshots)]
pub(crate) struct NewArtistHistoryEntry {
    pub user_id: i64,
    pub mapped_spotify_id: i32,
    pub update_time: NaiveDateTime,
    pub timeframe: u8,
    pub ranking: u8,
}

#[derive(Queryable)]
pub(crate) struct UserHistoryEntry {
    pub id: i64,
    pub user_id: i64,
    pub update_time: NaiveDateTime,
    pub mapped_spotify_id: i32,
    pub timeframe: u8,
    pub ranking: u8,
}

#[derive(Clone, Insertable)]
#[diesel(table_name = track_rank_snapshots)]
pub(crate) struct TrackHistoryEntry {
    pub id: i64,
    pub user_id: i64,
    pub update_time: NaiveDateTime,
    pub mapped_spotify_id: i32,
    pub timeframe: u8,
    pub ranking: u8,
}

#[derive(Clone, Insertable)]
#[diesel(table_name = artist_rank_snapshots)]
pub(crate) struct ArtistHistoryEntry {
    pub id: i64,
    pub user_id: i64,
    pub update_time: NaiveDateTime,
    pub mapped_spotify_id: i32,
    pub timeframe: u8,
    pub ranking: u8,
}

impl From<ArtistHistoryEntry> for UserHistoryEntry {
    fn from(entry: ArtistHistoryEntry) -> Self {
        UserHistoryEntry {
            id: entry.id,
            user_id: entry.user_id,
            update_time: entry.update_time,
            mapped_spotify_id: entry.mapped_spotify_id,
            timeframe: entry.timeframe,
            ranking: entry.ranking,
        }
    }
}

impl From<TrackHistoryEntry> for UserHistoryEntry {
    fn from(entry: TrackHistoryEntry) -> Self {
        UserHistoryEntry {
            id: entry.id,
            user_id: entry.user_id,
            update_time: entry.update_time,
            mapped_spotify_id: entry.mapped_spotify_id,
            timeframe: entry.timeframe,
            ranking: entry.ranking,
        }
    }
}

#[derive(Serialize, Debug, Queryable)]
pub(crate) struct SpotifyIdMapping {
    pub id: i32,
    pub spotify_id: String,
}

#[derive(Clone, Serialize, Insertable)]
#[diesel(table_name = spotify_items)]
pub struct NewSpotifyIdMapping {
    pub spotify_id: String,
}

#[derive(Insertable)]
#[diesel(table_name = tracks_artists)]
pub(crate) struct TrackArtistPair {
    pub track_id: i32,
    pub artist_id: i32,
}

#[derive(Insertable)]
#[diesel(table_name = artists_genres)]
pub(crate) struct ArtistGenrePair {
    pub artist_id: i32,
    pub genre: String,
}

#[derive(Serialize)]
pub(crate) struct TimeFrames<T: Serialize> {
    pub short: Vec<T>,
    pub medium: Vec<T>,
    pub long: Vec<T>,
}

impl<T: Serialize> TimeFrames<T> {
    pub(crate) fn add_item(&mut self, timeframe: &str, item: T) {
        let collection = match timeframe {
            "short" => &mut self.short,
            "medium" => &mut self.medium,
            "long" => &mut self.long,
            _ => panic!("Invalid timeframe passed to `TimeFrames::add_item`"),
        };

        collection.push(item);
    }

    pub(crate) fn add_item_by_id(&mut self, timeframe_id: u8, item: T) {
        let collection = match timeframe_id {
            0 => &mut self.short,
            1 => &mut self.medium,
            2 => &mut self.long,
            _ => panic!("Invalid timeframe id passed to `TimeFrames::add_item_by_id`"),
        };

        collection.push(item);
    }

    pub(crate) fn flat_map<U: Serialize, I: Iterator<Item = TimeFrames<T>>>(
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
    type IntoIter = vec::IntoIter<Self::Item>;
    type Item = (&'static str, Vec<T>);

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
    pub(crate) fn iter(&'a self) -> impl Iterator<Item = (&'static str, &'a Vec<T>)> {
        vec![
            ("short", &self.short),
            ("medium", &self.medium),
            ("long", &self.long),
        ]
        .into_iter()
    }
}

#[derive(Serialize)]
pub(crate) struct StatsSnapshot {
    pub last_update_time: NaiveDateTime,
    pub tracks: TimeFrames<Track>,
    pub artists: TimeFrames<Artist>,
}

impl StatsSnapshot {
    pub(crate) fn new(last_update_time: NaiveDateTime) -> Self {
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
pub(crate) struct Followers {
    pub href: Option<String>,
    pub total: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Image {
    // pub height: Option<usize>,
    pub url: String,
    // pub width: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Album {
    // pub album_group: Option<String>,
    // pub album_type: String,
    pub artists: Vec<Artist>,
    // pub available_markets: Vec<String>,
    // pub href: String,
    pub id: String,
    pub images: Vec<Image>,
    pub name: String,
    /* pub release_date: String,
     * pub release_date_precision: String,
     * pub uri: String, */
}

#[derive(Clone, Deserialize, Debug)]
pub(crate) struct TopTracksResponse {
    pub items: Vec<Option<Track>>,
}

#[derive(Queryable, QueryableByName)]
pub(crate) struct StatsHistoryQueryResItem {
    #[diesel(sql_type = diesel::sql_types::Text)]
    pub spotify_id: String,
    #[diesel(sql_type = diesel::sql_types::Datetime)]
    pub update_time: NaiveDateTime,
    #[diesel(sql_type = diesel::sql_types::Unsigned<diesel::sql_types::TinyInt>)]
    pub ranking: u8,
    #[diesel(sql_type = diesel::sql_types::Unsigned<diesel::sql_types::TinyInt>)]
    pub timeframe: u8,
}

#[derive(Queryable)]
pub(crate) struct ArtistRankHistoryResItem {
    pub update_time: NaiveDateTime,
    pub ranking: u8,
    pub timeframe: u8,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Track {
    pub album: Album,
    pub artists: Vec<Artist>,
    // pub available_markets: Vec<String>,
    // pub disc_number: usize,
    // pub duration_ms: usize,
    // pub explicit: bool,
    // pub href: Option<String>,
    pub id: String,
    // pub is_playable: Option<bool>,
    pub name: String,
    // pub popularity: usize,
    pub preview_url: Option<String>,
    /* pub track_number: usize,
     * pub uri: String, */
}

impl Track {
    pub fn new_unknown() -> Self {
        Track {
            album: Album {
                artists: Vec::new(),
                id: String::new(),
                images: Vec::new(),
                name: "Unknown Album".to_owned(),
            },
            artists: Vec::new(),
            id: String::new(),
            name: "Unknown Track".to_owned(),
            preview_url: None,
        }
    }
}

#[derive(Clone, Deserialize, Debug)]
pub(crate) struct TopArtistsResponse {
    pub items: Vec<Artist>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Artist {
    // pub followers: Option<Followers>,
    pub genres: Option<Vec<String>>,
    // pub href: String,
    pub id: String,
    pub images: Option<Vec<Image>>,
    pub name: String,
    pub popularity: Option<usize>,
    // pub uri: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct UserProfile {
    pub display_name: String,
    // pub followers: Followers,
    // pub href: String,
    pub images: Vec<Image>,
    pub id: String,
    // pub uri: String,
}

// {
//     "error": {
//         "status": 401,
//         "message": "Invalid access token"
//     }
// }
#[derive(Deserialize, Clone, Debug)]
pub(crate) struct SpotifyBatchArtistsResponse {
    pub artists: Vec<Artist>,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct SpotifyErrorInner {
    status: Option<i32>,
    message: Option<String>,
    #[serde(flatten)]
    other: HashMap<String, Value>,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct SpotifyError {
    pub error: SpotifyErrorInner,
    #[serde(flatten)]
    other: HashMap<String, Value>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(bound = "T: for<'d> ::serde::Deserialize<'d>")]
#[serde(untagged)]
pub(crate) enum SpotifyResponse<T: std::fmt::Debug + Clone> {
    Success(T),
    Error(SpotifyError),
}

impl<T: for<'de> Deserialize<'de> + std::fmt::Debug + Clone> SpotifyResponse<T> {
    pub fn into_result(self) -> Result<T, String> {
        match self {
            Self::Success(val) => Ok(val),
            Self::Error(err) => Err(err
                .error
                .message
                .unwrap_or_else(|| -> String { "No error message supplied".into() })),
        }
    }
}

impl<T: for<'de> Deserialize<'de> + std::fmt::Debug + Clone> std::ops::FromResidual
    for SpotifyResponse<T>
{
    fn from_residual(err_msg: String) -> Self {
        SpotifyResponse::Error(SpotifyError {
            error: SpotifyErrorInner {
                status: None,
                message: Some(err_msg),
                other: HashMap::default(),
            },
            other: HashMap::default(),
        })
    }
}

impl<T: for<'de> Deserialize<'de> + std::fmt::Debug + Clone> std::ops::Try for SpotifyResponse<T> {
    type Output = T;
    type Residual = String;

    fn branch(self) -> std::ops::ControlFlow<Self::Residual, Self::Output> {
        match self {
            SpotifyResponse::Success(val) => std::ops::ControlFlow::Continue(val),
            SpotifyResponse::Error(err) => {
                error!("Error fetching data from Spotify API: {:?}", err);

                std::ops::ControlFlow::Break(
                    err.error
                        .message
                        .unwrap_or_else(|| -> String { "No error message supplied".into() }),
                )
            },
        }
    }

    fn from_output(val: T) -> Self { SpotifyResponse::Success(val) }
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct SpotifyBatchTracksResponse {
    pub tracks: Vec<Option<Track>>,
}

#[derive(Deserialize, Clone, Debug)]
pub(crate) struct AccessTokenResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: usize,
}

pub trait HasSpotifyId {
    fn get_spotify_id(&self) -> &str;
}

impl HasSpotifyId for Artist {
    fn get_spotify_id(&self) -> &str { &self.id }
}

impl HasSpotifyId for Track {
    fn get_spotify_id(&self) -> &str { &self.id }
}

#[derive(Serialize)]
#[serde(tag = "type")]
pub(crate) enum TimelineEventType {
    #[serde(rename = "firstUpdate")]
    FirstUpdate,
    #[serde(rename = "artistFirstSeen")]
    ArtistFirstSeen { artist: Artist },
    #[serde(rename = "topTrackFirstSeen")]
    TopTrackFirstSeen { track: Track },
}

#[derive(Serialize)]
pub(crate) struct TimelineEvent {
    pub date: NaiveDate,
    pub id: usize,
    #[serde(flatten)]
    pub event_type: TimelineEventType,
}

#[derive(Serialize)]
pub(crate) struct Timeline {
    pub events: Vec<TimelineEvent>,
}

#[derive(Serialize)]
pub(crate) struct UserComparison {
    pub tracks: Vec<Track>,
    pub artists: Vec<Artist>,
    pub genres: Vec<String>,
    pub user1_username: String,
    pub user2_username: String,
}

#[derive(Default, Debug, Clone, Deserialize)]
pub(crate) struct PlaylistExternalUrls {
    pub spotify: String,
}

#[derive(Default, Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaylistFollowers {
    pub href: Option<String>,
    pub total: i64,
}

#[derive(Default, Debug, Clone, Deserialize)]
pub(crate) struct PlaylistOwner {
    pub external_urls: PlaylistExternalUrls,
    pub href: String,
    pub id: String,
    #[serde(rename = "type")]
    pub type_field: String,
    pub uri: String,
}

#[derive(Default, Debug, Clone, Deserialize)]
pub(crate) struct PlaylistTracks {
    pub href: String,
    pub items: Vec<Track>,
    pub limit: usize,
    pub next: Option<usize>,
    pub offset: usize,
    pub previous: Option<usize>,
    pub total: usize,
}

#[derive(Default, Debug, Clone, Deserialize)]
pub(crate) struct Playlist {
    pub collaborative: bool,
    pub description: Option<String>,
    pub external_urls: PlaylistExternalUrls,
    pub followers: PlaylistFollowers,
    pub href: String,
    pub id: String,
    pub images: Vec<Image>,
    pub name: String,
    pub owner: PlaylistOwner,
    pub public: bool,
    pub snapshot_id: String,
    pub tracks: PlaylistTracks,
    #[serde(rename = "type")]
    pub type_field: String,
    pub uri: String,
}

#[derive(Serialize, Default, Debug)]
pub(crate) struct CreatePlaylistRequest {
    pub name: String,
    pub public: Option<bool>,
    pub collaborative: Option<bool>,
    pub description: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub(crate) struct UpdatePlaylistResponse {
    pub snapshot_id: String,
}

#[derive(Deserialize)]
pub(crate) struct CreateSharedPlaylistRequest {
    pub user1_id: String,
    pub user2_id: String,
}

#[derive(Deserialize)]
pub(crate) struct CompareToRequest {
    pub compare_to: String,
}

#[derive(Clone, Deserialize, Debug)]
pub(crate) struct GetRelatedArtistsResponse {
    pub artists: Vec<Artist>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelatedArtistsGraph {
    pub extra_artists: HashMap<String, Artist>,
    pub related_artists: HashMap<String, Vec<String>>,
}

#[derive(Clone, Insertable)]
#[diesel(table_name = related_artists)]
pub(crate) struct NewRelatedArtistEntry {
    pub artist_spotify_id: i32,
    pub related_artists_json: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtistSearchResult {
    #[serde(rename = "spotifyID")]
    pub spotify_id: String,
    #[serde(rename = "internalID")]
    pub internal_id: Option<i32>,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AverageArtistItem {
    pub artist: Artist,
    pub top_tracks: Vec<Track>,
    pub similarity_to_target_point: f32,
    pub similarity_to_artist_1: f32,
    pub similarity_to_artist_2: f32,
}

impl AverageArtistItem {
    pub fn score(&self) -> FloatOrd<f32> {
        let mut score = self.similarity_to_target_point.powi(2) * 2.8;

        // Penalty for very unpopularity artists
        let artist_popularity = self.artist.popularity.unwrap_or(10);
        if artist_popularity < 5 {
            score -= 0.35;
        } else if artist_popularity < 10 {
            score -= 0.21;
        } else if artist_popularity < 20 {
            score -= 0.055;
        } else if artist_popularity > 70 {
            score += 0.071;
        } else if artist_popularity > 90 {
            score += 0.15;
        } else if artist_popularity >= 95 {
            score += 0.25;
        }

        // If distance(this, artist_a) is close to distance(this, artist_b), then we add weight to
        // this artist since it represents a better mix between both artists
        //
        // (1 - abs(0.97 - 0.97))^2 = 1 - 0.9 = 0.1
        // (1 - abs(0.94 - 0.99))^2 = 0.9025 - 0.9 = 0.025
        // (1 - abs(0.90 - 0.99))^2 = 0.8281 - 0.9 - -0.0719
        // (1 - abs(0.63520014 - 0.91005754))^2 = 0.5258 - 0.9 = -0.374
        let distances_diff = (self.similarity_to_artist_1 - self.similarity_to_artist_2).abs();
        let distances_diff_factor = (1. - distances_diff.abs()).powi(2) - 0.9;
        score += distances_diff_factor * 1.8;

        FloatOrd(score)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AverageArtistsResponse {
    pub artists: Vec<AverageArtistItem>,
    pub similarity: f32,
    pub distance: f32,
}
