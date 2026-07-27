alter table public.clients
  add column saved_for_future boolean not null default true;
