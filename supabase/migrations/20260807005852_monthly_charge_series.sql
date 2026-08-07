create table public.charge_series (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  description text not null check (char_length(description) between 2 and 120),
  amount_cents integer not null check (amount_cents between 1 and 9999999),
  first_due_date date not null,
  anchor_day smallint not null check (anchor_day between 1 and 31),
  end_date date not null,
  next_due_date date,
  status text not null default 'ativa'
    check (status in ('ativa', 'pausada', 'cancelada', 'concluida')),
  paused_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint charge_series_minimum_range
    check (end_date >= (first_due_date + interval '1 month')::date),
  constraint charge_series_next_due_range
    check (next_due_date is null or (
      next_due_date > first_due_date and next_due_date <= end_date
    )),
  constraint charge_series_terminal_state
    check (
      (status in ('ativa', 'pausada') and next_due_date is not null)
      or (status in ('cancelada', 'concluida') and next_due_date is null)
    )
);

create index idx_charge_series_provider_created
  on public.charge_series (provider_id, created_at desc, id desc);

create index idx_charge_series_client
  on public.charge_series (client_id);

create index idx_charge_series_active_due
  on public.charge_series (next_due_date, id)
  where status = 'ativa';

alter table public.charges
  add column charge_series_id uuid references public.charge_series(id) on delete restrict,
  add column series_sequence smallint,
  add constraint charges_series_occurrence
    check (
      (charge_series_id is null and series_sequence is null)
      or (charge_series_id is not null and series_sequence > 0)
    );

create unique index uq_charges_series_sequence
  on public.charges (charge_series_id, series_sequence)
  where charge_series_id is not null;

create index idx_charges_series
  on public.charges (charge_series_id)
  where charge_series_id is not null;

alter table public.charge_series enable row level security;
revoke all on public.charge_series from anon, authenticated;
