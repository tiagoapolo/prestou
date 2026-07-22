create table public.whatsapp_charge_proposals (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  draft jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  check (not (consumed_at is not null and cancelled_at is not null)),
  check (
    (consumed_at is null and result is null)
    or (consumed_at is not null and result is not null)
  )
);

create index idx_whatsapp_charge_proposals_pending_expiry
  on public.whatsapp_charge_proposals (expires_at)
  where consumed_at is null and cancelled_at is null;

alter table public.whatsapp_charge_proposals enable row level security;
revoke all on public.whatsapp_charge_proposals from anon, authenticated;
