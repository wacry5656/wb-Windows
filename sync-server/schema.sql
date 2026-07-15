CREATE TABLE IF NOT EXISTS question_records (
  id TEXT PRIMARY KEY,
  updated_at_ms BIGINT NOT NULL DEFAULT 0,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  source_device TEXT NOT NULL DEFAULT 'unknown-device',
  server_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision BIGINT NOT NULL DEFAULT 0,
  deleted_at_ms BIGINT NOT NULL DEFAULT 0,
  restored_at_ms BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE question_records
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE question_records
  ADD COLUMN IF NOT EXISTS deleted_at_ms BIGINT NOT NULL DEFAULT 0;

ALTER TABLE question_records
  ADD COLUMN IF NOT EXISTS restored_at_ms BIGINT NOT NULL DEFAULT 0;

CREATE SEQUENCE IF NOT EXISTS question_records_revision_seq AS BIGINT;

ALTER SEQUENCE question_records_revision_seq OWNED BY question_records.revision;

ALTER TABLE question_records
  ALTER COLUMN revision SET DEFAULT nextval('question_records_revision_seq');

UPDATE question_records
SET revision = nextval('question_records_revision_seq')
WHERE revision = 0;

UPDATE question_records
SET deleted_at_ms = updated_at_ms
WHERE deleted = TRUE AND deleted_at_ms = 0;

SELECT setval(
  'question_records_revision_seq',
  GREATEST(
    COALESCE((SELECT MAX(revision) FROM question_records), 0),
    1
  ),
  COALESCE((SELECT MAX(revision) FROM question_records), 0) > 0
);

CREATE INDEX IF NOT EXISTS idx_question_records_updated_at_ms
ON question_records(updated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_question_records_deleted
ON question_records(deleted);

CREATE INDEX IF NOT EXISTS idx_question_records_revision
ON question_records(revision);

CREATE INDEX IF NOT EXISTS idx_question_records_id_revision
ON question_records(id, revision);
