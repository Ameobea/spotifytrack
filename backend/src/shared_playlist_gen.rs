use rand::prelude::*;

use crate::{
    models::{Track, User},
    DbConn,
};

pub(crate) fn generate_shared_playlist_track_spotify_ids(
    conn1: DbConn,
    conn2: DbConn,
    conn3: DbConn,
    conn4: DbConn,
    user1: &User,
    user2: &User,
    spotify_access_token: &str,
) -> Result<Vec<String>, String> {
    let (user1_id, user2_id) = (user1.id, user2.id);

    let (tracks_res, artists_res) = rayon::join(
        move || -> Result<_, String> {
            let (user1_tracks, user2_tracks) = rayon::join(
                move || {
                    crate::db_util::get_all_top_tracks_for_user(&conn1, user1_id)
                        .map_err(crate::db_util::stringify_diesel_err)
                        .and_then(|tracks| {
                            let track_spotify_ids = tracks
                                .iter()
                                .map(|(_, spotify_id)| spotify_id.as_str())
                                .collect::<Vec<_>>();

                            crate::spotify_api::fetch_tracks(
                                &spotify_access_token,
                                &track_spotify_ids,
                            )
                        })
                },
                move || {
                    crate::db_util::get_all_top_tracks_for_user(&conn2, user2_id)
                        .map_err(crate::db_util::stringify_diesel_err)
                        .and_then(|tracks| {
                            let track_spotify_ids = tracks
                                .iter()
                                .map(|(_, spotify_id)| spotify_id.as_str())
                                .collect::<Vec<_>>();

                            crate::spotify_api::fetch_tracks(
                                &spotify_access_token,
                                &track_spotify_ids,
                            )
                        })
                },
            );
            let (user1_tracks, user2_tracks) = (user1_tracks?, user2_tracks?);

            Ok((user1_tracks, user2_tracks))
        },
        move || -> Result<_, String> {
            let (user1_artists, user2_artists) = rayon::join(
                move || {
                    crate::db_util::get_all_top_artists_for_user(&conn3, user1_id)
                        .map_err(crate::db_util::stringify_diesel_err)
                        .and_then(|artists| {
                            let artist_spotify_ids = artists
                                .iter()
                                .map(|(_, spotify_id)| spotify_id.as_str())
                                .collect::<Vec<_>>();

                            crate::spotify_api::fetch_artists(
                                spotify_access_token,
                                &artist_spotify_ids,
                            )
                        })
                },
                move || {
                    crate::db_util::get_all_top_artists_for_user(&conn4, user2_id)
                        .map_err(crate::db_util::stringify_diesel_err)
                        .and_then(|artists| {
                            let artist_spotify_ids = artists
                                .iter()
                                .map(|(_, spotify_id)| spotify_id.as_str())
                                .collect::<Vec<_>>();

                            crate::spotify_api::fetch_artists(
                                spotify_access_token,
                                &artist_spotify_ids,
                            )
                        })
                },
            );
            let (user1_artists, user2_artists) = (user1_artists?, user2_artists?);

            Ok((user1_artists, user2_artists))
        },
    );
    let ((user1_tracks, user2_tracks), (user1_artists, user2_artists)) =
        (tracks_res?, artists_res?);

    let mut playlist_tracks: Vec<&Track> = Vec::new();

    // Start by just adding all of the tracks for which there is intersection
    let tracks_intersection = user1_tracks
        .iter()
        .filter(|track| user2_tracks.iter().any(|o_track| o_track.id == track.id));
    playlist_tracks.extend(tracks_intersection);

    // Then, add the top 3-5 top tracks for each user-artist pair that aren't already in there evn
    // if there is no track-level intersection, meaning that each user's favorites that for
    // shared artists are included
    let artists_intersection = user1_artists.iter().filter(|artist| {
        user2_artists
            .iter()
            .any(|o_artist| o_artist.id == artist.id)
    });

    for artist in artists_intersection {
        let tangential_tracks_for_artist = user1_tracks
            .iter()
            .chain(user2_tracks.iter())
            .filter(|track| {
                track
                    .artists
                    .iter()
                    .any(|o_artist| o_artist.id == artist.id)
            })
            .take(5);

        playlist_tracks.extend(tangential_tracks_for_artist);
    }

    playlist_tracks.sort_unstable_by(|track1, track2| track1.id.cmp(&track2.id));
    playlist_tracks.dedup_by(|track1, track2| track1.id == track2.id);
    playlist_tracks.shuffle(&mut thread_rng());

    Ok(playlist_tracks
        .into_iter()
        .map(|track| format!("spotify:track:{track_id}", track_id = track.id))
        .collect())
}
