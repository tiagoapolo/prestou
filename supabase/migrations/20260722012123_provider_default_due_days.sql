alter table public.providers
  add column default_due_days smallint not null default 0,
  add constraint providers_default_due_days_allowed
    check (default_due_days in (0, 1, 5, 15, 30));
