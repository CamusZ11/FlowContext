alter table todos
  add column planned_end_time time,
  add constraint todos_planned_end_time_valid check (
    planned_end_time is null or (
      planned_time is not null
      and planned_end_time > planned_time
      and planned_end_time < time '24:00'
      and extract(second from planned_end_time) = 0
    )
  );
