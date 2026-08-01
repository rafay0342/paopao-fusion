PRAGMA foreign_keys = ON;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE auth_identities (
  identity_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('email','google','facebook')),
  identifier TEXT NOT NULL UNIQUE,
  verified_at TEXT NOT NULL
);
CREATE TABLE otp_challenges (
  challenge_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX otp_email_created ON otp_challenges(email, created_at DESC);
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX sessions_token_active ON sessions(token_hash, expires_at);
CREATE TABLE player_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE player_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  progress_json TEXT NOT NULL DEFAULT '{}',
  client_state_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  coins INTEGER NOT NULL DEFAULT 600 CHECK (coins >= 0),
  diamonds INTEGER NOT NULL DEFAULT 0 CHECK (diamonds >= 0),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE wallet_ledger (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  currency TEXT NOT NULL CHECK (currency IN ('coins','diamonds')),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, kind, reference_id)
);
CREATE TABLE inventory_ledger (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  item_id TEXT NOT NULL CHECK (item_id IN ('bomb','rainbow','storyShard')),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, reason, reference_id, item_id)
);
CREATE TABLE entitlements (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  entitlement_id TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, entitlement_id)
);
CREATE TABLE catalog_offers (
  offer_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('coins','diamonds')),
  price INTEGER NOT NULL CHECK (price >= 0),
  grant_kind TEXT NOT NULL CHECK (grant_kind IN ('inventory','entitlement','bundle')),
  grant_id TEXT NOT NULL,
  grant_quantity INTEGER NOT NULL CHECK (grant_quantity > 0),
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  offer_id TEXT NOT NULL REFERENCES catalog_offers(offer_id),
  idempotency_key TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE TABLE player_social (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  friend_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE friendships (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  friend_user_id TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, friend_user_id),
  CHECK(user_id <> friend_user_id)
);
CREATE TABLE social_gifts (
  gift_id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(user_id),
  recipient_user_id TEXT NOT NULL REFERENCES users(user_id),
  offer_id TEXT NOT NULL REFERENCES catalog_offers(offer_id),
  status TEXT NOT NULL CHECK(status IN ('pending','claimed')),
  message TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  claimed_at TEXT
);
CREATE INDEX social_gifts_recipient ON social_gifts(recipient_user_id, status, created_at DESC);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT,
  return_path TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO catalog_offers VALUES
  ('bomb_pack','Bomb Pack','coins',120,'inventory','bomb',3,1,datetime('now')),
  ('rainbow_pack','Rainbow Pack','coins',180,'inventory','rainbow',2,1,datetime('now')),
  ('moonlit_skin','Moonlit Launcher','diamonds',20,'entitlement','skin:moonlit',1,1,datetime('now')),
  ('friendship_hamper','Friendship Hamper','coins',150,'bundle','hamper:friendship',1,1,datetime('now')),
  ('royal_hamper','Royal Hamper','diamonds',25,'bundle','hamper:royal',1,1,datetime('now'));
