-- Prestou MVP — schema de produção no PostgreSQL do Supabase.
-- A API Railway usa uma conexão server-side; anon/authenticated não recebem
-- acesso direto às tabelas. A identidade é validada na API pelo JWT Supabase.

create extension if not exists pgcrypto;

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  name text not null check (char_length(name) between 2 and 80),
  profession text not null check (char_length(profession) between 2 and 60),
  photo_url text,
  city text,
  pix_key text not null,
  pix_key_type text not null check (pix_key_type in ('cpf', 'cnpj', 'phone', 'email', 'evp')),
  whatsapp text not null,
  consent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  whatsapp text not null,
  created_at timestamptz not null default now(),
  unique (provider_id, whatsapp)
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  description text not null check (char_length(description) between 2 and 120),
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.charges(id) on delete cascade,
  seq integer not null default 1 check (seq > 0),
  amount_cents integer not null check (amount_cents > 0),
  due_date date not null,
  status text not null default 'em_aberto'
    check (status in ('em_aberto', 'cliente_confirmou', 'paga')),
  public_token text not null unique,
  brcode text not null,
  client_confirmed_at timestamptz,
  comprovante_path text,
  paid_at timestamptz,
  paid_via text check (paid_via is null or paid_via in ('client_confirmed', 'manual')),
  created_at timestamptz not null default now(),
  unique (charge_id, seq)
);

create table public.payment_transitions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null check (actor in ('client', 'provider', 'system')),
  action text not null,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  provider_id uuid references public.providers(id) on delete cascade,
  charge_id uuid references public.charges(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete cascade,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  kind text not null,
  body text not null,
  wa_deeplink text,
  status text not null check (status in ('logged', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index idx_payments_charge on public.payments(charge_id);
create index idx_payments_due_open on public.payments(due_date) where status = 'em_aberto';
create index idx_charges_provider on public.charges(provider_id);
create index idx_events_type on public.events(type);
create index idx_events_provider_created on public.events(provider_id, created_at desc);
create index idx_notifications_provider on public.notifications(provider_id, created_at desc);

-- Defesa em profundidade: o navegador não consulta estas tabelas diretamente.
alter table public.providers enable row level security;
alter table public.clients enable row level security;
alter table public.charges enable row level security;
alter table public.payments enable row level security;
alter table public.payment_transitions enable row level security;
alter table public.events enable row level security;
alter table public.notifications enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- Bucket privado de comprovantes. Somente a service role usada pela API acessa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
