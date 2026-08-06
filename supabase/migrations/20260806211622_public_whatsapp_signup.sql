-- A sessão deixa de depender exclusivamente de convite administrativo, mas o
-- caminho do piloto continua sendo o default para compatibilidade.
alter table private.whatsapp_onboarding_sessions
  add column entry_mode text,
  add column onboarding_journey_id uuid,
  add column attribution jsonb;

update private.whatsapp_onboarding_sessions
   set entry_mode = 'invite',
       onboarding_journey_id = gen_random_uuid(),
       attribution = '{"entryMode":"invite"}'::jsonb
 where entry_mode is null;

alter table private.whatsapp_onboarding_sessions
  alter column entry_mode set default 'invite',
  alter column entry_mode set not null,
  alter column onboarding_journey_id set default gen_random_uuid(),
  alter column onboarding_journey_id set not null,
  alter column attribution set default '{}'::jsonb,
  alter column attribution set not null,
  alter column invite_id drop not null;

alter table private.whatsapp_onboarding_sessions
  add constraint whatsapp_onboarding_sessions_entry_mode_check
    check (entry_mode in ('invite', 'public')) not valid,
  add constraint whatsapp_onboarding_sessions_origin_check
    check (
      (entry_mode = 'invite' and invite_id is not null)
      or (entry_mode = 'public' and invite_id is null)
    ) not valid,
  add constraint whatsapp_onboarding_sessions_attribution_check
    check (jsonb_typeof(attribution) = 'object') not valid;

alter table private.whatsapp_onboarding_sessions
  validate constraint whatsapp_onboarding_sessions_entry_mode_check,
  validate constraint whatsapp_onboarding_sessions_origin_check,
  validate constraint whatsapp_onboarding_sessions_attribution_check;

create unique index uq_whatsapp_onboarding_journey
  on private.whatsapp_onboarding_sessions (onboarding_journey_id);

-- Eventos de aquisição existem antes de haver provider. O identificador da
-- jornada os conecta à promoção final sem registrar telefone, e-mail ou token.
alter table public.events
  add column onboarding_journey_id uuid;

create unique index uq_events_onboarding_journey_type
  on public.events (onboarding_journey_id, type)
  where onboarding_journey_id is not null;

create index idx_events_type_created
  on public.events (type, created_at desc);

create index idx_events_provider_type_created
  on public.events (provider_id, type, created_at desc)
  where provider_id is not null;

alter table private.whatsapp_onboarding_counters
  drop constraint whatsapp_onboarding_counters_scope_check;

alter table private.whatsapp_onboarding_counters
  add constraint whatsapp_onboarding_counters_scope_check
    check (scope in ('phone_day', 'global_day', 'entry_global_day'));
