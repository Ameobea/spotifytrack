use std::cmp::Reverse;

use chrono::NaiveDateTime;
use hashbrown::{HashMap, HashSet};

use crate::models::{Artist, TimeFrames, Track};

fn weight_data_point(total_items: usize, i: usize) -> usize {
    (((total_items - i) as f32).powf(2.7 * ((total_items - i) as f32 / total_items as f32)))
        as usize
}

/// Give an array of top artists, extrapolates the most listened-to genres for each update.
pub fn get_top_genres_by_artists(
    artists_by_id: &HashMap<String, Artist>,
    updates: &[(NaiveDateTime, TimeFrames<String>)],
    weight: bool,
) -> (Vec<NaiveDateTime>, HashMap<String, Vec<Option<usize>>>) {
    let mut all_timestamps: Vec<NaiveDateTime> = Vec::with_capacity(updates.len());
    let mut all_genre_counts: Vec<HashMap<String, usize>> = Vec::new();
    let mut all_genres: HashSet<String> = HashSet::new();

    for (dt, update) in updates {
        all_timestamps.push(*dt);
        let mut genre_counts = HashMap::new();

        for (_tf, artist_ids) in update.iter() {
            let artist_count = artist_ids.len();

            for (i, artist_id) in artist_ids.into_iter().enumerate() {
                let artist = artists_by_id
                    .get(&*artist_id)
                    .expect(&format!("Artist with id {} not found in corpus", artist_id));
                if let Some(genres) = &artist.genres {
                    for genre in genres {
                        all_genres.insert(genre.clone());
                        let count = genre_counts.entry(genre.clone()).or_insert(0);
                        *count += if weight {
                            weight_data_point(artist_count, i)
                        } else {
                            1
                        };
                    }
                }
            }
        }

        all_genre_counts.push(genre_counts);
    }

    let mut counts_by_genre = HashMap::new();
    for genre in all_genres {
        counts_by_genre.insert(genre, Vec::with_capacity(all_timestamps.len()));
    }
    for counts_by_genre_for_update in all_genre_counts {
        for (genre, scores) in counts_by_genre.iter_mut() {
            let count_for_period = counts_by_genre_for_update.get(genre).copied();
            scores.push(count_for_period);
        }
    }

    (all_timestamps, counts_by_genre)
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
