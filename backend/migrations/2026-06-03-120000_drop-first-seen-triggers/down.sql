delimiter |

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
