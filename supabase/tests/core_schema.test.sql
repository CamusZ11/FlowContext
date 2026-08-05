begin;
select plan(11);
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
select * from finish();
rollback;
