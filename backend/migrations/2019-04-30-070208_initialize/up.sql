START TRANSACTION;
  CREATE TABLE `spotify_homepage`.`users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `creation_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `spotify_id` VARCHAR(191) UNIQUE NOT NULL,
    `username` TEXT NOT NULL,
    `token` TEXT NOT NULL,
    `refresh_token` TEXT NOT NULL,
    PRIMARY KEY (`id`)
  );
  CREATE INDEX spotify_id_ix ON `spotify_homepage`.`users` (spotify_id);
  CREATE INDEX update_time_ix ON `spotify_homepage`.`users` (last_update_time);

  -- Table for mapping between spotify IDs and internal IDs
  CREATE TABLE `spotify_homepage`.`spotify_items` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `spotify_id` VARCHAR(191) UNIQUE NOT NULL,
    PRIMARY KEY (`id`)
  );
  CREATE INDEX spotify_id_ix ON `spotify_homepage`.`spotify_items` (spotify_id);

  -- Table for parent/child relationships between tracks and artists.  Tracks can have multiple parents.
  CREATE TABLE `spotify_homepage`.`tracks_artists` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `track_id` INT NOT NULL,
    `artist_id` INT NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (track_id) REFERENCES spotify_items(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES spotify_items(id) ON DELETE CASCADE
  );
  ALTER TABLE `spotify_homepage`.`tracks_artists` ADD UNIQUE `unique_index`(`track_id`, `artist_id`);

  CREATE TABLE `spotify_homepage`.`track_rank_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `spotify_id` VARCHAR(191) NOT NULL,
    `timeframe` TINYINT UNSIGNED NOT NULL,
    `ranking` SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ROW_FORMAT=COMPRESSED CHARSET=ascii;
  CREATE INDEX user_id_ix ON `spotify_homepage`.`track_rank_snapshots` (user_id);
  CREATE INDEX update_time_ix ON `spotify_homepage`.`track_rank_snapshots` (update_time);

  CREATE TABLE `spotify_homepage`.`artist_rank_snapshots` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `spotify_id` VARCHAR(191) NOT NULL,
    `timeframe` TINYINT UNSIGNED NOT NULL,
    `ranking` SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ROW_FORMAT=COMPRESSED CHARSET=ascii;
  CREATE INDEX user_id_ix ON `spotify_homepage`.`artist_rank_snapshots` (user_id);
  CREATE INDEX update_time_ix ON `spotify_homepage`.`artist_rank_snapshots` (update_time);
COMMIT;
