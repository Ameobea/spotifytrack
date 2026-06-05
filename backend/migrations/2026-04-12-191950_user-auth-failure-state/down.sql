ALTER TABLE users DROP INDEX auth_failed_update_time_ix;

ALTER TABLE users
    DROP COLUMN IF EXISTS auth_failed,
    DROP COLUMN IF EXISTS consecutive_auth_failures,
    DROP COLUMN IF EXISTS last_auth_failure_at,
    DROP COLUMN IF EXISTS last_auth_failure_reason;
