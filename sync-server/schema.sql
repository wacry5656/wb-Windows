create table if not exists question_records (
  id text primary key,
  updated_at_ms bigint not null default 0,
  deleted boolean not null default false,
  payload jsonb not null,
  source_device text,
  server_updated_at timestamptz not null default now()
);

create index if not exists idx_question_records_updated_at
  on question_records(updated_at_ms);

create index if not exists idx_question_records_deleted
  on question_records(deleted);
