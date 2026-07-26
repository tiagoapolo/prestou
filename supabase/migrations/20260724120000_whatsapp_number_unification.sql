-- Unificação do número de WhatsApp (plano-cadastro-prestador-whatsapp.md).
--
-- Antes: dois números por prestador que podiam divergir —
--   providers.whatsapp (destino das notificações, editável sem validação) e
--   provider_whatsapp_numbers.phone_e164 (verificado por OTP, libera o inbound).
-- Depois: providers.whatsapp é a fonte única da verdade e só é atendido pelo
--   inbound depois de provado (whatsapp_verified_at). O estado transitório da
--   verificação (candidato + código + limites) vive no schema private, fora do
--   Data API, com limites aplicados de forma atômica no PostgreSQL.
--
-- Todo prestador ativo passa a ter exatamente um número globalmente único e
-- já provado. O único legado conhecido é preservado somente se a verificação
-- antiga corresponde ao mesmo número que recebia o OTP.

-- 1. Número canônico provado.
alter table public.providers
  add column whatsapp_verified_at timestamptz;

-- O fluxo antigo enviava o OTP para providers.whatsapp, não necessariamente
-- para phone_e164. Portanto o verified_at antigo só é evidência quando ambos
-- representam o mesmo número.
update public.providers pr
   set whatsapp_verified_at = wn.verified_at
  from public.provider_whatsapp_numbers wn
 where wn.provider_id = pr.id
   and wn.verified_at is not null
   and pg_catalog.right(wn.phone_e164, 11) = pr.whatsapp;

do $$
begin
  if exists (
    select 1 from public.providers where whatsapp_verified_at is null
  ) then
    raise exception
      'Há prestador sem prova compatível de WhatsApp; verifique-o antes de aplicar esta migração';
  end if;
end;
$$;

alter table public.providers
  alter column whatsapp_verified_at set not null;

-- Um único formato canônico nacional (DDD + 9 dígitos) evita que a mesma conta
-- do WhatsApp seja cadastrada como duas strings diferentes.
alter table public.providers
  add constraint providers_whatsapp_mobile_format
  check (whatsapp ~ '^[1-9][0-9]9[0-9]{8}$');

-- Unicidade global: um número provado -> exatamente uma conta.
create unique index uq_providers_whatsapp
  on public.providers (whatsapp);

-- 2. Estado transitório da verificação, server-side apenas (schema private já
--    existe para o guardrail). code_digest guarda HMAC-SHA-256 do código, nunca
--    o código em claro: o espaço de 6 dígitos é enumerável se o banco vazar.
create table private.whatsapp_verifications (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  candidate_phone text not null check (candidate_phone ~ '^[1-9][0-9]9[0-9]{8}$'),
  code_digest text not null,
  expires_at timestamptz not null,
  verify_attempts integer not null default 0 check (verify_attempts >= 0),
  blocked_until timestamptz,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Um candidato reservado por vez enquanto a verificação está viva: reduz
-- bombardeio e evita duas contas disputarem o mesmo número no TTL curto.
create unique index uq_whatsapp_verifications_candidate
  on private.whatsapp_verifications (candidate_phone);

alter table private.whatsapp_verifications enable row level security;

-- Contadores diários de envio de código: por prestador, por destinatário e
-- global. São a barreira atômica contra bombardeio de OTP.
create table private.whatsapp_verification_sends (
  scope text not null check (scope in ('provider_day', 'candidate_day', 'global_day')),
  scope_id text not null,
  window_start timestamptz not null,
  count integer not null check (count > 0),
  primary key (scope, scope_id, window_start)
);

alter table private.whatsapp_verification_sends enable row level security;

-- Administração do piloto. A identidade é o auth.users.id, não metadado
-- editável do usuário. Preserva o único administrador existente.
create table private.app_admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into private.app_admins (auth_user_id)
select auth_user_id
  from public.providers
 where pg_catalog.lower(email) = 'tiago@tiagopaiva.me'
union
select id
  from auth.users
 where pg_catalog.lower(email) = 'tiago@tiagopaiva.me'
on conflict do nothing;

alter table private.app_admins enable row level security;

-- Convite autoriza o cadastro, mas não prova o telefone. A prova nasce quando
-- o mesmo número envia um inbound assinado pela Meta.
create table private.whatsapp_signup_invites (
  id uuid primary key,
  phone text not null check (phone ~ '^[1-9][0-9]9[0-9]{8}$'),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'consumed', 'revoked')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index uq_whatsapp_signup_invites_active_phone
  on private.whatsapp_signup_invites (phone)
  where status in ('pending', 'claimed');

alter table private.whatsapp_signup_invites enable row level security;

create table private.whatsapp_onboarding_sessions (
  id uuid primary key,
  invite_id uuid not null unique
    references private.whatsapp_signup_invites(id) on delete cascade,
  phone text not null check (phone ~ '^[1-9][0-9]9[0-9]{8}$'),
  phone_verified_at timestamptz not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  requested_email text,
  email_requested_at timestamptz,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index uq_whatsapp_onboarding_active_phone
  on private.whatsapp_onboarding_sessions (phone)
  where consumed_at is null;

create unique index uq_whatsapp_onboarding_active_auth_user
  on private.whatsapp_onboarding_sessions (auth_user_id)
  where auth_user_id is not null and consumed_at is null;

alter table private.whatsapp_onboarding_sessions enable row level security;

-- Somente usuários Auth criados pela API para este onboarding entram aqui.
-- A retenção usa esta allowlist para nunca apagar uma identidade preexistente.
create table private.whatsapp_onboarding_auth_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table private.whatsapp_onboarding_auth_users enable row level security;

create table private.whatsapp_onboarding_tokens (
  id uuid primary key,
  session_id uuid not null references private.whatsapp_onboarding_sessions(id) on delete cascade,
  token_digest text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index uq_whatsapp_onboarding_active_token
  on private.whatsapp_onboarding_tokens (session_id)
  where consumed_at is null;

alter table private.whatsapp_onboarding_tokens enable row level security;

-- Deduplicação ocorre antes de qualquer resposta, Auth ou criação de sessão.
create table private.whatsapp_onboarding_messages (
  message_id text primary key,
  phone text not null,
  created_at timestamptz not null default now()
);

alter table private.whatsapp_onboarding_messages enable row level security;

create table private.whatsapp_onboarding_counters (
  scope text not null check (scope in ('phone_day', 'global_day')),
  scope_id text not null,
  window_start timestamptz not null,
  count integer not null check (count > 0),
  primary key (scope, scope_id, window_start)
);

alter table private.whatsapp_onboarding_counters enable row level security;

-- 3. A prova compatível já foi migrada; o estado legado sai junto.
drop table public.provider_whatsapp_numbers;

-- 4. Início da verificação: checagem-e-reserva do candidato e limites diários,
--    tudo atômico sob advisory lock por candidato. Retorna a decisão; o envio
--    do código (e seu tratamento de falha) fica na aplicação.
create or replace function private.start_whatsapp_verification(
  p_provider_id uuid,
  p_candidate text,
  p_code_digest text,
  p_ttl_minutes integer,
  p_resend_seconds integer,
  p_provider_day_limit integer,
  p_candidate_day_limit integer,
  p_global_day_limit integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_count integer;
  v_blocked_until timestamptz;
  v_last_sent_at timestamptz;
begin
  -- Um prestador só pode ter uma verificação pendente; serializar também por
  -- provider impede dois envios concorrentes para candidatos diferentes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_provider_id::text, 31077)
  );

  -- Serializa por candidato: torna a checagem de disponibilidade e a reserva
  -- uma operação atômica entre todas as instâncias da API.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_candidate, 90423)
  );

  -- Libera reservas expiradas e sem cooldown ativo, para o candidato não ficar
  -- preso indefinidamente. Reservas em cooldown (excesso de tentativas) ficam.
  delete from private.whatsapp_verifications
   where expires_at < v_now
     and (blocked_until is null or blocked_until < v_now);

  -- Retenção oportunista: somente o dia atual participa dos limites.
  delete from private.whatsapp_verification_sends
   where window_start < pg_catalog.date_trunc('day', v_now) - interval '2 days';

  -- Prestador e global contam toda tentativa, inclusive candidato ocupado. Isso
  -- impede enumeração ilimitada por respostas/cooldowns observáveis.
  insert into private.whatsapp_verification_sends (scope, scope_id, window_start, count)
  values ('provider_day', p_provider_id::text, pg_catalog.date_trunc('day', v_now), 1)
  on conflict (scope, scope_id, window_start)
  do update set count = private.whatsapp_verification_sends.count + 1
  returning count into v_count;
  if v_count > p_provider_day_limit then return 'rate'; end if;

  insert into private.whatsapp_verification_sends (scope, scope_id, window_start, count)
  values ('global_day', 'all', pg_catalog.date_trunc('day', v_now), 1)
  on conflict (scope, scope_id, window_start)
  do update set count = private.whatsapp_verification_sends.count + 1
  returning count into v_count;
  if v_count > p_global_day_limit then return 'rate'; end if;

  -- Unicidade global: número já pertence a outra conta.
  if exists (
    select 1 from public.providers
     where whatsapp = p_candidate and id <> p_provider_id
  ) then
    return 'taken';
  end if;

  -- Candidato reservado por verificação ativa de outro prestador.
  if exists (
    select 1 from private.whatsapp_verifications
     where candidate_phone = p_candidate and provider_id <> p_provider_id
  ) then
    return 'taken';
  end if;

  -- Cooldown por bloqueio ou reenvio recente do próprio prestador.
  select blocked_until, last_sent_at
    into v_blocked_until, v_last_sent_at
    from private.whatsapp_verifications
   where provider_id = p_provider_id
   for update;

  if found then
    if v_blocked_until is not null and v_blocked_until > v_now then
      return 'cooldown';
    end if;
    if v_last_sent_at > v_now - pg_catalog.make_interval(secs => p_resend_seconds) then
      return 'cooldown';
    end if;
  end if;

  -- Só o destinatário de um envio real consome o limite de candidato.
  insert into private.whatsapp_verification_sends (scope, scope_id, window_start, count)
  values ('candidate_day', p_candidate, pg_catalog.date_trunc('day', v_now), 1)
  on conflict (scope, scope_id, window_start)
  do update set count = private.whatsapp_verification_sends.count + 1
  returning count into v_count;
  if v_count > p_candidate_day_limit then return 'rate'; end if;

  -- Reserva o candidato e grava o novo código. O advisory lock por candidato
  -- garante que a checagem acima e este upsert não corram entre si.
  insert into private.whatsapp_verifications
    (provider_id, candidate_phone, code_digest, expires_at, verify_attempts, blocked_until, last_sent_at)
  values
    (p_provider_id, p_candidate, p_code_digest,
     v_now + pg_catalog.make_interval(mins => p_ttl_minutes), 0, null, v_now)
  on conflict (provider_id) do update set
    candidate_phone = excluded.candidate_phone,
    code_digest     = excluded.code_digest,
    expires_at      = excluded.expires_at,
    verify_attempts = 0,
    blocked_until   = null,
    last_sent_at    = v_now;

  return 'ok';
end;
$$;

revoke all on all tables in schema private from public, anon, authenticated;
revoke execute on function private.start_whatsapp_verification(uuid, text, text, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
