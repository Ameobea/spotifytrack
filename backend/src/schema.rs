table! {
    artist_rank_snapshots (id) {
        id -> Bigint,
        user_id -> Bigint,
        update_time -> Datetime,
        mapped_spotify_id -> Integer,
        timeframe -> Unsigned<Tinyint>,
        ranking -> Unsigned<Smallint>,
    }
}

table! {
    spotify_items (id) {
        id -> Integer,
        spotify_id -> Varchar,
    }
}

table! {
    tracks_artists (id) {
        id -> Integer,
        track_id -> Integer,
        artist_id -> Integer,
    }
}

table! {
    track_rank_snapshots (id) {
        id -> Bigint,
        user_id -> Bigint,
        update_time -> Datetime,
        mapped_spotify_id -> Integer,
        timeframe -> Unsigned<Tinyint>,
        ranking -> Unsigned<Smallint>,
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

joinable!(artist_rank_snapshots -> spotify_items (mapped_spotify_id));
joinable!(artist_rank_snapshots -> users (user_id));
joinable!(track_rank_snapshots -> spotify_items (mapped_spotify_id));
joinable!(track_rank_snapshots -> users (user_id));

allow_tables_to_appear_in_same_query!(
    artist_rank_snapshots,
    spotify_items,
    tracks_artists,
    track_rank_snapshots,
    users,
);
