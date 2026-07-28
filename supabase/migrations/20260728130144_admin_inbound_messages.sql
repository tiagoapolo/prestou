create table private.whatsapp_inbound_messages (
  message_id text primary key,
  provider_id uuid references public.providers(id) on delete cascade,
  sender_phone text not null,
  kind text not null check (kind in ('text', 'button')),
  content text not null,
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index idx_whatsapp_inbound_messages_received
  on private.whatsapp_inbound_messages (received_at desc, message_id desc);

create index idx_whatsapp_inbound_messages_provider
  on private.whatsapp_inbound_messages (provider_id);

alter table private.whatsapp_inbound_messages enable row level security;
revoke all on private.whatsapp_inbound_messages from public, anon, authenticated;
