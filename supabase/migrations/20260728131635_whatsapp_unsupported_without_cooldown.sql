-- Pedidos fora do escopo e erros de digitação recebem orientação do assistente,
-- mas não são abuso. Mantemos o outcome para observabilidade sem acumular uma
-- sequência inválida nem bloquear mensagens válidas posteriores.
update private.whatsapp_guardrail_state as state
   set invalid_streak = 0,
       blocked_until = null,
       updated_at = now()
 where invalid_streak > 0
   and (
     select event.outcome
       from private.whatsapp_guardrail_events as event
      where event.provider_id = state.provider_id
        and event.outcome <> 'cooldown'
      order by event.created_at desc
      limit 1
   ) = 'unsupported';

create or replace function private.finish_whatsapp_message(
  p_provider_id uuid,
  p_message_id text,
  p_invalid boolean,
  p_invalid_limit integer,
  p_cooldown_minutes integer
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_provider_id::text, 90421)
  );

  update private.whatsapp_guardrail_state
     set invalid_streak = 0,
         processing_message_id = null,
         processing_until = null,
         updated_at = v_now
   where provider_id = p_provider_id
     and processing_message_id = p_message_id;

  if p_invalid then
    update private.whatsapp_guardrail_events set outcome = 'unsupported'
     where message_id = p_message_id;
  end if;
end;
$$;

revoke execute on function private.finish_whatsapp_message(uuid, text, boolean, integer, integer)
  from public, anon, authenticated;
