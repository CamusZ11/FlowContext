alter table todos
  add column category text check (category in ('work', 'study', 'daily', 'health'));
