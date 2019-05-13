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
  -- TODO: Create indices

  CREATE TABLE `spotify_homepage`.`track_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `spotify_id` VARCHAR(255) UNIQUE NOT NULL,
    `timeframe` TINYINT UNSIGNED NOT NULL,
    `ranking` SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  -- TODO: Create indices

  CREATE TABLE `spotify_homepage`.`artist_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `spotify_id` VARCHAR(255) UNIQUE NOT NULL,
    `timeframe` TINYINT UNSIGNED NOT NULL,
    `ranking` SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  -- TODO: Create indices

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
