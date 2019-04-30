START TRANSACTION;
  CREATE TABLE `spotify_homepage`.`users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `creation_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `username` VARCHAR(255) NOT NULL,
    `token` VARCHAR(2083) NOT NULL,
    `refresh_token` VARCHAR(2083) NOT NULL,
    PRIMARY KEY (`id`)
  );
  -- TODO: Create indices

  CREATE TABLE `spotify_homepage`.`track_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(1023) NOT NULL,
    `artists` VARCHAR(2083) NOT NULL,
    `preview_url` VARCHAR(511) NOT NULL,
    `album` VARCHAR(255) NOT NULL,
    `image_url` VARCHAR(511) NOT NULL,
    PRIMARY KEY (`id`)
  );
  -- TODO: Create indices

  CREATE TABLE `spotify_homepage`.`artist_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(1023) NOT NULL,
    `genres` VARCHAR(2083) NOT NULL,
    `image_url` VARCHAR(511) NOT NULL,
    `uri` VARCHAR(511) NOT NULL,
    PRIMARY KEY (`id`)
  );
  -- TODO: Create indices
COMMIT;
