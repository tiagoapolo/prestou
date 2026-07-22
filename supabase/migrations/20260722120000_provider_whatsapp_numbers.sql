-- Vínculo e verificação do WhatsApp do prestador (ADR-009).
-- O número identifica o prestador na borda do webhook (depois de a assinatura
-- da Meta provar a origem); nunca substitui o JWT do Dashboard. Só números
-- verificados são atendidos pelo inbound.
create table public.provider_whatsapp_numbers (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  phone_e164 text not null unique,
  verified_at timestamptz,
  verification_code text,
  code_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Resolução provider-por-número no webhook: só os verificados.
create index idx_provider_whatsapp_numbers_verified
  on public.provider_whatsapp_numbers (phone_e164)
  where verified_at is not null;

alter table public.provider_whatsapp_numbers enable row level security;
revoke all on public.provider_whatsapp_numbers from anon, authenticated;
