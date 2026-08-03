begin;
select plan(6);
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
select * from finish();
rollback;
