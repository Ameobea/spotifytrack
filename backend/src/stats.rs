use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::models::{Artist, TimeFrames, Track};

/// Give an array of top artists, extrapolates the most listened-to genres for each update.
pub fn get_top_genres_by_artists(
    updates: &[(NaiveDateTime, Vec<Artist>)],
    weight: bool,
) -> Vec<(NaiveDateTime, HashMap<String, usize>)> {
    let mut all_genre_counts: Vec<(NaiveDateTime, HashMap<String, usize>)> = Vec::new();

    for (dt, update) in updates {
        let mut genre_counts = HashMap::new();
        let artist_count = update.len();

        for artist in update {
            if let Some(genres) = &artist.genres {
                for (i, genre) in genres.into_iter().enumerate() {
                    let count = genre_counts.entry(genre.clone()).or_insert(0);
                    *count += if weight { artist_count - i } else { 1 };
                }
            }
        }

        all_genre_counts.push((dt.clone(), genre_counts));
    }

    all_genre_counts
}

/// For each timeframe update in a user's update history, computes the artists popularity in each
/// of them and retuns the results as an array of popularities for each update.
pub fn get_artist_popularity_history(
    artist_id: &str,
    artist_history: &[(NaiveDateTime, TimeFrames<String>)],
) -> Vec<(NaiveDateTime, [Option<usize>; 3])> {
    let mut artist_popularity_history = Vec::with_capacity(artist_history.len());
    for (update_timestamp, update) in artist_history {
        let mut popularities_for_update: [Option<usize>; 3] = [None; 3];
        for (i, (_timeframe, artists)) in update.iter().enumerate() {
            let popularity = artists.iter().position(|id| id == artist_id);
            popularities_for_update[i] = popularity;
        }

        artist_popularity_history.push((update_timestamp.clone(), popularities_for_update));
    }

    artist_popularity_history
}
