create extension if not exists pgcrypto;

create type topic_state as enum ('open', 'done');

create table owners (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  created_at timestamptz not null default now()
);

create table project_projections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  project_key text not null check (length(trim(project_key)) > 0),
  title text not null check (length(trim(title)) > 0),
  lifecycle_status text not null default 'inbox'
    check (lifecycle_status in ('inbox', 'active', 'paused', 'done', 'archived')),
  summary text not null default '',
  next_action text not null default '',
  source_path text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, project_key)
);

create table topic_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  project_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  state topic_state not null default 'open',
  current_state text not null default '',
  next_action text not null default '',
  open_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(open_questions) = 'array'),
  latest_handoff_id uuid,
  last_active_at timestamptz not null default now(),
  focus_rank integer,
  resurface_at timestamptz,
  resurface_condition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, project_id)
    references project_projections(owner_id, id)
    on delete restrict
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  topic_card_id uuid not null,
  codex_thread_id text not null check (length(trim(codex_thread_id)) > 0),
  device_id text not null check (length(trim(device_id)) > 0),
  workspace_path text not null check (length(trim(workspace_path)) > 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, id, topic_card_id),
  unique (owner_id, codex_thread_id),
  foreign key (owner_id, topic_card_id)
    references topic_cards(owner_id, id)
    on delete restrict
);

create table handoffs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  session_id uuid not null,
  topic_card_id uuid not null,
  content text not null,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  created_at timestamptz not null default now(),
  generated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, session_id, topic_card_id)
    references sessions(owner_id, id, topic_card_id)
    on delete restrict,
  foreign key (owner_id, topic_card_id)
    references topic_cards(owner_id, id)
    on delete restrict
);

alter table topic_cards
  add constraint topic_cards_latest_handoff_fk
  foreign key (owner_id, latest_handoff_id)
  references handoffs(owner_id, id)
  on delete set null (latest_handoff_id);

create table todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  planned_date date not null,
  planned_time time,
  is_completed boolean not null default false,
  project_id uuid,
  topic_card_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, project_id)
    references project_projections(owner_id, id)
    on delete set null (project_id),
  foreign key (owner_id, topic_card_id)
    references topic_cards(owner_id, id)
    on delete set null (topic_card_id)
);

create table daily_projections (
  owner_id uuid not null references owners(id) on delete cascade,
  date date not null,
  daily_lens text not null default '',
  projects jsonb not null default '[]'::jsonb check (jsonb_typeof(projects) = 'array'),
  mac_report text,
  windows_report text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, date)
);

create table device_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  device_id text not null check (length(trim(device_id)) > 0),
  platform text not null check (platform in ('macos', 'windows')),
  project_id uuid not null,
  workspace_path text not null check (length(trim(workspace_path)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, device_id, project_id),
  foreign key (owner_id, project_id)
    references project_projections(owner_id, id)
    on delete restrict
);

create table device_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  device_id text not null check (length(trim(device_id)) > 0),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  unique (token_hash)
);

create index topic_cards_owner_active_idx
  on topic_cards (owner_id, state, last_active_at desc);
create index sessions_owner_topic_idx
  on sessions (owner_id, topic_card_id, started_at desc);
create index handoffs_owner_topic_idx
  on handoffs (owner_id, topic_card_id, generated_at desc);
create index todos_owner_date_idx
  on todos (owner_id, planned_date, is_completed, planned_time);
create index todos_owner_project_fk_idx
  on todos (owner_id, project_id) where project_id is not null;
create index todos_owner_topic_card_fk_idx
  on todos (owner_id, topic_card_id) where topic_card_id is not null;
create index device_tokens_owner_device_idx
  on device_tokens (owner_id, device_id) where revoked_at is null;
