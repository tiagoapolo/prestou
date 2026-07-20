alter table public.providers
  add column state text,
  add column municipality_code text;

alter table public.providers
  add constraint providers_state_format
    check (state is null or state ~ '^[A-Z]{2}$'),
  add constraint providers_municipality_code_format
    check (municipality_code is null or municipality_code ~ '^\d{7}$'),
  add constraint providers_municipality_complete
    check (
      (state is null and municipality_code is null)
      or (city is not null and state is not null and municipality_code is not null)
    );
