table! {
    artist_history (id) {
        id -> Bigint,
        user_id -> Bigint,
        update_time -> Datetime,
        mapped_spotify_id -> Integer,
        timeframe -> Unsigned<Tinyint>,
        ranking -> Unsigned<Smallint>,
    }
}

table! {
    artist_stats_history (id) {
        id -> Bigint,
        spotify_id -> Varchar,
        followers -> Unsigned<Bigint>,
        popularity -> Unsigned<Bigint>,
        uri -> Text,
    }
}

table! {
    spotify_id_mapping (id) {
        id -> Integer,
        spotify_id -> Varchar,
    }
}

table! {
    track_artist_mapping (id) {
        id -> Integer,
        track_id -> Integer,
        artist_id -> Integer,
    }
}

table! {
    track_history (id) {
        id -> Bigint,
        user_id -> Bigint,
        update_time -> Datetime,
        mapped_spotify_id -> Integer,
        timeframe -> Unsigned<Tinyint>,
        ranking -> Unsigned<Smallint>,
    }
}

table! {
    track_stats_history (id) {
        id -> Bigint,
        followers -> Unsigned<Bigint>,
        popularity -> Unsigned<Bigint>,
        playcount -> Nullable<Unsigned<Bigint>>,
    }
}

table! {
    users (id) {
        id -> Bigint,
        creation_time -> Datetime,
        last_update_time -> Datetime,
        spotify_id -> Varchar,
        username -> Text,
        token -> Text,
        refresh_token -> Text,
    }
}

joinable!(artist_history -> spotify_id_mapping (mapped_spotify_id));
joinable!(artist_history -> users (user_id));
joinable!(track_history -> spotify_id_mapping (mapped_spotify_id));
joinable!(track_history -> users (user_id));

allow_tables_to_appear_in_same_query!(
    artist_history,
    artist_stats_history,
    spotify_id_mapping,
    track_artist_mapping,
    track_history,
    track_stats_history,
    users,
);
