CREATE TABLE related_artists (
  artist_spotify_id INT PRIMARY KEY NOT NULL REFERENCES spotify_items(id),
  related_artists_json TEXT NOT NULL
);
