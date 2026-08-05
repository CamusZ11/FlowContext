-- Sessions created before platform capture remain readable with NULL platform.
-- The Edge API requires a platform for all new Session writes, while the
-- Handoff RPC rejects a legacy unknown platform before it mutates anything.
alter table public.sessions
  add column platform text
  check (platform in ('macos', 'windows'));

-- Keep the public signature stable: the Edge API sends no client-controlled
-- workspace or platform fields. Both values come from the verified Session.
create or replace function public.create_handoff_and_update_topic(
  p_owner_id uuid,
  p_session_id uuid,
  p_topic_card_id uuid,
  p_content text,
  p_idempotency_key text,
  p_current_state text default null,
  p_next_action text default null,
  p_open_questions jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  persisted public.handoffs;
  bound_session public.sessions;
  bound_project_id uuid;
begin
  if p_open_questions is not null and jsonb_typeof(p_open_questions) <> 'array' then
    raise exception 'open questions must be a JSON array';
  end if;

  select * into bound_session
    from public.sessions
   where owner_id = p_owner_id
     and id = p_session_id
     and topic_card_id = p_topic_card_id;
  if not found then
    raise exception 'session is not bound to topic card' using errcode = '23503';
  end if;

  if bound_session.platform is null then
    raise exception 'session platform is required' using errcode = '23514';
  end if;

  select project_id into bound_project_id
    from public.topic_cards
   where owner_id = p_owner_id
     and id = p_topic_card_id;
  if not found then
    raise exception 'topic card not found' using errcode = '23503';
  end if;

  select * into persisted
    from public.handoffs
   where owner_id = p_owner_id
     and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('handoff', to_jsonb(persisted), 'created', false);
  end if;

  insert into public.handoffs (
    owner_id,
    session_id,
    topic_card_id,
    content,
    idempotency_key
  ) values (
    p_owner_id,
    p_session_id,
    p_topic_card_id,
    p_content,
    p_idempotency_key
  )
  on conflict (owner_id, idempotency_key) do nothing
  returning * into persisted;

  if not found then
    select * into persisted
      from public.handoffs
     where owner_id = p_owner_id
       and idempotency_key = p_idempotency_key;
    return jsonb_build_object('handoff', to_jsonb(persisted), 'created', false);
  end if;

  update public.topic_cards
     set current_state = coalesce(p_current_state, current_state),
         next_action = coalesce(p_next_action, next_action),
         open_questions = coalesce(p_open_questions, open_questions),
         latest_handoff_id = persisted.id,
         last_active_at = now(),
         updated_at = now()
   where owner_id = p_owner_id
     and id = p_topic_card_id;
  if not found then
    raise exception 'topic card not found' using errcode = '23503';
  end if;

  insert into public.device_workspaces (
    owner_id,
    device_id,
    platform,
    project_id,
    workspace_path
  ) values (
    p_owner_id,
    bound_session.device_id,
    bound_session.platform,
    bound_project_id,
    bound_session.workspace_path
  )
  on conflict (owner_id, device_id, project_id)
  do update set
    platform = excluded.platform,
    workspace_path = excluded.workspace_path,
    updated_at = now();

  return jsonb_build_object('handoff', to_jsonb(persisted), 'created', true);
end;
$$;

revoke execute on function public.create_handoff_and_update_topic(
  uuid, uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_handoff_and_update_topic(
  uuid, uuid, uuid, text, text, text, text, jsonb
) to service_role;
