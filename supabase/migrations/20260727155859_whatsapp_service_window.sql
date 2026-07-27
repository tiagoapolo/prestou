-- A janela de atendimento pertence ao número do usuário do WhatsApp, não à
-- conta Prestou. Isso evita reaproveitar o prazo quando o prestador troca o
-- número vinculado e também cobre o onboarding antes de existir uma conta.
create table private.whatsapp_service_windows (
  phone_e164 text primary key check (phone_e164 ~ '^[1-9][0-9]{7,14}$'),
  last_inbound_at timestamptz not null
);

alter table private.whatsapp_service_windows enable row level security;
revoke all on private.whatsapp_service_windows from public, anon, authenticated;
