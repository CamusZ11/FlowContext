begin;
select plan(4);
select has_table('topic_cards');
select col_not_null('topic_cards', 'project_id');
select col_not_null('todos', 'planned_date');
select has_trigger('handoffs', 'reject_handoff_mutation');
select * from finish();
rollback;
