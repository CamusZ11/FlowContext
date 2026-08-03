-- FlowContext cloud foundation: owner-scoped continuity data and read-only
-- projections.  Client roles only receive the minimum Data API grants below;
-- Codex API writes use service_role after validating the device token.

create extension if not exists pgcrypto;

create type public.topic_state as enum ('open', 'done');

create table public.project_projections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
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

create table public.topic_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  state public.topic_state not null default 'open',
  current_state text not null default '',
  next_action text not null default '',
  open_questions jsonb not null default '[]'::jsonb,
  latest_handoff_id uuid,
  last_active_at timestamptz not null default now(),
  focus_rank integer,
  resurface_at timestamptz,
  resurface_condition text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, project_id)
    references public.project_projections(owner_id, id)
    on delete restrict
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  topic_card_id uuid not null,
  codex_thread_id text not null check (length(trim(codex_thread_id)) > 0),
  device_id text not null check (length(trim(device_id)) > 0),
  workspace_path text not null check (length(trim(workspace_path)) > 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, codex_thread_id),
  foreign key (owner_id, topic_card_id)
    references public.topic_cards(owner_id, id)
    on delete restrict
);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  topic_card_id uuid not null,
  content text not null,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  created_at timestamptz not null default now(),
  generated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, session_id)
    references public.sessions(owner_id, id)
    on delete restrict,
  foreign key (owner_id, topic_card_id)
    references public.topic_cards(owner_id, id)
    on delete restrict
);

alter table public.topic_cards
  add constraint topic_cards_latest_handoff_fk
  foreign key (owner_id, latest_handoff_id)
  references public.handoffs(owner_id, id)
  on delete set null (latest_handoff_id);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
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
    references public.project_projections(owner_id, id)
    on delete set null (project_id),
  foreign key (owner_id, topic_card_id)
    references public.topic_cards(owner_id, id)
    on delete set null (topic_card_id)
);

create table public.daily_projections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  daily_lens text not null default '',
  projects jsonb not null default '[]'::jsonb,
  mac_report text,
  windows_report text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, date)
);

create table public.device_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(trim(device_id)) > 0),
  platform text not null check (platform in ('macos', 'windows')),
  project_id uuid not null,
  workspace_path text not null check (length(trim(workspace_path)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, device_id, project_id),
  foreign key (owner_id, project_id)
    references public.project_projections(owner_id, id)
    on delete restrict
);

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(trim(device_id)) > 0),
  token_hash text not null
    check (token_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  unique (token_hash)
);

create index topic_cards_owner_active_idx
  on public.topic_cards (owner_id, state, last_active_at desc);
create index sessions_owner_topic_idx
  on public.sessions (owner_id, topic_card_id, started_at desc);
create index handoffs_owner_topic_idx
  on public.handoffs (owner_id, topic_card_id, generated_at desc);
create index todos_owner_date_idx
  on public.todos (owner_id, planned_date, is_completed, planned_time);
create index device_tokens_owner_device_idx
  on public.device_tokens (owner_id, device_id)
  where revoked_at is null;

-- To-do changes are consumed by the shared web/Tauri repository through
-- Supabase Realtime. Keep the migration idempotent for local resets and
-- future environments where the table may already be published.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'todos'
  ) then
    alter publication supabase_realtime add table public.todos;
  end if;
end;
$$;

-- Every public table is protected by RLS.  `service_role` bypasses RLS for
-- Codex/Edge API writes, while authenticated clients only receive owner reads
-- and To-do CRUD policies.
alter table public.project_projections enable row level security;
alter table public.topic_cards enable row level security;
alter table public.sessions enable row level security;
alter table public.handoffs enable row level security;
alter table public.todos enable row level security;
alter table public.daily_projections enable row level security;
alter table public.device_workspaces enable row level security;
alter table public.device_tokens enable row level security;

create policy project_projections_select_own
  on public.project_projections for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy topic_cards_select_own
  on public.topic_cards for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy sessions_select_own
  on public.sessions for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy handoffs_select_own
  on public.handoffs for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy todos_select_own
  on public.todos for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy todos_insert_own
  on public.todos for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy todos_update_own
  on public.todos for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy todos_delete_own
  on public.todos for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy daily_projections_select_own
  on public.daily_projections for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy device_workspaces_select_own
  on public.device_workspaces for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Explicit Data API grants.  No PUBLIC/anon table access is retained.  Core
-- continuity objects and projections are read-only for authenticated clients;
-- only To-dos are directly writable from the UI.
revoke all on table
  public.project_projections,
  public.topic_cards,
  public.sessions,
  public.handoffs,
  public.todos,
  public.daily_projections,
  public.device_workspaces,
  public.device_tokens
from public, anon, authenticated;

grant select on table public.project_projections to authenticated;
grant select on table public.topic_cards to authenticated;
grant select on table public.sessions to authenticated;
grant select on table public.handoffs to authenticated;
grant select, insert, update, delete on table public.todos to authenticated;
grant select on table public.daily_projections to authenticated;
grant select on table public.device_workspaces to authenticated;

grant select, insert, update, delete on table
  public.project_projections,
  public.topic_cards,
  public.sessions,
  public.handoffs,
  public.todos,
  public.daily_projections,
  public.device_workspaces,
  public.device_tokens
to service_role;

revoke all on table public.device_tokens from public, anon, authenticated;

-- Handoff rows are confirmation snapshots.  Once inserted, neither clients
-- nor the privileged API may mutate or remove them.
create or replace function public.reject_handoff_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'handoffs are immutable';
end;
$$;

create trigger reject_handoff_mutation
before update or delete on public.handoffs
for each row execute function public.reject_handoff_mutation();

revoke all on function public.reject_handoff_mutation() from public, anon, authenticated, service_role;

-- Topic completion is intentionally a narrow service-role API.  The Edge API
-- repository validates the owner before calling it; SECURITY INVOKER ensures
-- the function never bypasses the caller's RLS context.
create or replace function public.complete_topic_explicitly(
  p_topic_id uuid,
  p_explicit boolean
)
returns public.topic_cards
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  completed public.topic_cards;
begin
  if not p_explicit then
    raise exception 'explicit topic completion required';
  end if;

  update public.topic_cards
     set state = 'done',
         last_active_at = now(),
         updated_at = now()
   where id = p_topic_id
  returning * into completed;

  if not found then
    raise exception 'topic card not found';
  end if;

  return completed;
end;
$$;

revoke execute on function public.complete_topic_explicitly(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_topic_explicitly(uuid, boolean)
  to service_role;

-- Keep enum usage explicit too; the anonymous role receives no type/table
-- privileges through the Data API.
revoke usage on type public.topic_state from public, anon;
grant usage on type public.topic_state to authenticated, service_role;
