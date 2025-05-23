use std::{cmp::Reverse, convert::Infallible, sync::Arc, time::Instant};

use chrono::{NaiveDateTime, Utc};
use diesel::{self, prelude::*};
use fnv::{FnvHashMap as HashMap, FnvHashSet};
use futures::{stream::FuturesUnordered, StreamExt, TryFutureExt, TryStreamExt};
use redis::Commands;
use rocket::{
    data::ToByteUnit,
    http::{RawStr, Status},
    request::Outcome,
    response::{status, Redirect},
    serde::json::Json,
    State,
};
use tokio::{
    sync::Mutex,
    task::{block_in_place, spawn_blocking},
};

use crate::{
    artist_embedding::{
        get_artist_embedding_ctx, get_average_artists,
        map_3d::{get_map_3d_artist_ctx, get_packed_3d_artist_coords},
        ArtistEmbeddingError,
    },
    benchmarking::{mark, start},
    cache::{get_hash_items, get_redis_conn, set_hash_items},
    conf::CONF,
    db_util::{
        self, get_all_top_artists_for_user, get_artist_spotify_ids_by_internal_id,
        get_internal_ids_by_spotify_id, insert_related_artists,
    },
    metrics::{endpoint_response_time, user_updates_failure_total, user_updates_success_total},
    models::{
        Artist, ArtistSearchResult, AverageArtistItem, AverageArtistsResponse, CompareToRequest,
        CreateSharedPlaylistRequest, NewRelatedArtistEntry, NewUser, OAuthTokenResponse, Playlist,
        RelatedArtistsGraph, StatsSnapshot, TimeFrames, Timeline, TimelineEvent, TimelineEventType,
        Track, User, UserComparison,
    },
    spotify_api::{
        fetch_artists, fetch_top_tracks_for_artist, get_multiple_related_artists,
        get_reqwest_client, search_artists,
    },
    DbConn, SpotifyTokenData,
};

const SPOTIFY_TOKEN_FETCH_URL: &str = "https://accounts.spotify.com/api/token";

#[get("/")]
pub(crate) fn index() -> &'static str { "Application successfully started!" }

/// Retrieves the current top tracks and artist for the current user
#[get("/stats/<username>")]
pub(crate) async fn get_current_stats(
    conn: DbConn,
    conn2: DbConn,
    username: String,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<StatsSnapshot>>, String> {
    let start_tok = start();
    let user = match db_util::get_user_by_spotify_id(&conn, username).await? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    mark(start_tok, "Finished getting spotify user by id");

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let tok = start();
    let (artist_stats, track_stats) = match tokio::join!(
        db_util::get_artist_stats(&user, conn, &spotify_access_token),
        db_util::get_track_stats(&user, conn2, &spotify_access_token),
    ) {
        (Err(err), _) | (Ok(_), Err(err)) => return Err(err),
        (Ok(None), _) | (_, Ok(None)) => return Ok(None),
        (Ok(Some(artist_stats)), Ok(Some(track_stats))) => (artist_stats, track_stats),
    };
    mark(tok, "Fetched artist and track stats");

    let mut snapshot = StatsSnapshot::new(user.last_update_time);

    for (timeframe_id, artist) in artist_stats {
        snapshot.artists.add_item_by_id(timeframe_id, artist);
    }

    for (timeframe_id, track) in track_stats {
        snapshot.tracks.add_item_by_id(timeframe_id, track);
    }

    endpoint_response_time("get_current_stats").observe(start_tok.elapsed().as_nanos() as u64);

    Ok(Some(Json(snapshot)))
}

#[derive(Serialize)]
pub(crate) struct ArtistStats {
    pub artist: Artist,
    pub tracks_by_id: HashMap<String, Track>,
    pub popularity_history: Vec<(NaiveDateTime, [Option<u8>; 3])>,
    pub top_tracks: Vec<(String, usize)>,
}

#[get("/stats/<username>/artist/<artist_id>")]
pub(crate) async fn get_artist_stats(
    conn: DbConn,
    conn2: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    username: String,
    artist_id: String,
) -> Result<Option<Json<ArtistStats>>, String> {
    let start_tok = start();
    let user = match db_util::get_user_by_spotify_id(&conn, username).await? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    mark(start_tok, "Finished getting spotify user by id");

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let tok = start();
    let user_clone = user.clone();
    let artist_id_clone = artist_id.clone();
    let spotify_access_token_clone = spotify_access_token.clone();
    let (artist_popularity_history, (tracks_by_id, top_track_scores)) = match tokio::join!(
        crate::db_util::get_artist_rank_history_single_artist(&user, conn, artist_id.clone()),
        async move {
            let (tracks_by_id, track_history) = match db_util::get_track_stats_history(
                &user_clone,
                conn2,
                &spotify_access_token_clone,
                artist_id_clone,
            )
            .await?
            {
                Some(res) => res,
                None => return Ok(None),
            };
            let top_track_scores = crate::stats::compute_track_popularity_scores(&track_history);

            Ok(Some((tracks_by_id, top_track_scores)))
        },
    ) {
        (Err(err), _) | (Ok(_), Err(err)) => return Err(err),
        (Ok(None), _) | (_, Ok(None)) => return Ok(None),
        (Ok(Some(a)), Ok(Some(b))) => (a, b),
    };
    mark(tok, "Fetched artists stats and top tracks");

    let tok = start();
    let artist = match crate::spotify_api::fetch_artists(&spotify_access_token, &[&artist_id])
        .await?
        .drain(..)
        .next()
    {
        Some(artist) => artist,
        None => return Ok(None),
    };
    mark(tok, "Found matching artist to use");

    let stats = ArtistStats {
        artist,
        tracks_by_id,
        popularity_history: artist_popularity_history,
        top_tracks: top_track_scores,
    };
    endpoint_response_time("get_artists_stats").observe(start_tok.elapsed().as_nanos() as u64);
    Ok(Some(Json(stats)))
}

#[derive(Serialize)]
pub(crate) struct GenresHistory {
    pub timestamps: Vec<NaiveDateTime>,
    pub history_by_genre: HashMap<String, Vec<Option<usize>>>,
}

#[get("/stats/<username>/genre_history")]
pub(crate) async fn get_genre_history(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    username: String,
) -> Result<Option<Json<GenresHistory>>, String> {
    let start = Instant::now();
    let user = match db_util::get_user_by_spotify_id(&conn, username).await? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    // Only include data from the "short" timeframe since we're producing a timeseries
    let (artists_by_id, artist_stats_history) =
        match db_util::get_artist_stats_history(&user, conn, &spotify_access_token, Some(0)).await?
        {
            Some(res) => res,
            None => return Ok(None),
        };

    let (timestamps, history_by_genre) =
        crate::stats::get_top_genres_by_artists(&artists_by_id, &artist_stats_history, true);
    endpoint_response_time("get_genre_history").observe(start.elapsed().as_nanos() as u64);
    Ok(Some(Json(GenresHistory {
        timestamps,
        history_by_genre,
    })))
}

#[derive(Serialize)]
pub(crate) struct GenreStats {
    pub artists_by_id: HashMap<String, Artist>,
    pub top_artists: Vec<(String, f32)>,
    pub timestamps: Vec<NaiveDateTime>,
    pub popularity_history: TimeFrames<usize>,
}

#[get("/stats/<username>/genre/<genre>")]
pub(crate) async fn get_genre_stats(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    username: String,
    genre: String,
) -> Result<Option<Json<GenreStats>>, String> {
    let start = Instant::now();
    let user = match db_util::get_user_by_spotify_id(&conn, username).await? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let (artists_by_id, genre_stats_history) =
        match db_util::get_genre_stats_history(&user, conn, &spotify_access_token, genre).await? {
            Some(res) => res,
            None => return Ok(None),
        };

    // Compute ranking scores for each of the update items
    let (timestamps, ranking_by_artist_spotify_id_by_timeframe, popularity_history) =
        crate::stats::compute_genre_ranking_history(genre_stats_history);
    endpoint_response_time("get_genre_stats").observe(start.elapsed().as_nanos() as u64);

    Ok(Some(Json(GenreStats {
        artists_by_id,
        top_artists: ranking_by_artist_spotify_id_by_timeframe,
        popularity_history,
        timestamps,
    })))
}

#[get("/stats/<username>/timeline?<start_day_id>&<end_day_id>")]
pub(crate) async fn get_timeline(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    conn_2: DbConn,
    username: String,
    start_day_id: String,
    end_day_id: String,
) -> Result<Option<Json<Timeline>>, String> {
    let start = Instant::now();
    let start_day = NaiveDateTime::parse_from_str(
        &format!("{}T08:00:00+08:00", start_day_id),
        "%Y-%m-%dT%H:%M:%S%z",
    )
    .map_err(|_| String::from("Invalid `start_day_id` provided"))?;
    let end_day = NaiveDateTime::parse_from_str(
        &format!("{}T08:00:00+08:00", end_day_id),
        "%Y-%m-%dT%H:%M:%S%z",
    )
    .map_err(|_| String::from("Invalid `end_day_id` provided"))?;

    let User { id: user_id, .. } = match db_util::get_user_by_spotify_id(&conn, username).await? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let (artist_events, track_events) = tokio::join!(
        crate::db_util::get_artist_timeline_events(&conn, user_id, start_day, end_day)
            .map_err(crate::db_util::stringify_diesel_err),
        crate::db_util::get_track_timeline_events(&conn_2, user_id, start_day, end_day)
            .map_err(crate::db_util::stringify_diesel_err),
    );
    let (artist_events, track_events) = (artist_events?, track_events?);

    let artist_ids = artist_events
        .iter()
        .map(|evt| evt.0.as_str())
        .collect::<Vec<_>>();
    let track_ids = track_events
        .iter()
        .map(|evt| evt.0.as_str())
        .collect::<Vec<_>>();

    // Join to artist/track metadata
    let items = tokio::try_join!(
        crate::spotify_api::fetch_artists(&spotify_access_token, &artist_ids),
        crate::spotify_api::fetch_tracks(&spotify_access_token, &track_ids),
    )?;
    let (artists, tracks) = items;

    let mut events = Vec::new();
    let mut event_count = 0;
    events.extend(artist_events.into_iter().zip(artists.into_iter()).map(
        |((_artist_id, first_seen), artist)| {
            event_count += 1;
            TimelineEvent {
                event_type: TimelineEventType::ArtistFirstSeen { artist },
                date: first_seen.date(),
                id: event_count,
            }
        },
    ));
    events.extend(track_events.into_iter().zip(tracks.into_iter()).map(
        |((_track_id, first_seen), track)| {
            event_count += 1;
            TimelineEvent {
                event_type: TimelineEventType::TopTrackFirstSeen { track },
                date: first_seen.date(),
                id: event_count,
            }
        },
    ));

    events.sort_unstable_by_key(|evt| evt.date);
    endpoint_response_time("get_timeline").observe(start.elapsed().as_nanos() as u64);

    Ok(Some(Json(Timeline { events })))
}

/// Redirects to the Spotify authorization page for the application
#[get("/authorize?<playlist_perms>&<state>")]
pub(crate) fn authorize(playlist_perms: Option<&str>, state: Option<&str>) -> Redirect {
    let scopes = match playlist_perms {
        None | Some("false") | Some("False") | Some("0") => "user-top-read",
        _ => "user-top-read%20playlist-modify-public",
    };
    let callback_uri = crate::conf::CONF.get_absolute_oauth_cb_uri();

    Redirect::to(format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}",
        CONF.client_id,
        callback_uri,
        scopes,
        RawStr::new(state.unwrap_or("")).percent_encode()
    ))
}

/// The playlist will be generated on the account of user2
async fn generate_shared_playlist(
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    bearer_token: &str,
    user1: &str,
    user2: &str,
) -> Result<Option<Playlist>, String> {
    let start = Instant::now();
    let (user1_res, user2_res) = tokio::join!(
        async move {
            db_util::get_user_by_spotify_id(&conn1, user1.to_owned())
                .await
                .map(|user_opt| user_opt.map(|user| (user, conn1)))
        },
        async move {
            db_util::get_user_by_spotify_id(&conn2, user2.to_owned())
                .await
                .map(|user_opt| user_opt.map(|user| (user, conn2)))
        },
    );
    let (user1, conn1) = match user1_res? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let (mut user2, conn2) = match user2_res? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    if let Some(res) = db_util::refresh_user_access_token(&conn1, &mut user2).await? {
        error!("Error refreshing access token: {:?}", res);
        return Err("Error refreshing access token".to_string());
    }

    let playlist_track_spotify_ids =
        crate::shared_playlist_gen::generate_shared_playlist_track_spotify_ids(
            conn1,
            conn2,
            conn3,
            conn4,
            &user1,
            &user2,
            &spotify_access_token,
        )
        .await?;

    let created_playlist = crate::spotify_api::create_playlist(
        bearer_token,
        &user2,
        format!("Shared Tastes of {} and {}", user1.username, user2.username),
        Some(format!(
            "Contains tracks and artists that both {} and {} enjoy, {}",
            user1.username, user2.username, "generated by spotifytrack.net"
        )),
        &playlist_track_spotify_ids,
    )
    .await?;

    endpoint_response_time("generate_shared_playlist").observe(start.elapsed().as_nanos() as u64);
    Ok(Some(created_playlist))
}

/// This handles the OAuth authentication process for new users.  It is hit as the callback for the
/// authentication request and handles retrieving user tokens, creating an entry for the user in the
/// users table, and fetching an initial stats snapshot.
#[get("/oauth_cb?<error>&<code>&<state>")]
pub(crate) async fn oauth_cb(
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    error: Option<&str>,
    code: &str,
    state: Option<&str>,
) -> Result<Redirect, String> {
    use crate::schema::users;

    let start = Instant::now();

    if error.is_some() {
        error!("Error during Oauth authorization process: {:?}", error);
        return Err("An error occured while authenticating with Spotify.".into());
    }

    let oauth_cb_url = crate::conf::CONF.get_absolute_oauth_cb_uri();

    // Shoot the code back to Spotify and get an API token for the user in return
    let mut params = HashMap::default();
    params.insert("grant_type", "authorization_code");
    params.insert("code", code);
    params.insert("redirect_uri", oauth_cb_url.as_str());
    params.insert("client_id", CONF.client_id.as_str());
    params.insert("client_secret", CONF.client_secret.as_str());

    let client = get_reqwest_client().await;
    info!("Making request to fetch user token from OAuth CB response...");
    let res = client
        .post(SPOTIFY_TOKEN_FETCH_URL)
        .form(&params)
        .send()
        .await
        .map_err(|_| -> String {
            "Error fetching token from Spotify from response Oauth code".into()
        })?;

    let res: OAuthTokenResponse = match res.json().await {
        Ok(res) => res,
        Err(err) => {
            error!("Failed to fetch user tokens from OAuth CB code: {:?}", err);
            return Err("Error parsing response from token fetch endpoint".into());
        },
    };

    let (access_token, refresh_token) = match res {
        OAuthTokenResponse::Success {
            access_token,
            refresh_token,
            token_type,
            ..
        } => {
            info!("Successfully received token of type: {}", token_type);
            (access_token, refresh_token)
        },
        OAuthTokenResponse::Error {
            error,
            error_description,
        } => {
            error!(
                "Error fetching tokens for user: {}; {}",
                error, error_description
            );
            return Err("Error fetching user access tokens from Spotify API.".into());
        },
    };

    info!("Fetched user tokens.  Inserting user into database...");

    // Fetch the user's username and spotify ID from the Spotify API
    let user_profile_info = crate::spotify_api::get_user_profile_info(&access_token).await?;
    let user_spotify_id = user_profile_info.id;
    let username = user_profile_info.display_name;

    let user = NewUser {
        creation_time: Utc::now().naive_utc(),
        last_update_time: Utc::now().naive_utc(),
        spotify_id: user_spotify_id.clone(),
        username: username.clone(),
        token: access_token.clone(),
        refresh_token: refresh_token.clone(),
    };

    let query = diesel::insert_into(crate::schema::users::table).values(user);
    match conn1.run(move |conn| query.execute(conn)).await {
        Err(diesel::result::Error::DatabaseError(
            diesel::result::DatabaseErrorKind::UniqueViolation,
            _,
        )) => {
            let query = diesel::update(users::table)
                .filter(users::dsl::spotify_id.eq(user_spotify_id.clone()))
                .set((
                    users::dsl::refresh_token.eq(refresh_token),
                    users::dsl::token.eq(access_token.clone()),
                ));
            conn1
                .run(move |conn| query.execute(conn))
                .await
                .map_err(|err| {
                    error!(
                        "Error updating tokens for user id={}: {:?}",
                        user_spotify_id, err
                    );
                    String::from("Internal error occurred when trying to update user")
                })?;

            info!("Already have a row for user; skipping manual update and redirecting directly.");
        },
        Err(err) => {
            error!("Error inserting row: {:?}", err);
            return Err("Error inserting user into database".into());
        },
        Ok(_) => {
            // Retrieve the inserted user row
            let user = crate::db_util::get_user_by_spotify_id(&conn1, user_spotify_id.clone())
                .await?
                .expect("Failed to load just inserted user from database");

            // Create an initial stats snapshot to store for the user
            let cur_user_stats = match crate::spotify_api::fetch_cur_stats(&user).await? {
                Some(stats) => stats,
                None => {
                    error!(
                        "Failed to fetch stats for user \"{}\"; bad response from Spotify API?",
                        username
                    );
                    return Err("Error fetching user stats from the Spotify API.".into());
                },
            };

            crate::spotify_api::store_stats_snapshot(&conn1, &user, cur_user_stats).await?;
        },
    };

    match state {
        Some(s) if !s.is_empty() => {
            if s == "galaxy" {
                return Ok(Redirect::to(format!(
                    "https://galaxy.spotifytrack.net/?spotifyID={}",
                    user_spotify_id
                )));
            }

            let s = RawStr::new(s);
            let percent_decoded =
                s.percent_decode()
                    .map(|s| -> String { s.into() })
                    .map_err(|_| {
                        error!("Invalid URL-Encoded `state` param; dropping");
                        "Invalid URL-encoded `state` param provided; can't parse.".to_string()
                    })?;

            match serde_json::from_str(percent_decoded.as_ref()) {
                Ok(CreateSharedPlaylistRequest { user1_id, user2_id }) => {
                    let playlist = generate_shared_playlist(
                        conn1,
                        conn2,
                        conn3,
                        conn4,
                        token_data,
                        &access_token,
                        &user1_id,
                        &user2_id,
                    )
                    .await?;

                    match playlist {
                        Some(playlist) => {
                            let encoded_playlist = serde_json::to_string(&serde_json::json!({
                                "uri": playlist.uri,
                                "track_count": playlist.tracks.total,
                                "name": playlist.name
                            }))
                            .map_err(|err| {
                                error!("Error JSON-encoding playlist: {:?}", err);
                                "Internal error while generating playlist".to_string()
                            })?;
                            let encoded_playlist =
                                RawStr::percent_encode(&RawStr::new(encoded_playlist.as_str()));
                            let redirect_url = format!(
                                "{}/compare/{}/{}?playlist={}",
                                CONF.website_url, user1_id, user2_id, encoded_playlist
                            );
                            return Ok(Redirect::to(redirect_url));
                        },
                        None =>
                            return Err(format!(
                                "One or both of the supplied users has never {}",
                                "connected to Spotifytrack before"
                            )),
                    }
                },
                Err(err) => {
                    if let Ok(CompareToRequest { compare_to }) =
                        serde_json::from_str(percent_decoded.as_ref())
                    {
                        let redirect_url = format!(
                            "{}/compare/{}/{}",
                            CONF.website_url, compare_to, user_spotify_id
                        );
                        return Ok(Redirect::to(redirect_url));
                    }

                    warn!(
                        "Error parsing JSON body of what we presume is a playlist generation \
                         request: {:?}",
                        err
                    );
                    return Err("Error parsing state param for presumed shared playlist \
                                generation request"
                        .into());
                },
            }
        },
        _ => (),
    }

    let redirect_url = match state {
        Some(s) if s.starts_with("/") => format!("{}{}", CONF.website_url, s),
        _ => format!("{}/stats/{}", CONF.website_url, user_spotify_id),
    };

    endpoint_response_time("oauth_cb").observe(start.elapsed().as_nanos() as u64);

    // Redirect the user to their stats page
    Ok(Redirect::to(redirect_url))
}

/// Returns `true` if the token is valid, false if it's not
async fn validate_api_token(api_token_data: rocket::data::Data<'_>) -> Result<bool, String> {
    let api_token = api_token_data
        .open(1usize.mebibytes())
        .into_string()
        .await
        .map_err(|err| {
            error!("Error reading provided admin API token: {:?}", err);
            String::from("Error reading post data body")
        })?
        .into_inner();
    Ok(api_token == CONF.admin_api_token)
}

async fn update_user_inner(
    conn: &DbConn,
    user_id: Option<String>,
) -> Result<(), status::Custom<String>> {
    use crate::schema::users::dsl::*;

    // Get the least recently updated user
    let mut user: User = match user_id.clone().map(|s| -> Result<String, _> {
        let s = RawStr::new(s.as_str());
        match s.percent_decode() {
            Ok(decoded) => Ok(decoded.into()),
            Err(err) => Err(err),
        }
    }) {
        Some(s) => {
            let user_id: String = s.map_err(|_| {
                error!("Invalid `user_id` param provided to `/update/user`");
                status::Custom(
                    Status::BadRequest,
                    String::from("Invalid `user_id` param; couldn't decode"),
                )
            })?;

            conn.run(move |conn| users.filter(spotify_id.eq(user_id)).first(conn))
                .await
        },
        None =>
            conn.run(move |conn| users.order_by(last_update_time).first(conn))
                .await,
    }
    .map_err(|err| {
        error!("{:?}", err);
        status::Custom(
            Status::InternalServerError,
            "Error querying user to update from database".into(),
        )
    })?;

    if let Some(res) = db_util::refresh_user_access_token(&conn, &mut user)
        .await
        .map_err(|err| status::Custom(Status::InternalServerError, err))?
    {
        return Err(res);
    }

    // Only update the user if it's been longer than the minimum update interval
    let min_update_interval_seconds = crate::conf::CONF.min_update_interval;
    let now = chrono::Utc::now().naive_utc();
    let diff = now - user.last_update_time;
    if user_id.is_none() && diff < min_update_interval_seconds {
        let msg = format!(
            "{} since last update; not updating anything right now.",
            diff
        );
        info!("{}", msg);
        return Err(status::Custom(Status::Ok, msg));
    }
    info!("{diff} since last update; proceeding with update.");

    if let Err(err) =
        crate::db_util::update_user_last_updated(&user, &conn, Utc::now().naive_utc()).await
    {
        error!(
            "Error updating user {:?} last updated time: {:?}",
            user, err
        );
        return Err(status::Custom(
            Status::InternalServerError,
            "Error updating user last updated time".into(),
        ));
    }

    let stats = match crate::spotify_api::fetch_cur_stats(&user).await {
        Ok(Some(stats)) => stats,
        Ok(None) => {
            error!(
                "Error when fetching stats for user {:?}; no stats returned.",
                user
            );
            return Err(status::Custom(
                Status::InternalServerError,
                "No data from Spotify API for that user".into(),
            ));
        },
        Err(err) => {
            error!("Error fetching user stats: {:?}", err);
            return Err(status::Custom(
                Status::InternalServerError,
                "Error fetching user stats".into(),
            ));
        },
    };

    crate::spotify_api::store_stats_snapshot(&conn, &user, stats)
        .await
        .map_err(|err| status::Custom(Status::InternalServerError, err))?;

    info!("Successfully updated user {}", user.spotify_id);

    Ok(())
}

/// This route is internal and hit by the cron job that is called to periodically update the stats
/// for the least recently updated user.
#[post("/update_user?<user_id>&<count>", data = "<api_token_data>")]
pub(crate) async fn update_user(
    conn: DbConn,
    api_token_data: rocket::data::Data<'_>,
    user_id: Option<String>,
    count: Option<usize>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    if let Some(user_id) = user_id {
        if let Err(status) = update_user_inner(&conn, Some(user_id)).await {
            user_updates_failure_total().inc();
            return Ok(status);
        }
        user_updates_success_total().inc();
        return Ok(status::Custom(Status::Ok, "User updated".into()));
    }

    let count = count.unwrap_or(1);
    let mut success_count = 0usize;
    let mut fail_count = 0usize;
    for _ in 0..count {
        let success = update_user_inner(&conn, None).await.is_ok();
        if success {
            user_updates_success_total().inc();
            success_count += 1;
        } else {
            user_updates_failure_total().inc();
            fail_count += 1;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    Ok(status::Custom(
        Status::Ok,
        format!(
            "Successfully updated {} user(s); failed to update {} user(s)",
            success_count, fail_count
        ),
    ))
}

#[post("/populate_tracks_artists_mapping_table", data = "<api_token_data>")]
pub(crate) async fn populate_tracks_artists_mapping_table(
    conn: DbConn,
    api_token_data: rocket::data::Data<'_>,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    crate::db_util::populate_tracks_artists_table(&conn, &spotify_access_token).await?;

    Ok(status::Custom(
        Status::Ok,
        "Sucessfully populated mapping table".into(),
    ))
}

#[post("/populate_artists_genres_mapping_table", data = "<api_token_data>")]
pub(crate) async fn populate_artists_genres_mapping_table(
    conn: DbConn,
    api_token_data: rocket::data::Data<'_>,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    crate::db_util::populate_artists_genres_table(&conn, &spotify_access_token).await?;

    Ok(status::Custom(
        Status::Ok,
        "Sucessfully populated mapping table".into(),
    ))
}

async fn compute_comparison(
    user1: String,
    user2: String,
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<Option<UserComparison>, String> {
    let (user1_res, user2_res) = tokio::join!(
        async move {
            db_util::get_user_by_spotify_id(&conn1, user1)
                .await
                .map(|user_opt| user_opt.map(|user| (user, conn1)))
        },
        async move {
            db_util::get_user_by_spotify_id(&conn2, user2)
                .await
                .map(|user_opt| user_opt.map(|user| (user, conn2)))
        },
    );
    let (user1, conn1) = match user1_res? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let (user2, conn2) = match user2_res? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let (user1_id, user2_id) = (user1.id, user2.id);

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;
    let spotify_access_token_clone = spotify_access_token.clone();

    let stats = tokio::try_join!(
        crate::db_util::get_all_top_tracks_for_user(&conn1, user1_id)
            .map_err(db_util::stringify_diesel_err),
        crate::db_util::get_all_top_tracks_for_user(&conn2, user2_id)
            .map_err(db_util::stringify_diesel_err),
        crate::db_util::get_all_top_artists_for_user(&conn3, user1_id)
            .map_err(db_util::stringify_diesel_err),
        crate::db_util::get_all_top_artists_for_user(&conn4, user2_id)
            .map_err(db_util::stringify_diesel_err),
    )?;
    let (user1_tracks, user2_tracks, user1_artists, user2_artists) = stats;

    let tracks_intersection = async move {
        let mut intersection = user1_tracks;
        intersection.retain(|(id, _)| user2_tracks.iter().any(|(o_id, _)| *o_id == *id));

        let spotify_ids = intersection
            .iter()
            .map(|(_, spotify_id)| spotify_id.as_str())
            .collect::<Vec<_>>();
        crate::spotify_api::fetch_tracks(&spotify_access_token, &spotify_ids).await
    };
    let artists_intersection = async move {
        let mut intersection = user1_artists;
        intersection.retain(|(id, _)| user2_artists.iter().any(|(o_id, _)| *o_id == *id));

        let spotify_ids = intersection
            .iter()
            .map(|(_, spotify_id)| spotify_id.as_str())
            .collect::<Vec<_>>();
        crate::spotify_api::fetch_artists(&spotify_access_token_clone, &spotify_ids).await
    };
    let intersections = tokio::try_join!(tracks_intersection, artists_intersection)?;
    let (tracks_intersection, artists_intersection) = intersections;

    Ok(Some(UserComparison {
        tracks: tracks_intersection,
        artists: artists_intersection,
        genres: Vec::new(), // TODO
        user1_username: user1.username,
        user2_username: user2.username,
    }))
}

#[get("/compare/<user1>/<user2>")]
pub(crate) async fn compare_users(
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    user1: String,
    user2: String,
) -> Result<Option<Json<UserComparison>>, String> {
    let start = Instant::now();
    let res = compute_comparison(user1, user2, conn1, conn2, conn3, conn4, token_data)
        .await
        .map(|res| res.map(Json))?;
    endpoint_response_time("compare_users").observe(start.elapsed().as_nanos() as u64);
    Ok(res)
}

async fn build_related_artists_graph(
    spotify_access_token: String,
    artist_ids: &[&str],
) -> Result<RelatedArtistsGraph, String> {
    // Get related artists for all of them
    let related_artists =
        get_multiple_related_artists(spotify_access_token.clone(), artist_ids).await?;

    let all_artist_ids: FnvHashSet<String> = artist_ids
        .iter()
        .copied()
        .map(String::from)
        .chain(
            related_artists
                .iter()
                .flat_map(|related_artists| related_artists.iter().cloned()),
        )
        .collect();

    let mut related_artists_by_id = HashMap::default();
    for (&artist_id, related_artists) in artist_ids.into_iter().zip(related_artists.iter()) {
        related_artists_by_id.insert(artist_id.to_owned(), related_artists.clone());
    }

    let all_artist_ids: Vec<_> = all_artist_ids.iter().map(String::as_str).collect();
    let extra_artists_list = fetch_artists(&spotify_access_token, &all_artist_ids).await?;
    let mut extra_artists = HashMap::default();
    for artist in extra_artists_list {
        extra_artists.insert(artist.id.clone(), artist);
    }

    Ok(RelatedArtistsGraph {
        extra_artists,
        related_artists: related_artists_by_id,
    })
}

#[get("/stats/<user_id>/related_artists_graph")]
pub(crate) async fn get_related_artists_graph(
    conn: DbConn,
    user_id: String,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<RelatedArtistsGraph>>, String> {
    let start = Instant::now();
    let User { id: user_id, .. } = match db_util::get_user_by_spotify_id(&conn, user_id).await? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    // Start off by getting all artists for the user from all timeframes
    let all_artists_for_user =
        get_all_top_artists_for_user(&conn, user_id)
            .await
            .map_err(|err| {
                error!("Error fetching all artists for user: {:?}", err);
                String::from("Internal DB error")
            })?;
    let all_artist_ids_for_user: Vec<&str> = all_artists_for_user
        .iter()
        .map(|(_internal_id, spotify_id)| spotify_id.as_str())
        .collect();

    let out = build_related_artists_graph(spotify_access_token, &all_artist_ids_for_user).await?;
    endpoint_response_time("get_related_artists_graph").observe(start.elapsed().as_nanos() as u64);
    Ok(Some(Json(out)))
}

#[get("/related_artists/<artist_id>")]
pub(crate) async fn get_related_artists(
    artist_id: String,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<RelatedArtistsGraph>>, String> {
    let start = Instant::now();
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let related_artist_ids =
        get_multiple_related_artists(spotify_access_token.clone(), &[&artist_id]).await?;
    let related_artist_ids = match related_artist_ids.into_iter().next() {
        Some(ids) => ids,
        None => {
            error!("Empty vec returned from `get_multiple_related_artists`");
            return Ok(None);
        },
    };
    let related_artist_ids = related_artist_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();

    let out = build_related_artists_graph(spotify_access_token, &related_artist_ids).await?;
    endpoint_response_time("get_related_artists").observe(start.elapsed().as_nanos() as u64);
    Ok(Some(Json(out)))
}

#[get("/display_name/<username>")]
pub(crate) async fn get_display_name(
    conn: DbConn,
    username: String,
) -> Result<Option<String>, String> {
    let start = Instant::now();
    match db_util::get_user_by_spotify_id(&conn, username).await? {
        Some(user) => {
            let user_clone = user.clone();
            tokio::task::spawn(async move {
                if let Err(err) = db_util::update_user_last_viewed(&user_clone, &conn).await {
                    error!(
                        "Error updating user last viewed time for {}: {:?}",
                        user_clone.username, err
                    );
                }
            });

            endpoint_response_time("get_display_name").observe(start.elapsed().as_nanos() as u64);

            Ok(Some(user.username))
        },
        None => Ok(None),
    }
}

#[post("/dump_redis_related_artists_to_database", data = "<api_token_data>")]
pub(crate) async fn dump_redis_related_artists_to_database(
    conn: DbConn,
    api_token_data: rocket::Data<'_>,
) -> Result<status::Custom<String>, String> {
    let start = Instant::now();

    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let mut redis_conn = get_redis_conn()?;
    let all_values: Vec<String> = block_in_place(|| redis_conn.hgetall("related_artists"))
        .map_err(|err| {
            error!("Error with HGETALL on related artists data: {:?}", err);
            String::from("Redis error")
        })?;

    let mut all_mapped_spotify_ids: HashMap<String, i32> = HashMap::default();

    for chunk in all_values.chunks(200) {
        let mapped_spotify_ids =
            get_internal_ids_by_spotify_id(&conn, chunk.chunks_exact(2).map(|chunk| &chunk[0]))
                .await
                .map_err(|err| {
                    error!("Error mapping spotify ids: {:?}", err);
                    String::from("Error mapping spotify ids")
                })?;

        for (k, v) in mapped_spotify_ids {
            all_mapped_spotify_ids.insert(k, v);
        }
    }

    let entries: Vec<NewRelatedArtistEntry> = all_values
        .chunks_exact(2)
        .map(|val| {
            let artist_spotify_id = &val[0];
            let related_artists_json = val[1].clone();
            let artist_spotify_id = *all_mapped_spotify_ids
                .get(artist_spotify_id)
                .expect("Spotify ID didn't get mapped");

            NewRelatedArtistEntry {
                artist_spotify_id,
                related_artists_json,
            }
        })
        .collect();

    for chunk in entries.chunks(200) {
        insert_related_artists(&conn, chunk.into())
            .await
            .map_err(|err| {
                error!("DB error inserting related artist into DB: {:?}", err);
                String::from("DB error")
            })?;
    }

    endpoint_response_time("dump_redis_related_artists_to_database")
        .observe(start.elapsed().as_nanos() as u64);

    Ok(status::Custom(
        Status::Ok,
        String::from("Successfully dumped all related artists from Redis to MySQL"),
    ))
}

#[post("/crawl_related_artists", data = "<api_token_data>")]
pub(crate) async fn crawl_related_artists(
    api_token_data: rocket::Data<'_>,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<status::Custom<String>, String> {
    let start = Instant::now();

    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let mut redis_conn = get_redis_conn()?;
    let artist_ids: Vec<String> = block_in_place(|| {
        redis::cmd("HRANDFIELD")
            .arg("related_artists")
            .arg("8")
            .query::<Vec<String>>(&mut *redis_conn)
    })
    .map_err(|err| {
        error!(
            "Error getting random related artist keys from Redis cache: {:?}",
            err
        );
        String::from("Redis error")
    })?;

    let mut all_related_artists: Vec<String> = Vec::new();

    let related_artists_jsons: Vec<String> = block_in_place(|| {
        redis_conn
            .hget("related_artists", artist_ids)
            .map_err(|err| {
                error!("Error getting related artist from Redis: {:?}", err);
                String::from("Redis error")
            })
    })?;

    for related_artists_json in related_artists_jsons {
        let Ok(related_artist_ids) = serde_json::from_str::<Vec<String>>(&related_artists_json)
        else {
            error!(
                "Invalid entry in related artists Redis; can't parse into array of strings; \
                 found={}",
                related_artists_json
            );
            continue;
        };

        all_related_artists.extend(related_artist_ids.into_iter());
    }

    info!("Crawling {} related artists...", all_related_artists.len());
    let mut all_related_artists: Vec<&str> =
        all_related_artists.iter().map(String::as_str).collect();
    all_related_artists.sort_unstable();
    all_related_artists.dedup();

    let fetched =
        get_multiple_related_artists(spotify_access_token.clone(), &all_related_artists).await?;
    endpoint_response_time("crawl_related_artists").observe(start.elapsed().as_nanos() as u64);
    Ok(status::Custom(
        Status::Ok,
        format!(
            "Successfully fetched {} related artists to poulate related artists Redis hash",
            fetched.len()
        ),
    ))
}

pub(crate) struct UserAgent(String);

#[async_trait]
impl<'a, 'r> rocket::request::FromRequest<'r> for UserAgent {
    type Error = Infallible;

    async fn from_request(
        req: &'r rocket::request::Request<'_>,
    ) -> rocket::request::Outcome<Self, Self::Error> {
        let token = req.headers().get_one("user-agent");
        match token {
            Some(token) => Outcome::Success(UserAgent(token.to_string())),
            None => Outcome::Success(UserAgent(String::new())),
        }
    }
}

#[get("/search_artist?<q>")]
pub(crate) async fn search_artist(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    q: String,
    user_agent: UserAgent,
) -> Result<Json<Vec<ArtistSearchResult>>, String> {
    let start = Instant::now();
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    // First check cache
    let cached_item =
        block_in_place(|| get_hash_items::<Vec<ArtistSearchResult>>("artistSearch", &[&q]))
            .map_err(|err| {
                error!("Error checking cache for artist search results: {}", err);
                String::from("Internal error with cache")
            })?
            .into_iter()
            .next()
            .flatten();

    if let Some(cached_item) = cached_item {
        info!("Found hit in cache for artist search query={}", q);
        return Ok(Json(cached_item));
    }

    if user_agent.0.to_ascii_lowercase().starts_with("python") {
        warn!(
            "Returning empty response for artist search query from Python user agent: ({}): {q}",
            user_agent.0
        );
        return Ok(Json(Vec::new()));
    }

    // Hit the Spotify API and store in the cache
    let search_results = search_artists(&conn, spotify_access_token, &q).await?;
    set_hash_items::<Vec<ArtistSearchResult>>("artistSearch", &[(&q, search_results.clone())])
        .map_err(|err| {
            error!("Error storing artist search in cache: {}", err);
            String::from("Internal error with cache")
        })?;
    info!(
        "Successfully hit Spotify API for artist search query={:?} and stored in cache",
        q
    );

    endpoint_response_time("search_artist").observe(start.elapsed().as_nanos() as u64);

    Ok(Json(search_results))
}

#[get(
    "/average_artists/<artist_1_spotify_id>/<artist_2_spotify_id>?<count>&<artist_1_bias>&\
     <artist_2_bias>"
)]
pub(crate) async fn get_average_artists_route(
    conn: DbConn,
    artist_1_spotify_id: String,
    artist_2_spotify_id: String,
    count: Option<usize>,
    artist_1_bias: Option<f32>,
    artist_2_bias: Option<f32>,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<Json<AverageArtistsResponse>, String> {
    let start = Instant::now();

    // Look up internal IDs for provided spotify IDs
    let internal_ids_by_spotify_id = get_internal_ids_by_spotify_id(
        &conn,
        [artist_1_spotify_id.clone(), artist_2_spotify_id.clone()].iter(),
    )
    .await?;
    let artist_1_id = match internal_ids_by_spotify_id.get(&artist_1_spotify_id) {
        Some(id) => *id,
        None => return Err(format!("No artist found with id={}", artist_1_spotify_id)),
    };
    let artist_2_id = match internal_ids_by_spotify_id.get(&artist_2_spotify_id) {
        Some(id) => *id,
        None => return Err(format!("No artist found with id={}", artist_2_spotify_id)),
    };
    let count = count.unwrap_or(10).min(50);
    assert!(artist_1_id > 0);
    assert!(artist_2_id > 0);

    let mut average_artists = match get_average_artists(
        artist_1_id as usize,
        artist_1_bias.unwrap_or(1.),
        artist_2_id as usize,
        artist_2_bias.unwrap_or(1.),
        count,
    ) {
        Ok(res) => res,
        Err(err) => match err {
            ArtistEmbeddingError::ArtistIdNotFound(id) =>
                return Err(format!(
                    "No artist found in embedding with internal id={}",
                    id
                )),
        },
    };

    let all_artist_internal_ids: Vec<i32> = average_artists.iter().map(|d| d.id as i32).collect();
    let artist_spotify_ids_by_internal_id: HashMap<i32, String> =
        get_artist_spotify_ids_by_internal_id(&conn, all_artist_internal_ids)
            .await
            .map_err(|err| {
                error!(
                    "Error converting artist internal ids to spotify ids after performing \
                     averaging: {:?}",
                    err
                );
                String::from("Internal database error")
            })?;

    let all_spotify_ids: Vec<&str> = artist_spotify_ids_by_internal_id
        .values()
        .map(String::as_str)
        .collect();

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let top_tracks_for_artists = FuturesUnordered::new();
    for artist_spotify_id in &all_spotify_ids {
        let artist_spotify_id_clone = String::from(*artist_spotify_id);
        top_tracks_for_artists.push(
            fetch_top_tracks_for_artist(&spotify_access_token, artist_spotify_id)
                .map_ok(move |res| (artist_spotify_id_clone, res)),
        );
    }

    let (top_tracks, fetched_artists) = tokio::try_join!(
        top_tracks_for_artists.try_collect::<Vec<_>>(),
        fetch_artists(&spotify_access_token, &all_spotify_ids)
    )?;
    let mut top_tracks_by_artist_spotify_id: HashMap<String, Vec<Track>> =
        top_tracks.into_iter().collect();

    if fetched_artists.len() != average_artists.len() {
        assert!(fetched_artists.len() < average_artists.len());
        average_artists.retain(|d| {
            let avg_artist_spotify_id = match artist_spotify_ids_by_internal_id.get(&(d.id as i32))
            {
                Some(id) => id,
                None => {
                    error!(
                        "No spotify id found for artist with internal_id={} returned from \
                         averageing",
                        d.id
                    );
                    return false;
                },
            };
            let was_fetched = fetched_artists
                .iter()
                .any(|a| a.id == *avg_artist_spotify_id);
            if !was_fetched {
                error!(
                    "Failed to find artist metadata for artist with spotify_id={}",
                    avg_artist_spotify_id
                );
            }
            return was_fetched;
        });
        assert_eq!(fetched_artists.len(), average_artists.len());
    }

    let mut out_artists: Vec<AverageArtistItem> = average_artists
        .into_iter()
        .filter_map(|d| {
            let avg_artist_spotify_id = match artist_spotify_ids_by_internal_id.get(&(d.id as i32))
            {
                Some(id) => id,
                None => {
                    error!(
                        "No spotify id found for artist with internal_id={} returned from \
                         averageing",
                        d.id
                    );
                    return None;
                },
            };
            let artist = match fetched_artists
                .iter()
                .find(|artist| artist.id == *avg_artist_spotify_id)
                .cloned()
            {
                Some(artist) => artist,
                None => {
                    warn!(
                        "Didn't find artist with id={} in response from Spotify even though we \
                         requested it and counts lined up; they probably did the thing where they \
                         gave a different ID back than the one we requested, both of which refer \
                         to the same actual artist.",
                        avg_artist_spotify_id
                    );

                    return None;
                },
            };

            let mut top_tracks = top_tracks_by_artist_spotify_id
                .remove(avg_artist_spotify_id)
                .unwrap_or_default();
            // If the artist doesn't have any tracks, it's not worth showing to the user
            if top_tracks.is_empty() {
                return None;
            }

            // Put tracks without a preview URL at the end
            top_tracks.sort_by_key(|t| if t.preview_url.is_some() { 0 } else { 1 });
            // We don't really have space in the UI to show artists for every track, so we strip
            // them out here
            for track in &mut top_tracks {
                track.artists = Vec::new();
                track.album.artists = Vec::new();
            }

            Some(AverageArtistItem {
                artist,
                top_tracks,
                similarity_to_target_point: d.similarity_to_target_point,
                similarity_to_artist_1: d.similarity_to_artist_1,
                similarity_to_artist_2: d.similarity_to_artist_2,
            })
        })
        .collect();

    out_artists.sort_unstable_by_key(|item| Reverse(item.score()));

    let ctx = get_artist_embedding_ctx();

    endpoint_response_time("get_average_artists").observe(start.elapsed().as_nanos() as u64);

    Ok(Json(AverageArtistsResponse {
        artists: out_artists,
        distance: ctx
            .distance(artist_1_id as usize, artist_2_id as usize)
            .unwrap(),
        similarity: ctx
            .similarity(artist_1_id as usize, artist_2_id as usize)
            .unwrap(),
    }))
}

#[get("/artist_image_url/<artist_spotify_id>")]
pub(crate) async fn get_artist_image_url(
    artist_spotify_id: String,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<String, String> {
    let start = Instant::now();

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let artist: Option<Artist> = fetch_artists(&spotify_access_token, &[&artist_spotify_id])
        .await?
        .into_iter()
        .next();
    let image = match artist
        .and_then(|artist| artist.images.and_then(|images| images.into_iter().next()))
    {
        Some(image) => image,
        None => return Err(String::from("Not found")),
    };
    endpoint_response_time("get_artist_image_url").observe(start.elapsed().as_nanos() as u64);
    Ok(image.url)
}

#[post(
    "/refetch_cached_artists_missing_popularity?<count>",
    data = "<api_token_data>"
)]
pub(crate) async fn refetch_cached_artists_missing_popularity(
    api_token_data: rocket::Data<'_>,
    token_data: &State<Mutex<SpotifyTokenData>>,
    count: Option<usize>,
) -> Result<status::Custom<String>, String> {
    let start = Instant::now();
    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let mut redis_conn = spawn_blocking(|| get_redis_conn()).await.unwrap()?;

    let (mut redis_conn, artist_spotify_ids) =
        spawn_blocking(move || -> Result<(_, Vec<String>), String> {
            let artist_spotify_ids = redis::cmd("HRANDFIELD")
                .arg(&CONF.artists_cache_hash_name)
                .arg(count.unwrap_or(20).to_string())
                .query::<Vec<String>>(&mut *redis_conn)
                .map_err(|err| {
                    error!(
                        "Error getting random artist keys from Redis cache: {:?}",
                        err
                    );
                    String::from("Redis error")
                })?;
            Ok((redis_conn, artist_spotify_ids))
        })
        .await
        .unwrap()?;
    let artist_spotify_ids: Vec<&str> = artist_spotify_ids.iter().map(String::as_str).collect();
    let mut artists = fetch_artists(&spotify_access_token, &artist_spotify_ids).await?;
    artists.retain(|artist| artist.popularity.is_none());
    if artists.is_empty() {
        return Ok(status::Custom(Status::Ok, "No artists to refetch".into()));
    }
    let artist_ids_needing_refetch: Vec<String> =
        artists.iter().map(|artist| artist.id.clone()).collect();

    // Delete from the cache and then re-fetch them to re-populate the cache from the Spotify API
    let artist_ids_needing_refetch_clone = artist_ids_needing_refetch.clone();
    let deleted_artist_count = spawn_blocking(move || {
        let artist_ids_needing_refetch: Vec<&str> = artist_ids_needing_refetch_clone
            .iter()
            .map(String::as_str)
            .collect();

        let mut cmd = redis::cmd("HDEL");
        cmd.arg(&CONF.artists_cache_hash_name);
        for artist_id in artist_ids_needing_refetch {
            cmd.arg(artist_id);
        }
        cmd.query::<usize>(&mut *redis_conn)
    })
    .await
    .unwrap()
    .map_err(|err| {
        error!("Error deleting artist ids from Redis cache: {}", err);
        String::from("Redis error")
    })?;
    info!("Deleted {} artists from Redis cache", deleted_artist_count);

    let artist_ids_needing_refetch: Vec<&str> = artist_ids_needing_refetch
        .iter()
        .map(String::as_str)
        .collect();
    fetch_artists(&spotify_access_token, &artist_ids_needing_refetch).await?;

    endpoint_response_time("refetch_cached_artists_missing_popularity")
        .observe(start.elapsed().as_nanos() as u64);

    Ok(status::Custom(
        Status::Ok,
        format!(
            "Successfully fetched {} artists missing popularities",
            deleted_artist_count
        ),
    ))
}

/// Needed so that the MIME type on packed binary stuff that still should be compressed is picked up
/// by the CDN as being compressable.
#[derive(Responder)]
#[response(status = 200, content_type = "application/json")]
pub(crate) struct JSONMimeTypeSetterResponder {
    inner: Vec<u8>,
}

#[get("/packed_3d_artist_coords")]
pub(crate) async fn get_packed_3d_artist_coords_route(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
) -> Result<JSONMimeTypeSetterResponder, String> {
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let packed = get_packed_3d_artist_coords(&conn, &spotify_access_token).await?;
    Ok(JSONMimeTypeSetterResponder {
        inner: packed.to_vec(),
    })
}

#[post("/map_artist_data_by_internal_ids", data = "<artist_internal_ids>")]
pub(crate) async fn get_artists_by_internal_ids(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    artist_internal_ids: Json<Vec<i32>>,
) -> Result<Json<Vec<Option<String>>>, String> {
    let start = Instant::now();

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let artist_internal_ids: Vec<i32> = artist_internal_ids.0;
    let artist_spotify_ids_by_internal_id =
        get_artist_spotify_ids_by_internal_id(&conn, artist_internal_ids.clone())
            .await
            .map_err(|err| {
                error!(
                    "Error getting artist spotify IDs by internal IDs: {:?}",
                    err
                );
                String::from("Internal DB error")
            })?;
    let artist_spotify_ids = artist_internal_ids
        .iter()
        .filter_map(|internal_id| {
            artist_spotify_ids_by_internal_id
                .get(internal_id)
                .map(String::as_str)
        })
        .collect::<Vec<_>>();

    let artists = fetch_artists(&spotify_access_token, &artist_spotify_ids).await?;
    let res = artist_internal_ids
        .into_iter()
        .map(|internal_id| {
            let spotify_id = artist_spotify_ids_by_internal_id.get(&internal_id)?;
            artists
                .iter()
                .find(|artist| artist.id == *spotify_id)
                .map(|artist| artist.name.clone())
        })
        .collect();

    endpoint_response_time("get_artists_by_internal_ids")
        .observe(start.elapsed().as_nanos() as u64);

    Ok(Json(res))
}

fn pack_artist_relationships(artist_relationships: Vec<Vec<i32>>) -> Vec<u8> {
    // Encoding:
    // artist count * u8: related artist count
    // 0-3 bytes of padding to make total byte count divisible by 4
    // The rest: u32s, in order, for each artist.
    let mut packed: Vec<u8> = Vec::new();
    for related_artists in &artist_relationships {
        let artist_count = related_artists.len();
        assert!(artist_count <= 255);
        packed.push(artist_count as u8);
    }

    // padding
    let padding_byte_count = 4 - (packed.len() % 4);
    for _ in 0..padding_byte_count {
        packed.push(0);
    }
    assert_eq!(packed.len() % 4, 0);

    for mut related_artists in artist_relationships {
        // Might help with compression ratio, who knows
        related_artists.sort_unstable();
        for id in related_artists {
            let bytes: [u8; 4] = unsafe { std::mem::transmute(id as u32) };
            for byte in bytes {
                packed.push(byte);
            }
        }
    }
    assert_eq!(packed.len() % 4, 0);
    packed
}

async fn get_packed_artist_relationships_by_internal_ids_inner(
    conn: &DbConn,
    spotify_access_token: String,
    artist_internal_ids: Vec<i32>,
) -> Result<Vec<u8>, String> {
    let tok = start();
    let artist_spotify_ids_by_internal_id =
        get_artist_spotify_ids_by_internal_id(&conn, artist_internal_ids.clone())
            .await
            .map_err(|err| {
                error!(
                    "Error getting artist spotify IDs by internal IDs: {:?}",
                    err
                );
                String::from("Internal DB error")
            })?;

    mark(tok, "Converted to spotify IDs");
    let artist_spotify_ids = artist_internal_ids
        .iter()
        .filter_map(|internal_id| {
            artist_spotify_ids_by_internal_id
                .get(internal_id)
                .map(String::as_str)
        })
        .collect::<Vec<_>>();

    let tok = start();
    let related_artists =
        get_multiple_related_artists(spotify_access_token, &artist_spotify_ids).await?;
    mark(tok, "Got related artists");
    assert_eq!(related_artists.len(), artist_spotify_ids.len());

    let tok = start();
    let related_artists_internal_ids_by_spotify_id = get_internal_ids_by_spotify_id(
        &conn,
        related_artists
            .iter()
            .flat_map(|related_artists| related_artists.iter()),
    )
    .await?;
    mark(tok, "Mapped back to internal IDs");

    let res = related_artists
        .into_iter()
        .map(|related_artists| {
            related_artists
                .iter()
                .filter_map(|artist_spotify_id| {
                    related_artists_internal_ids_by_spotify_id
                        .get(artist_spotify_id)
                        .copied()
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    Ok(pack_artist_relationships(res))
}

#[post(
    "/map_artist_relationships_by_internal_ids",
    data = "<artist_internal_ids>"
)]
pub(crate) async fn get_packed_artist_relationships_by_internal_ids(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    artist_internal_ids: Json<Vec<i32>>,
) -> Result<JSONMimeTypeSetterResponder, String> {
    let start = Instant::now();

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let artist_internal_ids: Vec<i32> = artist_internal_ids.0;
    let packed = get_packed_artist_relationships_by_internal_ids_inner(
        &conn,
        spotify_access_token,
        artist_internal_ids,
    )
    .await?;
    endpoint_response_time("get_packed_artist_relationships_by_internal_ids")
        .observe(start.elapsed().as_nanos() as u64);
    Ok(JSONMimeTypeSetterResponder { inner: packed })
}

lazy_static::lazy_static! {
    pub static ref ARTIST_RELATIONSHIPS_BY_INTERNAL_IDS_CACHE:
        Arc<Mutex<HashMap<(u32, u32), Vec<u8>>>> =
            Arc::new(Mutex::new(HashMap::default()));
}

#[get("/map_artist_relationships_chunk?<chunk_size>&<chunk_ix>")]
pub(crate) async fn get_artist_relationships_chunk(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    chunk_size: u32,
    chunk_ix: u32,
) -> Result<JSONMimeTypeSetterResponder, String> {
    let start = Instant::now();

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let cache_key = (chunk_size, chunk_ix);
    {
        let cache = &mut *ARTIST_RELATIONSHIPS_BY_INTERNAL_IDS_CACHE.lock().await;
        if let Some(cached_data) = cache.get(&cache_key) {
            return Ok(JSONMimeTypeSetterResponder {
                inner: cached_data.clone(),
            });
        }
    }

    let artist_internal_ids: Vec<i32> = get_map_3d_artist_ctx(&conn, &spotify_access_token)
        .await
        .sorted_artist_ids
        .chunks(chunk_size as usize)
        .skip(chunk_ix as usize)
        .next()
        .unwrap_or_default()
        .iter()
        .copied()
        .map(|id| id as i32)
        .collect();

    let packed = get_packed_artist_relationships_by_internal_ids_inner(
        &conn,
        spotify_access_token,
        artist_internal_ids,
    )
    .await?;

    {
        let cache = &mut *ARTIST_RELATIONSHIPS_BY_INTERNAL_IDS_CACHE.lock().await;
        cache.insert(cache_key, packed.clone());
    }

    endpoint_response_time("get_artist_relationships_chunk")
        .observe(start.elapsed().as_nanos() as u64);

    Ok(JSONMimeTypeSetterResponder { inner: packed })
}

#[get("/get_preview_urls_by_internal_id/<artist_internal_id>")]
pub(crate) async fn get_preview_urls_by_internal_id(
    conn: DbConn,
    token_data: &State<Mutex<SpotifyTokenData>>,
    artist_internal_id: i32,
) -> Result<Json<Option<Vec<String>>>, String> {
    let start = Instant::now();

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().await;
        token_data.get().await
    }?;

    let spotify_ids_by_internal_id =
        get_artist_spotify_ids_by_internal_id(&conn, vec![artist_internal_id])
            .await
            .map_err(|err| {
                error!(
                    "Error getting artist spotify IDs by internal IDs: {:?}",
                    err
                );
                String::from("Internal DB error")
            })?;

    let spotify_id = match spotify_ids_by_internal_id.get(&artist_internal_id).cloned() {
        Some(spotify_id) => spotify_id,
        None => return Ok(Json(None)),
    };

    let top_tracks = fetch_top_tracks_for_artist(&spotify_access_token, &spotify_id).await?;

    endpoint_response_time("get_preview_urls_by_internal_id")
        .observe(start.elapsed().as_nanos() as u64);

    if top_tracks.is_empty() {
        return Ok(Json(None));
    }

    Ok(Json(
        top_tracks
            .iter()
            .map(|track| track.preview_url.clone())
            .collect(),
    ))
}

#[get("/top_artists_internal_ids_for_user/<user_id>")]
pub(crate) async fn get_top_artists_internal_ids_for_user(
    conn: DbConn,
    user_id: String,
) -> Result<Option<Json<Vec<i32>>>, String> {
    let start = Instant::now();

    let user = match db_util::get_user_by_spotify_id(&conn, user_id).await? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };

    let top_artists = get_all_top_artists_for_user(&conn, user.id)
        .await
        .map_err(|err| {
            error!("Error getting top artists for user: {:?}", err);
            String::from("Internal DB error")
        })?;

    endpoint_response_time("get_top_artists_internal_ids_for_user")
        .observe(start.elapsed().as_nanos() as u64);

    Ok(Some(Json(
        top_artists
            .into_iter()
            .map(|(internal_id, _spotify_id)| internal_id)
            .collect(),
    )))
}

#[post(
    "/transfer_user_data_to_external_storage/<user_id>",
    data = "<api_token_data>"
)]
pub(crate) async fn transfer_user_data_to_external_storage(
    api_token_data: rocket::Data<'_>,
    conn: DbConn,
    user_id: String,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let user = match db_util::get_user_by_spotify_id(&conn, user_id).await? {
        Some(user) => user,
        None => {
            return Err(String::from("User not found"));
        },
    };

    if !user.external_data_retrieved {
        warn!(
            "User {} already has external user data stored; downloading + merging and re-storing \
             everything...",
            user.spotify_id
        );
    }

    crate::external_storage::upload::store_external_user_data(&conn, user.spotify_id).await;
    Ok(status::Custom(Status::Ok, String::new()))
}

#[post(
    "/transfer_user_data_from_external_storage/<user_id>",
    data = "<api_token_data>"
)]
pub(crate) async fn transfer_user_data_from_external_storage(
    api_token_data: rocket::Data<'_>,
    conn: DbConn,
    user_id: String,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let user = match db_util::get_user_by_spotify_id(&conn, user_id).await? {
        Some(user) => user,
        None => {
            return Err(String::from("User not found"));
        },
    };

    if user.external_data_retrieved {
        warn!(
            "User {} already has external data retrieved; retrieving anyway...",
            user.spotify_id
        );
    }

    crate::external_storage::download::retrieve_external_user_data(&conn, user.spotify_id, false)
        .await;
    Ok(status::Custom(Status::Ok, String::new()))
}

#[post(
    "/bulk_transfer_user_data_to_external_storage/<user_count>?<only_already_stored>&<concurrency>",
    data = "<api_token_data>"
)]
pub(crate) async fn bulk_transfer_user_data_to_external_storage(
    api_token_data: rocket::Data<'_>,
    conn0: DbConn,
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    user_count: u32,
    only_already_stored: Option<bool>,
    concurrency: Option<usize>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data).await? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    // Only transfer data for users that haven't viewed their profile in the past 4 months
    let cutoff_time: NaiveDateTime = Utc::now().naive_utc() - chrono::Duration::days(120);

    let users = conn0
        .run(move |conn| {
            use crate::schema::users;
            let mut query = users::table
                .filter(users::dsl::last_viewed.lt(cutoff_time))
                .into_boxed();
            if only_already_stored == Some(true) {
                query = query.filter(users::dsl::external_data_retrieved.eq(true));
            }

            query
                .order_by(users::dsl::last_external_data_store.asc())
                .limit(user_count as i64)
                .load::<User>(conn)
        })
        .await
        .map_err(|err| {
            error!("Error getting users from DB for bulk transfer: {:?}", err);
            String::from("Internal DB error")
        })?;
    let usernames = users
        .iter()
        .map(|user| user.spotify_id.clone())
        .collect::<Vec<_>>();
    info!(
        "Bulk transferring user data for {user_count} users: {:?}",
        usernames
    );

    let concurrency = concurrency.unwrap_or(1).clamp(1, 5);
    let conns = Arc::new(Mutex::new(vec![conn0, conn1, conn2, conn3, conn4]));
    futures::stream::iter(users)
        .for_each_concurrent(Some(concurrency), |user| {
            let conns = Arc::clone(&conns);
            async move {
                if !user.external_data_retrieved {
                    warn!(
                        "User {} already has external user data stored; downloading + merging and \
                         re-storing everything...",
                        user.spotify_id
                    );
                }

                let conn = match conns.lock().await.pop() {
                    Some(conn) => conn,
                    None => {
                        error!("Shouldn't be possible; ran out of connections");
                        return;
                    },
                };

                crate::external_storage::upload::store_external_user_data(
                    &conn,
                    user.spotify_id.clone(),
                )
                .await;
                info!("Done transferring user data for {}", user.spotify_id);

                conns.lock().await.push(conn);
            }
        })
        .await;

    Ok(status::Custom(Status::Ok, String::new()))
}
