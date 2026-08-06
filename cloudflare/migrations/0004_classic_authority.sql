CREATE TABLE classic_run_tickets (
  ticket_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 41),
  mode TEXT NOT NULL CHECK(mode IN ('classic','rush','precision')),
  seed INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  trace_json TEXT NOT NULL DEFAULT '[]',
  last_ack TEXT NOT NULL DEFAULT '',
  terminal_hash TEXT,
  completed_run_id TEXT,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX classic_run_tickets_user_status ON classic_run_tickets(user_id, status);

CREATE TABLE classic_authority_clears (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  level INTEGER NOT NULL CHECK(level BETWEEN 0 AND 41),
  run_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY(user_id, level)
);
