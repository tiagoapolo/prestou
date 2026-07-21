create table public.assistant_action_proposals (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  session_id uuid not null,
  tool text not null check (tool in ('marcar_pago_manual')),
  arguments jsonb not null,
  summary text not null check (char_length(summary) between 1 and 500),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  idempotency_key uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (provider_id, idempotency_key),
  check (
    (consumed_at is null and result is null)
    or (consumed_at is not null and result is not null)
  )
);

create index idx_assistant_action_proposals_pending_expiry
  on public.assistant_action_proposals (expires_at)
  where consumed_at is null;

alter table public.assistant_action_proposals enable row level security;
revoke all on public.assistant_action_proposals from anon, authenticated;
