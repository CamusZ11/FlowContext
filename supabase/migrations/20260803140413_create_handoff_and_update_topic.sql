-- A Handoff can only reference the Topic Card already bound to its Session.
-- The database, rather than a caller-supplied project ID, derives the Project
-- relationship through sessions.topic_card_id -> topic_cards.project_id.
alter table public.sessions
  add constraint sessions_owner_id_id_topic_card_id_key
  unique (owner_id, id, topic_card_id);

alter table public.handoffs
  add constraint handoffs_owner_session_topic_fk
  foreign key (owner_id, session_id, topic_card_id)
  references public.sessions(owner_id, id, topic_card_id)
  on delete restrict;

create index handoffs_owner_session_topic_fk_idx
  on public.handoffs (owner_id, session_id, topic_card_id);

-- This is the only write path for a Handoff. It validates the Session-to-Topic
-- binding, preserves idempotency, inserts the immutable snapshot, and updates
-- the safe Topic continuity fields in one transaction.
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
begin
  if p_open_questions is not null and jsonb_typeof(p_open_questions) <> 'array' then
    raise exception 'open questions must be a JSON array';
  end if;

  perform 1
    from public.sessions
   where owner_id = p_owner_id
     and id = p_session_id
     and topic_card_id = p_topic_card_id;
  if not found then
    raise exception 'session is not bound to topic card' using errcode = '23503';
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

  return jsonb_build_object('handoff', to_jsonb(persisted), 'created', true);
end;
$$;

revoke execute on function public.create_handoff_and_update_topic(
  uuid, uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_handoff_and_update_topic(
  uuid, uuid, uuid, text, text, text, text, jsonb
) to service_role;
