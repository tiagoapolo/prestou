-- Estado interno e persistente do guardrail do WhatsApp. A API usa PostgreSQL
-- server-side; nada deste schema é exposto ao Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.whatsapp_guardrail_events (
  message_id text primary key,
  provider_id uuid not null references public.providers(id) on delete cascade,
  fingerprint text not null,
  kind text not null check (kind in ('text', 'button')),
  text_length integer not null check (text_length >= 0),
  outcome text not null,
  ai_started_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_whatsapp_guardrail_events_provider_created
  on private.whatsapp_guardrail_events (provider_id, created_at desc);
create index idx_whatsapp_guardrail_events_fingerprint
  on private.whatsapp_guardrail_events (provider_id, fingerprint, created_at desc);

create table private.whatsapp_guardrail_buckets (
  scope text not null check (scope in ('provider_minute', 'provider_day', 'global_day')),
  scope_id text not null,
  window_start timestamptz not null,
  count integer not null check (count > 0),
  primary key (scope, scope_id, window_start)
);

create table private.whatsapp_guardrail_state (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  invalid_streak integer not null default 0 check (invalid_streak >= 0),
  blocked_until timestamptz,
  processing_message_id text,
  processing_until timestamptz,
  last_warning_at timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function private.admit_whatsapp_message(
  p_provider_id uuid,
  p_message_id text,
  p_fingerprint text,
  p_kind text,
  p_text_length integer,
  p_max_length integer,
  p_per_minute integer,
  p_per_day integer,
  p_global_daily_ai integer,
  p_cooldown_minutes integer,
  p_processing_lease_seconds integer,
  p_invalid_limit integer
)
returns table (decision text, allowed boolean, should_notify boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_inserted integer;
  v_count integer;
  v_invalid_streak integer;
  v_blocked_until timestamptz;
  v_processing_until timestamptz;
  v_notify boolean;
begin
  if p_kind not in ('text', 'button') then
    raise exception 'invalid WhatsApp message kind';
  end if;

  -- Serializa decisões do mesmo prestador em todas as instâncias da API.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_provider_id::text, 90421)
  );

  insert into private.whatsapp_guardrail_state (provider_id)
  values (p_provider_id)
  on conflict (provider_id) do nothing;

  select invalid_streak, blocked_until, processing_until
    into v_invalid_streak, v_blocked_until, v_processing_until
    from private.whatsapp_guardrail_state
   where provider_id = p_provider_id
   for update;

  insert into private.whatsapp_guardrail_events
    (message_id, provider_id, fingerprint, kind, text_length, outcome)
  values
    (p_message_id, p_provider_id, p_fingerprint, p_kind, p_text_length, 'pending')
  on conflict (message_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    decision := 'duplicate'; allowed := false; should_notify := false;
    return next; return;
  end if;

  -- Retenção oportunista: os dados só são necessários para janelas curtas.
  delete from private.whatsapp_guardrail_events
   where provider_id = p_provider_id
     and created_at < v_now - interval '2 days';
  delete from private.whatsapp_guardrail_buckets
   where window_start < pg_catalog.date_trunc('day', v_now) - interval '2 days';

  if v_blocked_until is not null and v_blocked_until > v_now then
    update private.whatsapp_guardrail_events set outcome = 'cooldown'
     where message_id = p_message_id;
    decision := 'cooldown'; allowed := false; should_notify := false;
    return next; return;
  end if;

  if p_text_length > p_max_length then
    v_invalid_streak := v_invalid_streak + 1;
    select last_warning_at is null
        or last_warning_at <= v_now - pg_catalog.make_interval(mins => p_cooldown_minutes)
      into v_notify
      from private.whatsapp_guardrail_state
     where provider_id = p_provider_id;

    update private.whatsapp_guardrail_state
       set invalid_streak = v_invalid_streak,
           blocked_until = case when v_invalid_streak >= p_invalid_limit
             then v_now + pg_catalog.make_interval(mins => p_cooldown_minutes)
             else blocked_until end,
           last_warning_at = case when v_notify then v_now else last_warning_at end,
           updated_at = v_now
     where provider_id = p_provider_id;
    update private.whatsapp_guardrail_events set outcome = 'too_long'
     where message_id = p_message_id;
    decision := 'too_long'; allowed := false; should_notify := v_notify;
    return next; return;
  end if;

  if exists (
    select 1 from private.whatsapp_guardrail_events
     where provider_id = p_provider_id
       and fingerprint = p_fingerprint
       and message_id <> p_message_id
       and created_at >= v_now - interval '30 seconds'
  ) then
    update private.whatsapp_guardrail_events set outcome = 'duplicate_content'
     where message_id = p_message_id;
    decision := 'duplicate_content'; allowed := false; should_notify := false;
    return next; return;
  end if;

  insert into private.whatsapp_guardrail_buckets (scope, scope_id, window_start, count)
  values ('provider_minute', p_provider_id::text, pg_catalog.date_trunc('minute', v_now), 1)
  on conflict (scope, scope_id, window_start)
  do update set count = private.whatsapp_guardrail_buckets.count + 1
  returning count into v_count;

  if v_count > p_per_minute then
    update private.whatsapp_guardrail_events set outcome = 'rate_minute'
     where message_id = p_message_id;
    update private.whatsapp_guardrail_state
       set blocked_until = v_now + pg_catalog.make_interval(mins => p_cooldown_minutes),
           last_warning_at = v_now,
           updated_at = v_now
     where provider_id = p_provider_id;
    decision := 'rate_minute'; allowed := false; should_notify := true;
    return next; return;
  end if;

  insert into private.whatsapp_guardrail_buckets (scope, scope_id, window_start, count)
  values ('provider_day', p_provider_id::text, pg_catalog.date_trunc('day', v_now), 1)
  on conflict (scope, scope_id, window_start)
  do update set count = private.whatsapp_guardrail_buckets.count + 1
  returning count into v_count;

  if v_count > p_per_day then
    update private.whatsapp_guardrail_events set outcome = 'rate_day'
     where message_id = p_message_id;
    update private.whatsapp_guardrail_state
       set blocked_until = v_now + pg_catalog.make_interval(mins => p_cooldown_minutes),
           last_warning_at = v_now,
           updated_at = v_now
     where provider_id = p_provider_id;
    decision := 'rate_day'; allowed := false; should_notify := true;
    return next; return;
  end if;

  if v_processing_until is not null and v_processing_until > v_now then
    update private.whatsapp_guardrail_events set outcome = 'busy'
     where message_id = p_message_id;
    decision := 'busy'; allowed := false; should_notify := false;
    return next; return;
  end if;

  -- Botões não chamam a IA, mas passam por deduplicação e limites de entrada.
  if p_kind = 'button' then
    update private.whatsapp_guardrail_events set outcome = 'accepted'
     where message_id = p_message_id;
    decision := 'allowed'; allowed := true; should_notify := false;
    return next; return;
  end if;

  insert into private.whatsapp_guardrail_buckets (scope, scope_id, window_start, count)
  values ('global_day', 'openai', pg_catalog.date_trunc('day', v_now), 1)
  on conflict (scope, scope_id, window_start)
  do update set count = private.whatsapp_guardrail_buckets.count + 1
  returning count into v_count;

  if v_count > p_global_daily_ai then
    update private.whatsapp_guardrail_events set outcome = 'global_daily'
     where message_id = p_message_id;
    select last_warning_at is null
        or last_warning_at <= v_now - pg_catalog.make_interval(mins => p_cooldown_minutes)
      into v_notify
      from private.whatsapp_guardrail_state
     where provider_id = p_provider_id;
    update private.whatsapp_guardrail_state
       set last_warning_at = case when v_notify then v_now else last_warning_at end,
           updated_at = v_now
     where provider_id = p_provider_id;
    decision := 'global_daily'; allowed := false; should_notify := v_notify;
    return next; return;
  end if;

  update private.whatsapp_guardrail_state
     set processing_message_id = p_message_id,
         processing_until = v_now + pg_catalog.make_interval(secs => p_processing_lease_seconds),
         updated_at = v_now
   where provider_id = p_provider_id;
  update private.whatsapp_guardrail_events
     set outcome = 'accepted', ai_started_at = v_now
   where message_id = p_message_id;

  decision := 'allowed'; allowed := true; should_notify := false;
  return next;
end;
$$;

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
     set invalid_streak = case when p_invalid then invalid_streak + 1 else 0 end,
         blocked_until = case
           when p_invalid and invalid_streak + 1 >= p_invalid_limit
             then v_now + pg_catalog.make_interval(mins => p_cooldown_minutes)
           else blocked_until
         end,
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

create or replace function private.release_whatsapp_message(
  p_provider_id uuid,
  p_message_id text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update private.whatsapp_guardrail_state
     set processing_message_id = null,
         processing_until = null,
         updated_at = now()
   where provider_id = p_provider_id
     and processing_message_id = p_message_id;
$$;

revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on function private.admit_whatsapp_message(uuid, text, text, text, integer, integer, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke execute on function private.finish_whatsapp_message(uuid, text, boolean, integer, integer)
  from public, anon, authenticated;
revoke execute on function private.release_whatsapp_message(uuid, text)
  from public, anon, authenticated;
