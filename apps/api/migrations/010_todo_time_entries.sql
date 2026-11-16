create table todo_time_entries (
  owner_id uuid not null,
  todo_id uuid not null,
  id uuid not null,
  started_at timestamptz not null,
  elapsed_ms bigint not null check (elapsed_ms between 0 and 9007199254740991),
  primary key (owner_id, id),
  foreign key (owner_id, todo_id) references todos(owner_id, id) on delete cascade
);

create index todo_time_entries_task on todo_time_entries (owner_id, todo_id, started_at desc, id);
