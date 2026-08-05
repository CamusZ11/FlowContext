-- Roll only the caller's unfinished To-dos from the immediately previous
-- planned date. SECURITY INVOKER deliberately preserves todos RLS policies.
create or replace function public.rollover_incomplete_todos(
  p_from_date date,
  p_to_date date
)
returns setof public.todos
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if p_from_date is null or p_to_date is null then
    raise exception 'rollover dates are required';
  end if;

  if p_from_date + 1 <> p_to_date then
    raise exception 'rollover dates must be adjacent';
  end if;

  if p_from_date <> current_date - 1 or p_to_date <> current_date then
    raise exception 'rollover dates must target yesterday and today';
  end if;

  if v_owner_id is null then
    raise exception 'authentication required';
  end if;

  return query
  update public.todos
     set planned_date = p_to_date,
         updated_at = now()
   where owner_id = v_owner_id
     and planned_date = p_from_date
     and is_completed = false
  returning *;
end;
$$;

revoke all on function public.rollover_incomplete_todos(date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.rollover_incomplete_todos(date, date)
  to authenticated, service_role;
