use std::{io::Read, sync::Mutex};

use chrono::{NaiveDate, NaiveDateTime, Utc};
use diesel::{self, prelude::*};
use fnv::{FnvHashMap as HashMap, FnvHashSet};
use redis::Commands;
use rocket::{
    http::{RawStr, Status},
    response::{status, Redirect},
    State,
};
use rocket_contrib::json::Json;

use crate::{
    benchmarking::{mark, start},
    cache::{get_hash_items, get_redis_conn, set_hash_items},
    conf::CONF,
    db_util::{
        self, get_all_top_artists_for_user, insert_related_artists, retrieve_mapped_spotify_ids,
    },
    models::{
        Artist, ArtistSearchResult, CompareToRequest, CreateSharedPlaylistRequest,
        NewRelatedArtistEntry, NewUser, OAuthTokenResponse, Playlist, RelatedArtistsGraph,
        StatsSnapshot, TimeFrames, Timeline, TimelineEvent, TimelineEventType, Track, User,
        UserComparison,
    },
    spotify_api::{fetch_artists, get_multiple_related_artists, search_artists},
    DbConn, SpotifyTokenData,
};

const SPOTIFY_TOKEN_FETCH_URL: &str = "https://accounts.spotify.com/api/token";

#[get("/")]
pub(crate) fn index() -> &'static str { "Application successfully started!" }

/// Retrieves the current top tracks and artist for the current user
#[get("/stats/<username>")]
pub(crate) fn get_current_stats(
    conn: DbConn,
    conn2: DbConn,
    username: String,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<StatsSnapshot>>, String> {
    start();
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    mark("Finished getting spotify user by id");
    // println!("{:?}", user);

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;
    mark("Got spotify access token");

    let (artist_stats, track_stats) = match rayon::join(
        || db_util::get_artist_stats(&user, conn, &spotify_access_token),
        || db_util::get_track_stats(&user, conn2, &spotify_access_token),
    ) {
        (Err(err), _) | (Ok(_), Err(err)) => return Err(err),
        (Ok(None), _) | (_, Ok(None)) => return Ok(None),
        (Ok(Some(artist_stats)), Ok(Some(track_stats))) => (artist_stats, track_stats),
    };
    mark("Fetched artist and track stats");

    let mut snapshot = StatsSnapshot::new(user.last_update_time);

    for (timeframe_id, artist) in artist_stats {
        snapshot.artists.add_item_by_id(timeframe_id, artist);
    }

    for (timeframe_id, track) in track_stats {
        snapshot.tracks.add_item_by_id(timeframe_id, track);
    }
    mark("Constructed snapshot");

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
pub(crate) fn get_artist_stats(
    conn: DbConn,
    conn2: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    username: String,
    artist_id: String,
) -> Result<Option<Json<ArtistStats>>, String> {
    start();
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    mark("Finished getting spotify user by id");

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;
    mark("Got spotify access token");

    let (artist_popularity_history, (tracks_by_id, top_track_scores)) = match rayon::join(
        || crate::db_util::get_artist_rank_history_single_artist(&user, conn, &artist_id),
        || -> Result<Option<(HashMap<String, Track>, Vec<(String, usize)>)>, String> {
            let (tracks_by_id, track_history) = match db_util::get_track_stats_history(
                &user,
                conn2,
                &spotify_access_token,
                &artist_id,
            )? {
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
    mark("Fetched artists stats and top tracks");

    let artist = match crate::spotify_api::fetch_artists(&spotify_access_token, &[&artist_id])?
        .drain(..)
        .next()
    {
        Some(artist) => artist,
        None => return Ok(None),
    };
    mark("Found matching artist to use");

    let stats = ArtistStats {
        artist,
        tracks_by_id,
        popularity_history: artist_popularity_history,
        top_tracks: top_track_scores,
    };
    Ok(Some(Json(stats)))
}

#[derive(Serialize)]
pub(crate) struct GenresHistory {
    pub timestamps: Vec<NaiveDateTime>,
    pub history_by_genre: HashMap<String, Vec<Option<usize>>>,
}

#[get("/stats/<username>/genre_history")]
pub(crate) fn get_genre_history(
    conn: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    username: String,
) -> Result<Option<Json<GenresHistory>>, String> {
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    // Only include data from the "short" timeframe since we're producing a timeseries
    let (artists_by_id, artist_stats_history) =
        match db_util::get_artist_stats_history(&user, conn, &spotify_access_token, Some(0))? {
            Some(res) => res,
            None => return Ok(None),
        };

    let (timestamps, history_by_genre) =
        crate::stats::get_top_genres_by_artists(&artists_by_id, &artist_stats_history, true);
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
pub(crate) fn get_genre_stats(
    conn: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    username: String,
    genre: String,
) -> Result<Option<Json<GenreStats>>, String> {
    let user = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    let (artists_by_id, genre_stats_history) =
        match db_util::get_genre_stats_history(&user, conn, &spotify_access_token, &genre)? {
            Some(res) => res,
            None => return Ok(None),
        };

    // Compute ranking scores for each of the update items
    let (timestamps, ranking_by_artist_spotify_id_by_timeframe, popularity_history) =
        crate::stats::compute_genre_ranking_history(genre_stats_history);

    Ok(Some(Json(GenreStats {
        artists_by_id,
        top_artists: ranking_by_artist_spotify_id_by_timeframe,
        popularity_history,
        timestamps,
    })))
}

#[get("/stats/<username>/timeline?<start_day_id>&<end_day_id>")]
pub(crate) fn get_timeline(
    conn: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    conn_2: DbConn,
    username: String,
    start_day_id: String,
    end_day_id: String,
) -> Result<Option<Json<Timeline>>, String> {
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

    let User { id: user_id, .. } = match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    let (artist_events, track_events) = rayon::join(
        move || {
            crate::db_util::get_artist_timeline_events(&conn, user_id, start_day, end_day)
                .map_err(crate::db_util::stringify_diesel_err)
        },
        move || {
            crate::db_util::get_track_timeline_events(&conn_2, user_id, start_day, end_day)
                .map_err(crate::db_util::stringify_diesel_err)
        },
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
    let (artists, tracks) = rayon::join(
        || crate::spotify_api::fetch_artists(&spotify_access_token, &artist_ids),
        || crate::spotify_api::fetch_tracks(&spotify_access_token, &track_ids),
    );
    let (artists, tracks) = (artists?, tracks?);

    let mut events = Vec::new();
    events.push(TimelineEvent {
        event_type: TimelineEventType::FirstUpdate,
        date: NaiveDate::from_ymd(2020, 4, 20),
        id: 1000000,
    });
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

    Ok(Some(Json(Timeline { events })))
}

/// Redirects to the Spotify authorization page for the application
#[get("/authorize?<playlist_perms>&<state>")]
pub(crate) fn authorize(playlist_perms: Option<&RawStr>, state: Option<&RawStr>) -> Redirect {
    let scopes = match playlist_perms.map(|s| s.as_str()) {
        None | Some("false") | Some("False") | Some("0") => "user-top-read",
        _ => "user-top-read%20playlist-modify-public",
    };
    let callback_uri = crate::conf::CONF.get_absolute_oauth_cb_uri();

    Redirect::to(format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}",
        CONF.client_id,
        callback_uri,
        scopes,
        state.map(|s| s.as_str()).unwrap_or("")
    ))
}

/// The playlist will be generated on the account of user2
fn generate_shared_playlist(
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    bearer_token: &str,
    user1: &str,
    user2: &str,
) -> Result<Option<Playlist>, String> {
    let (user1_res, user2_res) = rayon::join(
        move || {
            db_util::get_user_by_spotify_id(&conn1, user1)
                .map(|user_opt| user_opt.map(|user| (user, conn1)))
        },
        move || {
            db_util::get_user_by_spotify_id(&conn2, user2)
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
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    if let Some(res) = db_util::refresh_user_access_token(&conn1, &mut user2)? {
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
        )?;

    let created_playlist = crate::spotify_api::create_playlist(
        bearer_token,
        &user2,
        format!("Shared Tastes of {} and {}", user1.username, user2.username),
        Some(format!(
            "Contains tracks and artists that both {} and {} enjoy, {}",
            user1.username, user2.username, "generated by spotifytrack.net"
        )),
        &playlist_track_spotify_ids,
    )?;

    Ok(Some(created_playlist))
}

/// This handles the OAuth authentication process for new users.  It is hit as the callback for the
/// authentication request and handles retrieving user tokens, creating an entry for the user in the
/// users table, and fetching an initial stats snapshot.
#[get("/oauth_cb?<error>&<code>&<state>")]
pub(crate) fn oauth_cb(
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    error: Option<&RawStr>,
    code: &RawStr,
    state: Option<&RawStr>,
) -> Result<Redirect, String> {
    use crate::schema::users;

    if error.is_some() {
        error!("Error during Oauth authorization process: {:?}", error);
        return Err("An error occured while authenticating with Spotify.".into());
    }

    let oauth_cb_url = crate::conf::CONF.get_absolute_oauth_cb_uri();

    // Shoot the code back to Spotify and get an API token for the user in return
    let mut params = HashMap::default();
    params.insert("grant_type", "authorization_code");
    params.insert("code", code.as_str());
    params.insert("redirect_uri", oauth_cb_url.as_str());
    params.insert("client_id", CONF.client_id.as_str());
    params.insert("client_secret", CONF.client_secret.as_str());

    let client = reqwest::blocking::Client::new();
    info!("Making request to fetch user token from OAuth CB response...");
    let res = client
        .post(SPOTIFY_TOKEN_FETCH_URL)
        .form(&params)
        .send()
        .map_err(|_| -> String {
            "Error fetching token from Spotify from response Oauth code".into()
        })?;

    let res: OAuthTokenResponse = match res.json() {
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
    let user_profile_info = crate::spotify_api::get_user_profile_info(&access_token)?;
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

    match diesel::insert_into(users::table)
        .values(&user)
        .execute(&conn1.0)
    {
        Err(diesel::result::Error::DatabaseError(
            diesel::result::DatabaseErrorKind::UniqueViolation,
            _,
        )) => {
            diesel::update(users::table)
                .filter(users::dsl::spotify_id.eq(&user_spotify_id))
                .set((
                    users::dsl::refresh_token.eq(refresh_token),
                    users::dsl::token.eq(&access_token),
                ))
                .execute(&conn1.0)
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
            let user = crate::db_util::get_user_by_spotify_id(&conn1, &user_spotify_id)?
                .expect("Failed to load just inserted user from database");

            // Create an initial stats snapshot to store for the user
            let cur_user_stats = match crate::spotify_api::fetch_cur_stats(&user)? {
                Some(stats) => stats,
                None => {
                    error!(
                        "Failed to fetch stats for user \"{}\"; bad response from Spotify API?",
                        username
                    );
                    return Err("Error fetching user stats from the Spotify API.".into());
                },
            };

            crate::spotify_api::store_stats_snapshot(&conn1, &user, cur_user_stats)?;
        },
    };

    match state {
        Some(s) if !s.is_empty() => {
            let percent_decoded = s.percent_decode().map_err(|_| {
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
                    )?;

                    match playlist {
                        Some(playlist) => {
                            let encoded_playlist = serde_json::to_string(&json!({
                                "uri": playlist.uri,
                                "track_count": playlist.tracks.total,
                                "name": playlist.name
                            }))
                            .map_err(|err| {
                                error!("Error JSON-encoding playlist: {:?}", err);
                                "Internal error while generating playlist".to_string()
                            })?;
                            let encoded_playlist =
                                rocket::http::uri::Uri::percent_encode(&encoded_playlist);
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

    let redirect_url = match state.map(|s| s.as_str()) {
        Some(s) if s.starts_with("/") => format!("{}{}", CONF.website_url, s),
        _ => format!("{}/stats/{}", CONF.website_url, user_spotify_id),
    };

    // Redirect the user to their stats page
    Ok(Redirect::to(redirect_url))
}

/// Returns `true` if the token is valid, false if it's not
fn validate_api_token(api_token_data: rocket::data::Data) -> Result<bool, String> {
    let mut api_token: String = String::new();
    api_token_data
        .open()
        .take(1024 * 1024)
        .read_to_string(&mut api_token)
        .map_err(|err| {
            error!("Error reading provided admin API token: {:?}", err);
            String::from("Error reading post data body")
        })
        .map(|_| api_token == CONF.admin_api_token)
}

/// This route is internal and hit by the cron job that is called to periodically update the stats
/// for the least recently updated user.
#[post("/update_user?<user_id>", data = "<api_token_data>")]
pub(crate) fn update_user(
    conn: DbConn,
    api_token_data: rocket::data::Data,
    user_id: Option<&RawStr>,
) -> Result<status::Custom<String>, String> {
    use crate::schema::users::dsl::*;

    if !validate_api_token(api_token_data)? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    // Get the least recently updated user
    let mut user: User = match user_id.clone().map(|s| s.percent_decode()) {
        Some(s) => {
            let user_id = s.map_err(|_| {
                error!("Invalid `user_id` param provided to `/update/user`");
                String::from("Invalid `user_id` param; couldn't decode")
            })?;

            users.filter(spotify_id.eq(user_id.as_ref())).first(&conn.0)
        },
        None => users.order_by(last_update_time).first(&conn.0),
    }
    .map_err(|err| -> String {
        error!("{:?}", err);
        "Error querying user to update from database".into()
    })?;

    if let Some(res) = db_util::refresh_user_access_token(&conn, &mut user)? {
        return Ok(res);
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
        return Ok(status::Custom(Status::Ok, msg));
    }
    info!("{} since last update; proceeding with update.", diff);

    let stats = match crate::spotify_api::fetch_cur_stats(&user)? {
        Some(stats) => stats,
        None => {
            error!(
                "Error when fetching stats for user {:?}; no stats returned.",
                user
            );
            return Err("No data from Spotify API for that user".into());
        },
    };

    crate::spotify_api::store_stats_snapshot(&conn, &user, stats)?;

    Ok(status::Custom(
        Status::Ok,
        format!("Successfully updated user {}", user.username),
    ))
}

#[post("/populate_tracks_artists_mapping_table", data = "<api_token_data>")]
pub(crate) fn populate_tracks_artists_mapping_table(
    conn: DbConn,
    api_token_data: rocket::data::Data,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data)? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    crate::db_util::populate_tracks_artists_table(&conn, &spotify_access_token)?;

    Ok(status::Custom(
        Status::Ok,
        "Sucessfully populated mapping table".into(),
    ))
}

#[post("/populate_artists_genres_mapping_table", data = "<api_token_data>")]
pub(crate) fn populate_artists_genres_mapping_table(
    conn: DbConn,
    api_token_data: rocket::data::Data,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data)? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    crate::db_util::populate_artists_genres_table(&conn, &spotify_access_token)?;

    Ok(status::Custom(
        Status::Ok,
        "Sucessfully populated mapping table".into(),
    ))
}

fn compute_comparison(
    user1: &str,
    user2: &str,
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<Option<UserComparison>, String> {
    let (user1_res, user2_res) = rayon::join(
        move || {
            db_util::get_user_by_spotify_id(&conn1, &user1)
                .map(|user_opt| user_opt.map(|user| (user, conn1)))
        },
        move || {
            db_util::get_user_by_spotify_id(&conn2, &user2)
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
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;
    let spotify_access_token_clone = spotify_access_token.clone();

    let (tracks_intersection, artists_intersection) = rayon::join(
        move || {
            let (user1_tracks, user2_tracks) = rayon::join(
                move || {
                    crate::db_util::get_all_top_tracks_for_user(&conn1, user1_id)
                        .map_err(db_util::stringify_diesel_err)
                },
                move || {
                    crate::db_util::get_all_top_tracks_for_user(&conn2, user2_id)
                        .map_err(db_util::stringify_diesel_err)
                },
            );
            let (user1_tracks, user2_tracks) = (user1_tracks?, user2_tracks?);

            let mut intersection = user1_tracks;
            intersection.retain(|(id, _)| user2_tracks.iter().any(|(o_id, _)| *o_id == *id));

            let spotify_ids = intersection
                .iter()
                .map(|(_, spotify_id)| spotify_id.as_str())
                .collect::<Vec<_>>();
            crate::spotify_api::fetch_tracks(&spotify_access_token, &spotify_ids)
        },
        move || {
            let (user1_artists, user2_artists) = rayon::join(
                move || {
                    crate::db_util::get_all_top_artists_for_user(&conn3, user1_id)
                        .map_err(db_util::stringify_diesel_err)
                },
                move || {
                    crate::db_util::get_all_top_artists_for_user(&conn4, user2_id)
                        .map_err(db_util::stringify_diesel_err)
                },
            );
            let (user1_artists, user2_artists) = (user1_artists?, user2_artists?);

            let mut intersection = user1_artists;
            intersection.retain(|(id, _)| user2_artists.iter().any(|(o_id, _)| *o_id == *id));

            let spotify_ids = intersection
                .iter()
                .map(|(_, spotify_id)| spotify_id.as_str())
                .collect::<Vec<_>>();
            crate::spotify_api::fetch_artists(&spotify_access_token_clone, &spotify_ids)
        },
    );

    let (tracks_intersection, artists_intersection) = (tracks_intersection?, artists_intersection?);

    Ok(Some(UserComparison {
        tracks: tracks_intersection,
        artists: artists_intersection,
        genres: Vec::new(), // TODO
        user1_username: user1.username,
        user2_username: user2.username,
    }))
}

#[get("/compare/<user1>/<user2>")]
pub(crate) fn compare_users(
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    token_data: State<Mutex<SpotifyTokenData>>,
    user1: String,
    user2: String,
) -> Result<Option<Json<UserComparison>>, String> {
    compute_comparison(&user1, &user2, conn1, conn2, conn3, conn4, token_data)
        .map(|res| res.map(Json))
}

fn build_related_artists_graph(
    spotify_access_token: String,
    artist_ids: &[&str],
) -> Result<RelatedArtistsGraph, String> {
    // Get related artists for all of them
    let related_artists = get_multiple_related_artists(spotify_access_token.clone(), artist_ids)?;

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
    let extra_artists_list = fetch_artists(&spotify_access_token, &all_artist_ids)?;
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
pub(crate) fn get_related_artists_graph(
    conn: DbConn,
    user_id: String,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<RelatedArtistsGraph>>, String> {
    let User { id: user_id, .. } = match db_util::get_user_by_spotify_id(&conn, &user_id)? {
        Some(user) => user,
        None => {
            return Ok(None);
        },
    };
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    // Start off by getting all artists for the user from all timeframes
    let all_artists_for_user = get_all_top_artists_for_user(&conn, user_id).map_err(|err| {
        error!("Error fetching all artists for user: {:?}", err);
        String::from("Internal DB error")
    })?;
    let all_artist_ids_for_user: Vec<&str> = all_artists_for_user
        .iter()
        .map(|(_internal_id, spotify_id)| spotify_id.as_str())
        .collect();

    let out = build_related_artists_graph(spotify_access_token, &all_artist_ids_for_user)?;
    Ok(Some(Json(out)))
}

#[get("/related_artists/<artist_id>")]
pub(crate) fn get_related_artists(
    artist_id: String,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<Option<Json<RelatedArtistsGraph>>, String> {
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    let related_artist_ids =
        get_multiple_related_artists(spotify_access_token.clone(), &[&artist_id])?;
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

    let out = build_related_artists_graph(spotify_access_token, &related_artist_ids)?;
    Ok(Some(Json(out)))
}

#[get("/display_name/<username>")]
pub(crate) fn get_display_name(conn: DbConn, username: String) -> Result<Option<String>, String> {
    match db_util::get_user_by_spotify_id(&conn, &username)? {
        Some(user) => Ok(Some(user.username)),
        None => Ok(None),
    }
}

#[post("/dump_redis_related_artists_to_database", data = "<api_token_data>")]
pub(crate) fn dump_redis_related_artists_to_database(
    conn: DbConn,
    api_token_data: rocket::Data,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data)? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let mut redis_conn = get_redis_conn()?;
    let all_values: Vec<String> = redis_conn.hgetall("related_artists").map_err(|err| {
        error!("Error with HGETALL on related artists data: {:?}", err);
        String::from("Redis error")
    })?;

    let mapped_spotify_ids =
        retrieve_mapped_spotify_ids(&conn, all_values.chunks_exact(2).map(|chunk| &chunk[0]))
            .map_err(|err| {
                error!("Error mapping spotify ids: {:?}", err);
                String::from("Error mapping spotify ids")
            })?;

    let entries: Vec<NewRelatedArtistEntry> = all_values
        .chunks_exact(2)
        .map(|val| {
            let artist_spotify_id = &val[0];
            let related_artists_json = val[1].clone();
            let artist_spotify_id = *mapped_spotify_ids
                .get(artist_spotify_id)
                .expect("Spotify ID didn't get mapped");

            NewRelatedArtistEntry {
                artist_spotify_id,
                related_artists_json,
            }
        })
        .collect();

    for entries in entries.chunks(500) {
        insert_related_artists(&conn, &entries).map_err(|err| {
            error!("DB error inserting related artist into DB: {:?}", err);
            String::from("DB error")
        })?;
    }

    Ok(status::Custom(
        Status::Ok,
        String::from("Successfully dumped all related artists from Redis to MySQL"),
    ))
}

#[post("/crawl_related_artists", data = "<api_token_data>")]
pub(crate) fn crawl_related_artists(
    api_token_data: rocket::Data,
    token_data: State<Mutex<SpotifyTokenData>>,
) -> Result<status::Custom<String>, String> {
    if !validate_api_token(api_token_data)? {
        return Ok(status::Custom(
            Status::Unauthorized,
            "Invalid API token supplied".into(),
        ));
    }

    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    let mut redis_conn = get_redis_conn()?;
    let artist_ids: Vec<String> = redis::cmd("HRANDFIELD")
        .arg("related_artists")
        .arg("8")
        .query::<Vec<String>>(&mut *redis_conn)
        .map_err(|err| {
            error!(
                "Error getting random related artist keys from DB: {:?}",
                err
            );
            String::from("Redis error")
        })?;

    let mut all_related_artists: Vec<String> = Vec::new();

    for artist_id in artist_ids {
        let related_artists_json: String =
            redis_conn
                .hget("related_artists", artist_id)
                .map_err(|err| {
                    error!("Error getting related artist from Redis: {:?}", err);
                    String::from("Redis error")
                })?;

        let related_artist_ids: Vec<String> =
            serde_json::from_str(&related_artists_json).map_err(|_err| {
                error!(
                    "Invalid entry in related artists Redis; can't parse into array of strings; \
                     found={}",
                    related_artists_json
                );
                String::from("Internal error")
            })?;

        all_related_artists.extend(related_artist_ids.into_iter());
    }

    info!("Crawling {} related artists...", all_related_artists.len());
    let mut all_related_artists: Vec<&str> =
        all_related_artists.iter().map(String::as_str).collect();
    all_related_artists.sort_unstable();
    all_related_artists.dedup();

    let fetched = get_multiple_related_artists(spotify_access_token.clone(), &all_related_artists)?;
    Ok(status::Custom(
        Status::Ok,
        format!(
            "Successfully fetched {} related artists to poulate related artists Redis hash",
            fetched.len()
        ),
    ))
}

#[get("/search_artist?<q>")]
pub(crate) fn search_artist(
    token_data: State<Mutex<SpotifyTokenData>>,
    q: String,
) -> Result<Json<Vec<ArtistSearchResult>>, String> {
    let spotify_access_token = {
        let token_data = &mut *(&*token_data).lock().unwrap();
        token_data.get()
    }?;

    // First check cache
    let cached_item = get_hash_items::<Vec<ArtistSearchResult>>("artistSearch", &[&q])
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

    // Hit the Spotify API and store in the cache
    let search_results = search_artists(spotify_access_token, &q)?;
    set_hash_items::<Vec<ArtistSearchResult>>("artistSearch", &[(&q, search_results.clone())])
        .map_err(|err| {
            error!("Error storing artist search in cache: {}", err);
            String::from("Internal error with cache")
        })?;
    info!(
        "Successfully hit Spotify API for artist search query={:?} and stored in cache",
        q
    );

    Ok(Json(search_results))
}
