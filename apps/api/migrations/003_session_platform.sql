alter table sessions
  add column platform text;

update sessions s
set platform = (
  select w.platform
  from topic_cards t
  join device_workspaces w
    on w.owner_id = t.owner_id
   and w.project_id = t.project_id
   and w.device_id = s.device_id
  where t.owner_id = s.owner_id
    and t.id = s.topic_card_id
)
where s.platform is null;

do $$
begin
  if exists (select 1 from sessions where platform is null) then
    raise exception 'cannot infer sessions.platform for existing rows';
  end if;
end;
$$;

alter table sessions
  alter column platform set not null,
  add constraint sessions_platform_check check (platform in ('macos', 'windows'));
