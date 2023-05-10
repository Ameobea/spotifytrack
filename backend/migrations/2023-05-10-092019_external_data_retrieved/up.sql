ALTER TABLE users ADD COLUMN IF NOT EXISTS external_data_retrieved boolean NOT NULL DEFAULT true;
