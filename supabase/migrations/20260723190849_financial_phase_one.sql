alter table public.payments
  add column received_amount_cents integer,
  add column payment_method text,
  add column financial_note text;

alter table public.payments
  add constraint payments_received_amount_positive
    check (received_amount_cents is null or received_amount_cents > 0),
  add constraint payments_payment_method_valid
    check (payment_method is null or payment_method in ('pix', 'dinheiro', 'cartao', 'transferencia', 'outro')),
  add constraint payments_financial_note_length
    check (financial_note is null or char_length(financial_note) <= 500);

update public.payments
   set received_amount_cents = amount_cents,
       payment_method = 'pix'
 where status = 'paga';

create table public.manual_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  description text not null check (char_length(description) between 2 and 120),
  amount_cents integer not null check (amount_cents > 0),
  received_date date not null,
  payment_method text not null
    check (payment_method in ('pix', 'dinheiro', 'cartao', 'transferencia', 'outro')),
  note text check (note is null or char_length(note) <= 500),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_entry_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  source_type text not null check (source_type in ('payment', 'manual_receipt')),
  source_id uuid not null,
  action text not null check (action in ('created', 'updated', 'voided', 'payment_reopened')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index idx_payments_paid_at
  on public.payments (paid_at)
  where status = 'paga';
create index idx_manual_receipts_provider_date
  on public.manual_receipts (provider_id, received_date desc)
  where voided_at is null;
create index idx_manual_receipts_client
  on public.manual_receipts (client_id)
  where client_id is not null;
create index idx_financial_entry_events_provider_created
  on public.financial_entry_events (provider_id, created_at desc);
create index idx_financial_entry_events_source
  on public.financial_entry_events (source_type, source_id);

alter table public.manual_receipts enable row level security;
alter table public.financial_entry_events enable row level security;

revoke all on public.manual_receipts from anon, authenticated;
revoke all on public.financial_entry_events from anon, authenticated;
