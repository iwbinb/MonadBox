-- New-version metadata is separate; the original Group V1 records and readers remain intact.
CREATE TABLE module_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO module_schema VALUES(1,1);
CREATE TABLE module_boxes (
  id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL REFERENCES users(id), tool TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','prepared','published','deleted')),
  data_json TEXT NOT NULL, metadata TEXT NOT NULL, created_at INTEGER NOT NULL,
  create_key TEXT NOT NULL, create_hash TEXT NOT NULL,
  intent_json TEXT, receipt_state TEXT CHECK(receipt_state IN ('prepared','unknown','finalized','reverted','replaced')),
  tx_hash TEXT, verified_block TEXT, verified_block_hash TEXT,
  UNIQUE(owner,create_key)
);
CREATE INDEX module_boxes_owner ON module_boxes(owner,created_at);
