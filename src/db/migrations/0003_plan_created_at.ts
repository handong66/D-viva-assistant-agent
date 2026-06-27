export const sql = `
ALTER TABLE plan ADD COLUMN created_at TEXT;
UPDATE plan SET created_at = datetime('now') WHERE created_at IS NULL;
`;
