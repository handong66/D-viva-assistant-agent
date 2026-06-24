-- schema_migrations is created by the migration runner's bootstrap (see migrate.ts), not here.

CREATE TABLE thesis (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  abstract TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('pdf','md','txt')),
  source_meta TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- single active thesis at a time
CREATE UNIQUE INDEX idx_thesis_one_active ON thesis (is_active) WHERE is_active = 1;

CREATE TABLE thesis_chunk (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  section TEXT,
  ord INTEGER NOT NULL,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_chunk_thesis ON thesis_chunk (thesis_id, ord);

CREATE TABLE evidence_unit (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES thesis_chunk(id) ON DELETE CASCADE,
  section TEXT,
  page INTEGER,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  text TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_evidence_thesis ON evidence_unit (thesis_id);

CREATE TABLE generation_run (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prep_pack','prep_item','regenerate')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','done','error','canceled')),
  evidence_snapshot_hash TEXT,
  item_type TEXT,
  error TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE prep_item (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  generation_run_id TEXT REFERENCES generation_run(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('digest','key_number','qa','hostile','theory_card','citation_card')),
  title TEXT NOT NULL,
  body TEXT,
  claim_text TEXT,
  evidence_quote TEXT,
  support_kind TEXT CHECK (support_kind IN ('existence','exact_quote','numeric','llm_suggested')),
  value_numeric REAL,
  unit TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified','needs_review','unsafe','draft')),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('passed','needs_review','failed')),
  validator_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generated','edited','manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT
);
CREATE INDEX idx_prep_thesis ON prep_item (thesis_id, type, status);

CREATE TABLE prep_item_evidence (
  prep_item_id TEXT NOT NULL REFERENCES prep_item(id) ON DELETE CASCADE,
  evidence_unit_id TEXT NOT NULL REFERENCES evidence_unit(id) ON DELETE RESTRICT,
  PRIMARY KEY (prep_item_id, evidence_unit_id)
);
CREATE INDEX idx_pie_evidence ON prep_item_evidence (evidence_unit_id);

CREATE TABLE practice_run (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  question_kind TEXT NOT NULL CHECK (question_kind IN ('random','by_section','cross_section','hostile','boundary','followup')),
  answer_text TEXT,
  transcript TEXT,
  scores TEXT,
  diagnosis TEXT,
  rewrite TEXT,
  follow_ups TEXT,
  status TEXT NOT NULL CHECK (status IN ('practice','saved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_practice_thesis ON practice_run (thesis_id, created_at);

CREATE TABLE practice_run_evidence (
  practice_run_id TEXT NOT NULL REFERENCES practice_run(id) ON DELETE CASCADE,
  evidence_unit_id TEXT NOT NULL REFERENCES evidence_unit(id) ON DELETE RESTRICT,
  PRIMARY KEY (practice_run_id, evidence_unit_id)
);

CREATE TABLE review_item (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  practice_run_id TEXT NOT NULL REFERENCES practice_run(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('evidence','clarity','completeness','boundary','delivery')),
  score INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (practice_run_id, dimension)
);

CREATE TABLE recording (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  practice_run_id TEXT REFERENCES practice_run(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  duration_ms INTEGER,
  language_mode TEXT NOT NULL DEFAULT 'english' CHECK (language_mode IN ('english','chinese')),
  stt_provider TEXT,
  stt_status TEXT NOT NULL DEFAULT 'none' CHECK (stt_status IN ('none','pending','ok','error')),
  stt_error TEXT,
  transcript TEXT,
  transcript_edited INTEGER NOT NULL DEFAULT 0 CHECK (transcript_edited IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan (
  id TEXT PRIMARY KEY,
  thesis_id TEXT NOT NULL REFERENCES thesis(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_days INTEGER NOT NULL,
  template_key TEXT NOT NULL
);

CREATE TABLE plan_day (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  day_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  focus TEXT,
  blocks TEXT,
  materials TEXT,
  evidence_targets TEXT
);

CREATE TABLE ai_call_log (
  id TEXT PRIMARY KEY,
  thesis_id TEXT REFERENCES thesis(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok','error','timeout')),
  error TEXT,
  tokens TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT);
