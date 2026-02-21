ALTER TABLE pantry_items
  ADD COLUMN IF NOT EXISTS expires_at DATE;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
