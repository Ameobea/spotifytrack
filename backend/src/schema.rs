// @generated automatically by Diesel CLI.

diesel::table! {
    artist_rank_snapshots (id) {
        id -> Bigint,
        user_id -> Bigint,
        update_time -> Datetime,
        mapped_spotify_id -> Integer,
        timeframe -> Unsigned<Tinyint>,
        ranking -> Unsigned<Tinyint>,
    }
}

diesel::table! {
    artist_stats_history (id) {
        id -> Bigint,
        spotify_id -> Varchar,
        followers -> Unsigned<Bigint>,
        popularity -> Unsigned<Bigint>,
        uri -> Text,
    }
}

diesel::table! {
    artists_genres (id) {
        id -> Integer,
        artist_id -> Integer,
        genre -> Varchar,
    }
}

diesel::table! {
    artists_users_first_seen (user_id, mapped_spotify_id) {
        user_id -> Bigint,
        mapped_spotify_id -> Integer,
        first_seen -> Datetime,
    }
}

diesel::table! {
    related_artists (artist_spotify_id) {
        artist_spotify_id -> Integer,
        related_artists_json -> Text,
    }
}

diesel::table! {
    spotify_items (id) {
        id -> Integer,
        spotify_id -> Varchar,
    }
}

diesel::table! {
    track_rank_snapshots (id) {
        id -> Bigint,
        user_id -> Bigint,
        update_time -> Datetime,
        mapped_spotify_id -> Integer,
        timeframe -> Unsigned<Tinyint>,
        ranking -> Unsigned<Tinyint>,
    }
}

diesel::table! {
    track_stats_history (id) {
        id -> Bigint,
        followers -> Unsigned<Bigint>,
        popularity -> Unsigned<Bigint>,
        playcount -> Nullable<Unsigned<Bigint>>,
    }
}

diesel::table! {
    tracks_artists (id) {
        id -> Integer,
        track_id -> Integer,
        artist_id -> Integer,
    }
}

diesel::table! {
    tracks_users_first_seen (user_id, mapped_spotify_id) {
        user_id -> Bigint,
        mapped_spotify_id -> Integer,
        first_seen -> Datetime,
    }
}

diesel::table! {
    users (id) {
        id -> Bigint,
        creation_time -> Datetime,
        last_update_time -> Datetime,
        spotify_id -> Varchar,
        username -> Text,
        token -> Text,
        refresh_token -> Text,
        external_data_retrieved -> Bool,
        last_viewed -> Timestamp,
        last_external_data_store -> Timestamp,
    }
}

diesel::joinable!(artist_rank_snapshots -> spotify_items (mapped_spotify_id));
diesel::joinable!(artist_rank_snapshots -> users (user_id));
diesel::joinable!(artists_genres -> spotify_items (artist_id));
diesel::joinable!(related_artists -> spotify_items (artist_spotify_id));
diesel::joinable!(track_rank_snapshots -> spotify_items (mapped_spotify_id));
diesel::joinable!(track_rank_snapshots -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    artist_rank_snapshots,
    artist_stats_history,
    artists_genres,
    artists_users_first_seen,
    related_artists,
    spotify_items,
    track_rank_snapshots,
    track_stats_history,
    tracks_artists,
    tracks_users_first_seen,
    users,
);
