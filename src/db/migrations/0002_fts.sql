-- FTS5 over evidence_unit.text, kept in sync by triggers.
-- Contentful (stores evidence_unit_id + text) rather than external-content,
-- because evidence_unit has a TEXT primary key (external-content keys on integer rowid).
CREATE VIRTUAL TABLE evidence_fts USING fts5(
  evidence_unit_id UNINDEXED,
  text,
  tokenize = 'unicode61'
);

CREATE TRIGGER evidence_ai AFTER INSERT ON evidence_unit BEGIN
  INSERT INTO evidence_fts (evidence_unit_id, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER evidence_ad AFTER DELETE ON evidence_unit BEGIN
  DELETE FROM evidence_fts WHERE evidence_unit_id = old.id;
END;

CREATE TRIGGER evidence_au AFTER UPDATE ON evidence_unit BEGIN
  DELETE FROM evidence_fts WHERE evidence_unit_id = old.id;
  INSERT INTO evidence_fts (evidence_unit_id, text) VALUES (new.id, new.text);
END;
