CREATE TABLE v3_run_receipts (
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX v3_run_receipts_user_created ON v3_run_receipts(user_id, created_at DESC);

CREATE TABLE endless_season_progress (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  season_id TEXT NOT NULL,
  best_wave INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  season_points INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, season_id)
);
