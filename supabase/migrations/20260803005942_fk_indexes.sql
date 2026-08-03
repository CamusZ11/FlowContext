-- Supporting indexes for every composite owner-scoped foreign key. Nullable
-- references use partial indexes so empty links do not consume index entries.
create index if not exists topic_cards_owner_project_fk_idx
  on public.topic_cards (owner_id, project_id);

create index if not exists topic_cards_owner_latest_handoff_fk_idx
  on public.topic_cards (owner_id, latest_handoff_id)
  where latest_handoff_id is not null;

create index if not exists handoffs_owner_session_fk_idx
  on public.handoffs (owner_id, session_id);

create index if not exists todos_owner_project_fk_idx
  on public.todos (owner_id, project_id)
  where project_id is not null;

create index if not exists todos_owner_topic_card_fk_idx
  on public.todos (owner_id, topic_card_id)
  where topic_card_id is not null;

create index if not exists device_workspaces_owner_project_fk_idx
  on public.device_workspaces (owner_id, project_id);
