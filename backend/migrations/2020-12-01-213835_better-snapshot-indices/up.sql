CREATE INDEX ordered_by_update_time_per_user ON `spotify_homepage`.`track_rank_snapshots` (user_id, update_time);
CREATE INDEX ordered_by_update_time_per_user ON `spotify_homepage`.`artist_rank_snapshots` (user_id, update_time);
