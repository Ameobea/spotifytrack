CREATE TABLE `spotify_homepage`.`artists_users_first_seen` (
  user_id BIGINT NOT NULL,
  mapped_spotify_id INT NOT NULL,
  first_seen DATETIME NOT NULL,
  PRIMARY KEY (user_id, mapped_spotify_id)
);

CREATE TABLE `spotify_homepage`.`tracks_users_first_seen` (
  user_id BIGINT NOT NULL,
  mapped_spotify_id INT NOT NULL,
  first_seen DATETIME NOT NULL,
  PRIMARY KEY (user_id, mapped_spotify_id)
);

-- Backfill
INSERT INTO `spotify_homepage`.`artists_users_first_seen` (user_id, mapped_spotify_id, first_seen)
  SELECT user_id, mapped_spotify_id, update_time
    FROM `spotify_homepage`.`artist_rank_snapshots` a
    WHERE a.update_time = (
      SELECT MIN(update_time) FROM `spotify_homepage`.`artist_rank_snapshots` b
      WHERE a.user_id=a.user_id
        AND a.mapped_spotify_id=b.mapped_spotify_id
        AND a.update_time = b.update_time)
    GROUP BY user_id, mapped_spotify_id;

INSERT INTO `spotify_homepage`.`tracks_users_first_seen` (user_id, mapped_spotify_id, first_seen)
  SELECT user_id, mapped_spotify_id, update_time
    FROM `spotify_homepage`.`track_rank_snapshots` a
    WHERE a.update_time = (
      SELECT MIN(update_time) FROM `spotify_homepage`.`track_rank_snapshots` b
      WHERE a.user_id=a.user_id
        AND a.mapped_spotify_id=b.mapped_spotify_id
        AND a.update_time = b.update_time)
    GROUP BY user_id, mapped_spotify_id;

delimiter |

-- Triggers to auto-update these tables every time a track or artist is inserted
CREATE TRIGGER update_first_seen_artists BEFORE INSERT ON `spotify_homepage`.`artist_rank_snapshots`
  FOR EACH ROW
  BEGIN
    INSERT IGNORE INTO `spotify_homepage`.`artists_users_first_seen` (user_id, mapped_spotify_id, first_seen)
    VALUES (NEW.user_id, NEW.mapped_spotify_id, NEW.update_time);
  END;
|

CREATE TRIGGER update_first_seen_tracks BEFORE INSERT ON `spotify_homepage`.`track_rank_snapshots`
  FOR EACH ROW
  BEGIN
    INSERT IGNORE INTO `spotify_homepage`.`tracks_users_first_seen` (user_id, mapped_spotify_id, first_seen)
    VALUES (NEW.user_id, NEW.mapped_spotify_id, NEW.update_time);
  END;
|

DELIMITER ;
