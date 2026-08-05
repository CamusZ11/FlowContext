begin;
select no_plan();

select has_table('project_projections', 'project projections table exists');
select has_table('topic_cards', 'topic cards table exists');
select has_table('sessions', 'sessions table exists');
select has_table('handoffs', 'handoffs table exists');
select has_table('todos', 'todos table exists');
select has_table('daily_projections', 'daily projections table exists');
select has_table('device_workspaces', 'device workspaces table exists');
select has_table('device_tokens', 'device tokens table exists');

select ok(
  (select count(*) = 8
     from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in (
        'project_projections', 'topic_cards', 'sessions', 'handoffs',
        'todos', 'daily_projections', 'device_workspaces', 'device_tokens'
      )
      and relrowsecurity),
  'RLS is enabled on every FlowContext table'
);

select ok(
  exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'todos'
  ),
  'todos is included in the supabase_realtime publication'
);

select ok(
  (select count(*) = 6
     from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'topic_cards_owner_project_fk_idx',
        'topic_cards_owner_latest_handoff_fk_idx',
        'handoffs_owner_session_fk_idx',
        'todos_owner_project_fk_idx',
        'todos_owner_topic_card_fk_idx',
        'device_workspaces_owner_project_fk_idx'
      )),
  'all composite foreign keys have dedicated indexes'
);

select ok(
  exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and indexname = 'topic_cards_owner_latest_handoff_fk_idx'
       and indexdef ilike '%latest_handoff_id is not null%'
  )
    and exists (
      select 1
        from pg_indexes
       where schemaname = 'public'
         and indexname = 'todos_owner_project_fk_idx'
         and indexdef ilike '%project_id is not null%'
    )
    and exists (
      select 1
        from pg_indexes
       where schemaname = 'public'
         and indexname = 'todos_owner_topic_card_fk_idx'
         and indexdef ilike '%topic_card_id is not null%'
    ),
  'nullable composite foreign keys use partial indexes'
);

select ok(
  has_table_privilege('authenticated', 'public.todos', 'select')
    and has_table_privilege('authenticated', 'public.todos', 'insert')
    and has_table_privilege('authenticated', 'public.todos', 'update')
    and has_table_privilege('authenticated', 'public.todos', 'delete'),
  'authenticated has To-do CRUD grants'
);

select ok(
  has_table_privilege('authenticated', 'public.topic_cards', 'select')
    and not has_table_privilege('authenticated', 'public.topic_cards', 'insert')
    and not has_table_privilege('authenticated', 'public.topic_cards', 'update')
    and not has_table_privilege('authenticated', 'public.topic_cards', 'delete'),
  'authenticated cannot directly write Topic Cards'
);

select ok(
  not has_table_privilege('authenticated', 'public.device_tokens', 'select')
    and not has_table_privilege('anon', 'public.device_tokens', 'select')
    and has_table_privilege('service_role', 'public.device_tokens', 'select')
    and has_table_privilege('service_role', 'public.device_tokens', 'insert'),
  'device tokens are service_role-only'
);

select ok(
  not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'device_tokens'
       and column_name in ('token', 'raw_token', 'secret')
  ),
  'device tokens do not expose a raw token column'
);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'device_tokens'
       and column_name = 'token_hash'
       and data_type = 'text'
  ),
  'device tokens store a token_hash text column'
);

select ok(
  not has_function_privilege(
    'public',
    'public.complete_topic_explicitly(uuid,boolean)',
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.complete_topic_explicitly(uuid,boolean)',
      'execute'
    )
    and not has_function_privilege(
      'authenticated',
      'public.complete_topic_explicitly(uuid,boolean)',
      'execute'
    )
    and has_function_privilege(
      'service_role',
      'public.complete_topic_explicitly(uuid,boolean)',
      'execute'
    ),
  'topic completion is executable only by service_role'
);

select is(
  (select prosecdef::text
     from pg_proc
    where oid = 'public.complete_topic_explicitly(uuid,boolean)'::regprocedure),
  'false',
  'topic completion uses SECURITY INVOKER'
);

-- Seed two owners and their rows as the database owner.  The transaction is
-- rolled back at the end of the test file, so no fixture survives a run.
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', 'flowcontext-a@example.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'flowcontext-b@example.test', 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

insert into public.project_projections
  (id, owner_id, project_key, title, lifecycle_status, summary, next_action)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'project-a', 'Project A', 'active', '', ''),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'project-b', 'Project B', 'active', '', '');

insert into public.topic_cards
  (id, owner_id, project_id, title, current_state, next_action)
values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Topic A', '', ''),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Topic B', '', '');

insert into public.sessions
  (id, owner_id, topic_card_id, codex_thread_id, device_id, workspace_path)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'thread-a', 'mac-a', '/workspace/a'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'thread-b', 'win-b', 'F:/workspace/b');

insert into public.handoffs
  (id, owner_id, session_id, topic_card_id, content, idempotency_key)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'handoff A', 'handoff-a'),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'handoff B', 'handoff-b');

update public.topic_cards
   set latest_handoff_id = '40000000-0000-0000-0000-000000000001'
 where id = '20000000-0000-0000-0000-000000000001';

insert into public.todos (id, owner_id, title, planned_date, project_id, topic_card_id)
values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Todo A', '2026-08-03', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Todo B', '2026-08-03', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002');

-- The four rows below protect the To-do rollover boundary: exactly one
-- incomplete row for owner A belongs to the immediately previous date.
insert into public.todos (id, owner_id, title, planned_date, is_completed)
values
  ('50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Rollover A pending', '2026-08-04', false),
  ('50000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Rollover A completed', '2026-08-04', true),
  ('50000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Rollover A older', '2026-08-03', false),
  ('50000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000002', 'Rollover B pending', '2026-08-04', false);

-- Dedicated rows verify composite ON DELETE SET NULL actions.  The topic is
-- removed first because its project FK is RESTRICT; the project can then be
-- removed while the To-do owner remains unchanged.
insert into public.project_projections
  (id, owner_id, project_key, title, lifecycle_status, summary, next_action)
values
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'project-c', 'Project C', 'active', '', '');

insert into public.topic_cards
  (id, owner_id, project_id, title, current_state, next_action)
values
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'Topic C', '', '');

insert into public.todos (id, owner_id, title, planned_date, project_id, topic_card_id)
values
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Todo C', '2026-08-03', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003');

insert into public.daily_projections (owner_id, date, daily_lens)
values
  ('00000000-0000-0000-0000-000000000001', '2026-08-03', 'lens A'),
  ('00000000-0000-0000-0000-000000000002', '2026-08-03', 'lens B');

insert into public.device_workspaces
  (owner_id, device_id, platform, project_id, workspace_path)
values
  ('00000000-0000-0000-0000-000000000001', 'mac-a', 'macos', '10000000-0000-0000-0000-000000000001', '/workspace/a'),
  ('00000000-0000-0000-0000-000000000002', 'win-b', 'windows', '10000000-0000-0000-0000-000000000002', 'F:/workspace/b');

insert into public.device_tokens (owner_id, device_id, token_hash)
values ('00000000-0000-0000-0000-000000000001', 'mac-a', repeat('a', 64));

select is(
  (
    select public.create_handoff_and_update_topic(
      '00000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'atomic handoff A',
      'handoff-a-atomic',
      'atomic current state',
      'atomic next action',
      '["atomic question"]'::jsonb
    )->>'created'
  ),
  'true',
  'atomic Handoff write reports a new immutable record'
);

select is(
  (
    select current_state || '|' || next_action || '|' || open_questions::text
      from public.topic_cards
     where id = '20000000-0000-0000-0000-000000000001'
  ),
  'atomic current state|atomic next action|["atomic question"]',
  'atomic Handoff write updates only the Topic continuity fields'
);

select is(
  (
    select public.create_handoff_and_update_topic(
      '00000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'atomic handoff A',
      'handoff-a-atomic',
      'must not replace state on retry',
      'must not replace next action on retry',
      '[]'::jsonb
    )->>'created'
  ),
  'false',
  'Handoff retry is idempotent and does not create a second record'
);

select is(
  (
    select count(*)::text
      from public.handoffs
     where owner_id = '00000000-0000-0000-0000-000000000001'
       and idempotency_key = 'handoff-a-atomic'
  ),
  '1',
  'atomic Handoff retry retains one immutable record'
);

select throws_ok(
  $$
    select public.create_handoff_and_update_topic(
      '00000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      'invalid binding',
      'invalid-binding',
      null,
      null,
      null
    )
  $$,
  '23503',
  'session is not bound to topic card',
  'atomic Handoff rejects a Topic not bound to the Session'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $$select * from public.rollover_incomplete_todos('2026-08-04', '2026-08-05')$$,
  'P0001',
  'authentication required',
  'unauthenticated callers cannot roll over To-dos'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*)::text from public.project_projections), '2', 'authenticated sees only the owner project projections');
select is((select count(*)::text from public.topic_cards), '2', 'authenticated sees only the owner topic cards');
select is((select count(*)::text from public.sessions), '1', 'authenticated sees only the owner session');
select is((select count(*)::text from public.handoffs), '2', 'authenticated sees only the owner handoffs');
select is((select count(*)::text from public.todos), '5', 'authenticated sees only the owner todos');
select is((select count(*)::text from public.daily_projections), '1', 'authenticated sees only the owner daily projection');
select is((select count(*)::text from public.device_workspaces), '1', 'authenticated sees only the owner workspace');
select is((select count(*)::text from public.todos where owner_id = '00000000-0000-0000-0000-000000000002'), '0', 'cross-owner todos are hidden by RLS');

select throws_ok(
  $$select * from public.rollover_incomplete_todos('2026-08-04', '2026-08-06')$$,
  'P0001',
  'rollover dates must be adjacent',
  'To-do rollover rejects non-adjacent dates'
);

select is(
  (select count(*)::text from public.rollover_incomplete_todos('2026-08-04', '2026-08-05')),
  '1',
  'To-do rollover returns the one incomplete To-do planned for the previous day'
);

select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000004'),
  '2026-08-05'::date,
  'To-do rollover moves the current owner incomplete previous-day row'
);

select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000005'),
  '2026-08-04'::date,
  'To-do rollover does not move completed rows'
);

select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000006'),
  '2026-08-03'::date,
  'To-do rollover does not move rows earlier than the source date'
);

set local role postgres;
select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000007'),
  '2026-08-04'::date,
  'To-do rollover does not move another owner row'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::text from public.rollover_incomplete_todos('2026-08-04', '2026-08-05')),
  '0',
  'repeating To-do rollover returns no rows and does not duplicate work'
);

select lives_ok($$
  insert into public.todos (title, planned_date)
  values ('Client todo with default owner', '2026-08-03')
$$, 'authenticated owner can insert a todo without passing owner_id');

select lives_ok($$
  insert into public.todos (owner_id, title, planned_date)
  values ('00000000-0000-0000-0000-000000000001', 'Client todo', '2026-08-03')
$$, 'authenticated owner can insert a todo for itself');

select throws_ok($$
  insert into public.todos (owner_id, title, planned_date)
  values ('00000000-0000-0000-0000-000000000002', 'Cross-owner todo', '2026-08-03')
$$, '42501', null, 'authenticated cannot insert a todo for another owner');

select lives_ok($$
  update public.todos set title = 'Todo A updated'
   where id = '50000000-0000-0000-0000-000000000001'
$$, 'authenticated owner can update its own todo');

select lives_ok($$
  delete from public.todos
   where id = '50000000-0000-0000-0000-000000000001'
$$, 'authenticated owner can delete its own todo');

select throws_ok($$
  select * from public.device_tokens
$$, '42501', null, 'authenticated cannot read device tokens');

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($$select * from public.todos$$, '42501', null, 'anon cannot read todos');
select throws_ok($$select * from public.topic_cards$$, '42501', null, 'anon cannot read topic cards');

set local role postgres;
select throws_ok($$
  update public.handoffs
     set content = 'changed'
   where id = '40000000-0000-0000-0000-000000000001'
$$, 'P0001', 'handoffs are immutable', 'handoff UPDATE is rejected');

select throws_ok($$
  delete from public.handoffs
   where id = '40000000-0000-0000-0000-000000000001'
$$, 'P0001', 'handoffs are immutable', 'handoff DELETE is rejected');

set local role service_role;
select throws_ok($$
  update public.handoffs
     set content = 'service role changed'
   where id = '40000000-0000-0000-0000-000000000001'
$$, 'P0001', 'handoffs are immutable', 'service_role handoff UPDATE is rejected');

select throws_ok($$
  delete from public.handoffs
   where id = '40000000-0000-0000-0000-000000000001'
$$, 'P0001', 'handoffs are immutable', 'service_role handoff DELETE is rejected');

select lives_ok($$
  delete from public.topic_cards
   where id = '20000000-0000-0000-0000-000000000003'
$$, 'deleting an unreferenced Topic succeeds');

select ok(
  (select topic_card_id is null
     from public.todos
    where id = '50000000-0000-0000-0000-000000000003')
    and (select owner_id = '00000000-0000-0000-0000-000000000001'::uuid
           from public.todos
          where id = '50000000-0000-0000-0000-000000000003'),
  'Topic deletion nulls only todo.topic_card_id and keeps owner_id'
);

select lives_ok($$
  delete from public.project_projections
   where id = '10000000-0000-0000-0000-000000000003'
$$, 'deleting a project with no remaining Topic succeeds');

select ok(
  (select project_id is null
     from public.todos
    where id = '50000000-0000-0000-0000-000000000003')
    and (select owner_id = '00000000-0000-0000-0000-000000000001'::uuid
           from public.todos
          where id = '50000000-0000-0000-0000-000000000003'),
  'Project deletion nulls only todo.project_id and keeps owner_id'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select throws_ok($$
  select public.complete_topic_explicitly('20000000-0000-0000-0000-000000000001', true)
$$, '42501', null, 'ordinary authenticated client cannot execute topic completion');

set local role service_role;
select throws_ok($$
  select public.complete_topic_explicitly('20000000-0000-0000-0000-000000000001', false)
$$, 'P0001', 'explicit topic completion required', 'implicit topic completion is rejected');

select lives_ok($$
  select public.complete_topic_explicitly('20000000-0000-0000-0000-000000000001', true)
$$, 'service_role can complete a topic after explicit confirmation');

select is(
  (select state::text from public.topic_cards where id = '20000000-0000-0000-0000-000000000001'),
  'done',
  'explicit completion changes Topic state to done'
);

select throws_ok($$
  insert into public.device_tokens (owner_id, device_id, token_hash)
  values ('00000000-0000-0000-0000-000000000001', 'mac-a-2', repeat('b', 63))
$$, '23514', null, 'device token hash must be a 64-character SHA-256 hex string');

set local role authenticated;
select throws_ok($$
  insert into public.device_tokens (owner_id, device_id, token_hash)
  values ('00000000-0000-0000-0000-000000000001', 'mac-a-3', repeat('c', 64))
$$, '42501', null, 'authenticated cannot insert device tokens');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::text from public.rollover_incomplete_todos('2026-08-04', '2026-08-05')),
  '1',
  'another authenticated owner can roll over only its own incomplete To-do'
);

select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000007'),
  '2026-08-05'::date,
  'another authenticated owner moves its own previous-day row'
);

set local role postgres;
select ok(
  (select planned_date = '2026-08-05'::date from public.todos where id = '50000000-0000-0000-0000-000000000004')
    and (select planned_date = '2026-08-05'::date from public.todos where id = '50000000-0000-0000-0000-000000000007'),
  'another owner rollover cannot re-move the target owner row'
);

select * from finish();
rollback;
