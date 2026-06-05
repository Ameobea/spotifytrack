ALTER TABLE users
    ADD COLUMN IF NOT EXISTS auth_failed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS consecutive_auth_failures TINYINT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_auth_failure_at TIMESTAMP NULL DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS last_auth_failure_reason TEXT NULL;

CREATE INDEX auth_failed_update_time_ix ON users (auth_failed, last_update_time);
