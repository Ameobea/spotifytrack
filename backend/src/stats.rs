use std::cmp::Reverse;

use chrono::NaiveDateTime;
use hashbrown::{HashMap, HashSet};

use crate::models::{Artist, TimeFrames};

/// This is a pretty arbitrary algorithm with the goal of assigning a score to an item based on how many total items
/// there are and the item's rank in the collection.  It is used to construct the genres treemap on the frontend.
fn weight_data_point(total_items: usize, ranking: usize) -> usize {
    (((total_items - ranking) as f32)
        .powf(2.7 * ((total_items - ranking) as f32 / total_items as f32))) as usize
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
pub fn compute_track_popularity_scores(
    track_rank_snapshots: &[(NaiveDateTime, TimeFrames<String>)],
) -> Vec<(String, usize)> {
    let mut track_scores: HashMap<String, usize> = HashMap::new();

    for (_update_timestamp, track_stats_for_update) in track_rank_snapshots {
        for (_timeframe, track_ids) in track_stats_for_update.iter() {
            let track_count = track_ids.len();

            for (i, track_id) in track_ids.iter().enumerate() {
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

pub fn compute_genre_ranking_history(
    updates: Vec<(NaiveDateTime, TimeFrames<crate::db_util::ArtistRanking>)>,
) -> (
    Vec<NaiveDateTime>,
    Vec<(String, f32)>,
    TimeFrames<usize>,
) {
    let timestamps: Vec<NaiveDateTime> = updates.iter().map(|(ts, _)| ts.clone()).collect();

    // Compute rankings for each artist within the genre according to its cumulative score based
    // off of ranking, scaling back linearly as updates get older.  We may want to re-think this
    // ranking strategy in the future.
    let update_count = updates.len();
    let mut rankings_by_artist_spotify_id: HashMap<String, f32> = HashMap::new();
    for (i, (_ts, timeframes)) in updates.iter().enumerate() {
        for (_timeframe, rankings) in timeframes.iter() {
            for ranking in rankings {
                let recency_factor = ((i + 1) as f32) / (update_count as f32);
                let score = weight_data_point(50, ranking.ranking as usize) as f32 * recency_factor;

                let entry = rankings_by_artist_spotify_id
                    .entry(ranking.artist_spotify_id.clone())
                    .or_insert(0.0);
                *entry += score;
            }
        }
    }

    let mut artist_rankings = rankings_by_artist_spotify_id.into_iter().collect::<Vec<_>>();
    artist_rankings.sort_unstable_by_key(|ranking| Reverse((ranking.1 * 10000.0) as usize));

    let popularity_history = TimeFrames::flat_map(
        updates.into_iter().map(|(_, timeframes)| timeframes),
        |items: Vec<crate::db_util::ArtistRanking>| {
            items
                .into_iter()
                .map(|item| weight_data_point(50, item.ranking as usize))
                .sum()
        },
    );

    (
        timestamps,
        artist_rankings,
        popularity_history,
    )
}
