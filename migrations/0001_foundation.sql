-- Foundation schema only: no database-owned balances and no chain payment claims.
PRAGMA foreign_keys = ON;
CREATE TABLE environment_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  namespace TEXT NOT NULL UNIQUE CHECK (namespace IN ('monadbox-local','monadbox-test','monadbox-preview','monadbox-production'))
);
CREATE TABLE users (id TEXT PRIMARY KEY, primary_wallet TEXT NOT NULL UNIQUE, locale TEXT NOT NULL DEFAULT 'en', created_at INTEGER NOT NULL);
CREATE TABLE auth_nonces (nonce_hash TEXT PRIMARY KEY, domain TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK (chain_id = 10143), expires_at INTEGER NOT NULL, consumed_at INTEGER);
CREATE INDEX auth_nonces_expiry ON auth_nonces(expires_at);
CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE TABLE boxes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), tool TEXT NOT NULL CHECK (tool IN ('group','split','deliver','attend','milestones','rewards')), revision INTEGER NOT NULL DEFAULT 1, draft_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX boxes_owner ON boxes(owner_id, created_at);
CREATE TABLE attachments (id TEXT PRIMARY KEY, owner_wallet TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL, size INTEGER NOT NULL CHECK (size >= 0), created_at INTEGER NOT NULL);
CREATE TABLE idempotency_keys (actor TEXT NOT NULL, scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT, expires_at INTEGER NOT NULL, PRIMARY KEY (actor, scope, key));
CREATE TABLE outbox (job_key TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL);
CREATE INDEX outbox_pending ON outbox(status, next_attempt_at);
CREATE TABLE job_receipts (job_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, processed_at INTEGER NOT NULL);
CREATE TABLE audit_log (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, entity_ref TEXT, created_at INTEGER NOT NULL);
