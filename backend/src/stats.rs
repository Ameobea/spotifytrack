use std::cmp::Reverse;
use std::collections::HashMap;

use chrono::NaiveDateTime;

use crate::models::{Artist, TimeFrames, Track};

/// Give an array of top artists, extrapolates the most listened-to genres for each update.
pub fn get_top_genres_by_artists(
    artists_by_id: &HashMap<String, Artist>,
    updates: &[(NaiveDateTime, TimeFrames<String>)],
    weight: bool,
) -> Vec<(NaiveDateTime, HashMap<String, usize>)> {
    let mut all_genre_counts: Vec<(NaiveDateTime, HashMap<String, usize>)> = Vec::new();

    for (dt, update) in updates {
        let mut genre_counts = HashMap::new();

        for (tf, artist_ids) in update.iter() {
            let artist_count = artist_ids.len();

            for artist_id in artist_ids {
                let artist = artists_by_id
                    .get(&*artist_id)
                    .expect(&format!("Artist with id {} not found in corpus", artist_id));
                if let Some(genres) = &artist.genres {
                    for (i, genre) in genres.into_iter().enumerate() {
                        let count = genre_counts.entry(genre.clone()).or_insert(0);
                        *count += if weight { artist_count - i } else { 1 };
                    }
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

/// Gets a list of all tracks for a given artist that a user has ever had in their top tracks for
/// any time period, sorted by their frequency of appearance and ranking when appeared.
///
/// TODO: Set up some kind of caching mechanism that maps artists to the list of tracks by that artist.
pub fn get_tracks_for_artist(
    artist_id: &str,
    tracks_by_id: &HashMap<String, Track>,
    track_history: &[(NaiveDateTime, TimeFrames<String>)],
) -> Vec<(String, usize)> {
    let mut track_scores: HashMap<String, usize> = HashMap::new();

    for (_update_timestamp, track_stats_for_update) in track_history {
        for (_timeframe, track_ids) in track_stats_for_update.iter() {
            let track_count = track_ids.len();

            let track_ids_by_artist = track_ids.iter().enumerate().filter(|(_i, track_id)| {
                let track: &Track = tracks_by_id.get(track_id.clone()).unwrap();
                track
                    .album
                    .artists
                    .iter()
                    .find(|artist| artist.id == artist_id)
                    .is_some()
            });

            for (i, track_id) in track_ids_by_artist {
                let score_sum = track_scores.entry(track_id.clone()).or_insert(0);
                *score_sum += track_count - i;
            }
        }
    }

    let mut top_tracks: Vec<_> = track_scores.into_iter().collect();
    // Put them in order from most to least popular
    top_tracks.sort_by_key(|(_track_id, score)| Reverse(*score));
    top_tracks
}
