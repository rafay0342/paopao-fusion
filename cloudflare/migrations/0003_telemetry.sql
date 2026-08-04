CREATE TABLE telemetry_batches (
  batch_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id),
  events_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX telemetry_batches_created ON telemetry_batches(created_at);
