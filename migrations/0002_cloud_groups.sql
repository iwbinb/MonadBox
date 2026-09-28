-- M1-B: off-chain metadata only. No balances or money-moving database fields.
ALTER TABLE sessions ADD COLUMN origin TEXT;
ALTER TABLE sessions ADD COLUMN csrf TEXT;
ALTER TABLE sessions ADD COLUMN challenge_id TEXT;
CREATE UNIQUE INDEX session_challenge ON sessions(challenge_id);
CREATE TABLE cloud_challenges (
  id TEXT PRIMARY KEY, address TEXT NOT NULL, origin TEXT NOT NULL,
  message TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE INDEX cloud_challenge_expiry ON cloud_challenges(expires_at);
CREATE TABLE cloud_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
ALTER TABLE boxes ADD COLUMN state TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE boxes ADD COLUMN public_id TEXT;
ALTER TABLE boxes ADD COLUMN metadata_json TEXT;
ALTER TABLE boxes ADD COLUMN metadata_hash TEXT;
ALTER TABLE boxes ADD COLUMN create_key TEXT;
ALTER TABLE boxes ADD COLUMN create_hash TEXT;
CREATE UNIQUE INDEX cloud_public_id ON boxes(public_id);
CREATE UNIQUE INDEX cloud_create_key ON boxes(owner_id,create_key);
CREATE TABLE group_publications (
  box_id TEXT PRIMARY KEY REFERENCES boxes(id), intent_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','unknown','finalized','reverted','replaced')),
  tx_hash TEXT, verified_block TEXT, verified_block_hash TEXT,
  module TEXT NOT NULL, chain_box_id TEXT NOT NULL,
  UNIQUE(module,chain_box_id)
);
CREATE TABLE cloud_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO cloud_schema VALUES(1,2);
CREATE INDEX cloud_limit_expiry ON cloud_limits(expires_at);
