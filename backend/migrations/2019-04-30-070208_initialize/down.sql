START TRANSACTION;
  DROP TABLE `spotify_homepage`.`track_rank_snapshots`;
  DROP TABLE `spotify_homepage`.`artist_rank_snapshots`;
  DROP TABLE `spotify_homepage`.`spotify_items`;
  DROP TABLE `spotify_homepage`.`tracks_artists`;

  -- Drop the `users` table last due to foreign key constraints
  DROP TABLE `spotify_homepage`.`users`;
COMMIT;
