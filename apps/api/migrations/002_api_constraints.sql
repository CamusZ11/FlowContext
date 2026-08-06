create table device_enrollments (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  device_id text,
  created_at timestamptz not null default now(),
  check ((consumed_at is null and device_id is null) or (consumed_at is not null and length(trim(device_id)) > 0))
);

create index device_enrollments_available_idx
  on device_enrollments (expires_at)
  where consumed_at is null;

alter table todos
  add constraint todos_planned_time_minute_precision
  check (planned_time is null or extract(second from planned_time) = 0);

create or replace function flowcontext_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger project_projections_set_updated_at
before update on project_projections
for each row execute function flowcontext_set_updated_at();

create trigger topic_cards_set_updated_at
before update on topic_cards
for each row execute function flowcontext_set_updated_at();

create trigger todos_set_updated_at
before update on todos
for each row execute function flowcontext_set_updated_at();

create trigger daily_projections_set_updated_at
before update on daily_projections
for each row execute function flowcontext_set_updated_at();

create trigger device_workspaces_set_updated_at
before update on device_workspaces
for each row execute function flowcontext_set_updated_at();
