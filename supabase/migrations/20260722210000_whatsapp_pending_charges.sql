-- Rascunho parcial de cobrança em preenchimento, por prestador. Guarda apenas os
-- campos já extraídos quando o assistente ainda precisa de um dado (ex.: o
-- WhatsApp de um cliente novo), para que a próxima mensagem retome o contexto em
-- vez de recomeçar. Um único rascunho pendente por prestador (PK em provider_id);
-- expira sozinho por TTL curto. O modelo nunca lê esta tabela: o merge acontece
-- no backend, como todo o resto do "cérebro".
create table public.whatsapp_pending_charges (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  partial jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index idx_whatsapp_pending_charges_expiry
  on public.whatsapp_pending_charges (expires_at);

alter table public.whatsapp_pending_charges enable row level security;
revoke all on public.whatsapp_pending_charges from anon, authenticated;
