CREATE TABLE attachment_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
INSERT INTO attachment_schema VALUES(1,1);
CREATE TABLE delivery_files(
  id TEXT PRIMARY KEY, box_id TEXT NOT NULL REFERENCES module_boxes(id), uploader TEXT NOT NULL,
  name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 10485760),
  sha256 TEXT NOT NULL, stage_index INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','ready')),
  request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, UNIQUE(box_id,uploader,request_key)
);
CREATE INDEX delivery_files_box ON delivery_files(box_id,stage_index,state,expires_at);
