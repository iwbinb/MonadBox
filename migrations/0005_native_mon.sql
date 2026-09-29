-- Preserve legacy six-decimal records. Native MON uses an explicit new asset namespace.
ALTER TABLE boxes ADD COLUMN currency TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE module_boxes ADD COLUMN currency TEXT NOT NULL DEFAULT 'legacy';
UPDATE cloud_schema SET version=3 WHERE id=1;
UPDATE module_schema SET version=2 WHERE id=1;
CREATE INDEX boxes_currency_owner ON boxes(currency,owner_id,created_at);
CREATE INDEX module_currency_owner ON module_boxes(currency,owner,created_at);
