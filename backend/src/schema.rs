table! {
    artist_history (id) {
        id -> Bigint,
        name -> Varchar,
        genres -> Varchar,
        image_url -> Varchar,
        uri -> Varchar,
    }
}

table! {
    track_history (id) {
        id -> Bigint,
        title -> Varchar,
        artists -> Varchar,
        preview_url -> Varchar,
        album -> Varchar,
        image_url -> Varchar,
    }
}

table! {
    users (id) {
        id -> Bigint,
        creation_time -> Datetime,
        username -> Varchar,
        token -> Varchar,
        refresh_token -> Varchar,
    }
}

allow_tables_to_appear_in_same_query!(
    artist_history,
    track_history,
    users,
);
