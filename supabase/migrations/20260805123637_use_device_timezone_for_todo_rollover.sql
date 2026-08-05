-- Replace the initial rollover RPC with a device-timezone-aware signature.
-- SECURITY INVOKER deliberately preserves todos RLS policies.
drop function if exists public.rollover_incomplete_todos(date, date);

create function public.rollover_incomplete_todos(
  p_from_date date,
  p_to_date date,
  p_timezone text
)
returns setof public.todos
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_today date;
begin
  if p_from_date is null or p_to_date is null then
    raise exception 'rollover dates are required';
  end if;

  if p_timezone is null
     or not exists (
       select 1
         from pg_catalog.pg_timezone_names()
        where name = p_timezone
     ) then
    raise exception 'rollover timezone must be a valid IANA timezone';
  end if;

  if p_from_date + 1 <> p_to_date then
    raise exception 'rollover dates must be adjacent';
  end if;

  v_today := (statement_timestamp() at time zone p_timezone)::date;
  if p_from_date <> v_today - 1 or p_to_date <> v_today then
    raise exception 'rollover dates must target yesterday and today in the device timezone';
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

revoke all on function public.rollover_incomplete_todos(date, date, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rollover_incomplete_todos(date, date, text)
  to authenticated, service_role;
