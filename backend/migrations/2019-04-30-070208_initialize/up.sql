START TRANSACTION;
  CREATE TABLE `spotify_homepage`.`users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `creation_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `spotify_id` VARCHAR(255) UNIQUE NOT NULL,
    `username` TEXT NOT NULL,
    `token` TEXT NOT NULL,
    `refresh_token` TEXT NOT NULL,
    PRIMARY KEY (`id`)
  );
  CREATE INDEX spotify_id_ix ON `spotify_homepage`.`users` (spotify_id);
  CREATE INDEX update_time_ix ON `spotify_homepage`.`users` (last_update_time);

  -- Table for mapping between spotify IDs and internal IDs
  CREATE TABLE `spotify_homepage`.`spotify_id_mapping` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `spotify_id` VARCHAR(255) UNIQUE NOT NULL,
    PRIMARY KEY (`id`)
  );
  CREATE INDEX spotify_id_ix ON `spotify_homepage`.`spotify_id_mapping` (spotify_id);

  -- Table for parent/child relationships between tracks and artists.  Tracks can have multiple parents.
  CREATE TABLE `spotify_homepage`.`track_artist_mapping` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `track_id` INT NOT NULL,
    `artist_id` INT NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (track_id) REFERENCES spotify_id_mapping(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES spotify_id_mapping(id) ON DELETE CASCADE
  );
  ALTER TABLE `spotify_homepage`.`track_artist_mapping` ADD UNIQUE `unique_index`(`track_id`, `artist_id`);

  CREATE TABLE `spotify_homepage`.`spotify_id_mapping` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `spotify_id` VARCHAR(255) UNIQUE NOT NULL,
    PRIMARY KEY (`id`)
  );
  CREATE INDEX spotify_id_ix ON `spotify_homepage`.`spotify_id_mapping` (spotify_id);

  CREATE TABLE `spotify_homepage`.`track_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `spotify_id` VARCHAR(255) NOT NULL,
    `timeframe` TINYINT UNSIGNED NOT NULL,
    `ranking` SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX user_id_ix ON `spotify_homepage`.`track_history` (user_id);
  CREATE INDEX update_time_ix ON `spotify_homepage`.`track_history` (update_time);

  CREATE TABLE `spotify_homepage`.`artist_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `spotify_id` VARCHAR(255) NOT NULL,
    `timeframe` TINYINT UNSIGNED NOT NULL,
    `ranking` SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX user_id_ix ON `spotify_homepage`.`artist_history` (user_id);
  CREATE INDEX update_time_ix ON `spotify_homepage`.`artist_history` (update_time);

  CREATE TABLE `spotify_homepage`.`artist_stats_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `spotify_id` VARCHAR(255) UNIQUE NOT NULL,
    `followers` BIGINT UNSIGNED NOT NULL,
    `popularity` BIGINT UNSIGNED NOT NULL,
    `uri` TEXT NOT NULL,
    PRIMARY KEY (`id`)
  );

  CREATE TABLE `spotify_homepage`.`track_stats_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `followers` BIGINT UNSIGNED NOT NULL,
    `popularity` BIGINT UNSIGNED NOT NULL,
    `playcount` BIGINT UNSIGNED,
    PRIMARY KEY (`id`)
  );
COMMIT;
