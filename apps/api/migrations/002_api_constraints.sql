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
