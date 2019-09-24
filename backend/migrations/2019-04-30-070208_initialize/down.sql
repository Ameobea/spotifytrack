START TRANSACTION;
  DROP TABLE `spotify_homepage`.`track_history`;
  DROP TABLE `spotify_homepage`.`artist_history`;
  DROP TABLE `spotify_homepage`.`artist_stats_history`;
  DROP TABLE `spotify_homepage`.`track_stats_history`;
  DROP TABLE `spotify_homepage`.`spotify_id_mapping`;

  -- Drop the `users` table last due to foreign key constraints
  DROP TABLE `spotify_homepage`.`users`;

COMMIT;
