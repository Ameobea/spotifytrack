ALTER TABLE users ADD COLUMN IF NOT EXISTS last_viewed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
