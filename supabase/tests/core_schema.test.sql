begin;
select plan(17);
select has_table('topic_cards');
select col_not_null('topic_cards', 'project_id');
select col_not_null('todos', 'planned_date');
select has_trigger('handoffs', 'reject_handoff_mutation');
select ok(
  to_regprocedure(
    'public.create_handoff_and_update_topic(uuid,uuid,uuid,text,text,text,text,jsonb)'
  ) is not null,
  'atomic handoff and topic update function exists'
);
select ok(
  exists (
    select 1
      from pg_constraint
     where conname = 'handoffs_owner_session_topic_fk'
       and conrelid = 'public.handoffs'::regclass
  ),
  'handoffs enforce the Session-to-Topic binding'
);
select ok(
  to_regprocedure('public.rollover_incomplete_todos(date,date)') is not null,
  'owner-scoped incomplete To-do rollover function exists'
);
select is(
  (
    select prosecdef::text
      from pg_proc
     where oid = 'public.rollover_incomplete_todos(date,date)'::regprocedure
  ),
  'false',
  'To-do rollover uses SECURITY INVOKER'
);
select ok(
  not has_function_privilege(
    'public',
    'public.rollover_incomplete_todos(date,date)',
    'execute'
  )
    and not has_function_privilege(
      'anon',
      'public.rollover_incomplete_todos(date,date)',
      'execute'
    ),
  'To-do rollover is not executable by PUBLIC or anon'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.rollover_incomplete_todos(date,date)',
    'execute'
  ),
  'authenticated can execute To-do rollover'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.rollover_incomplete_todos(date,date)',
    'execute'
  ),
  'service_role can execute To-do rollover'
);

-- Core rollover behavior is kept here; RLS-specific cross-owner checks live
-- in rls.test.sql. The transaction rolls these fixtures back after the test.
insert into auth.users (id, email, aud, role, raw_app_meta_data, raw_user_meta_data)
values (
  '00000000-0000-0000-0000-000000000011',
  'rollover-owner@example.test',
  'authenticated',
  'authenticated',
  '{}'::jsonb,
  '{}'::jsonb
)
on conflict (id) do nothing;

insert into public.todos (id, owner_id, title, planned_date, is_completed)
values
  ('50000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'Rollover pending', current_date - 1, false),
  ('50000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000011', 'Rollover completed', current_date - 1, true),
  ('50000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000011', 'Rollover older', current_date - 2, false);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select * from public.rollover_incomplete_todos(current_date - 3, current_date - 2)$$,
  'P0001',
  'rollover dates must target yesterday and today',
  'To-do rollover rejects an adjacent historical date pair'
);

select is(
  (select count(*)::text from public.rollover_incomplete_todos(current_date - 1, current_date)),
  '1',
  'To-do rollover returns the one incomplete To-do planned for yesterday'
);

select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000011'),
  current_date,
  'To-do rollover moves the incomplete yesterday row to today'
);

select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000012'),
  current_date - 1,
  'To-do rollover does not move completed rows'
);

select is(
  (select planned_date from public.todos where id = '50000000-0000-0000-0000-000000000013'),
  current_date - 2,
  'To-do rollover does not move rows earlier than yesterday'
);

select is(
  (select count(*)::text from public.rollover_incomplete_todos(current_date - 1, current_date)),
  '0',
  'repeating To-do rollover returns no rows and does not duplicate work'
);
select * from finish();
rollback;
