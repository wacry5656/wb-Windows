CREATE TABLE IF NOT EXISTS question_records (
  id TEXT PRIMARY KEY,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  source_device TEXT NOT NULL DEFAULT 'unknown-device',
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_records_updated_at_ms
ON question_records(updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_question_records_deleted
ON question_records(deleted);
