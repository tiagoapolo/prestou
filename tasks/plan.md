# Implementation Plan: Onboarding self-serve pelo WhatsApp

**Status:** aprovado — em execução

**Spec aprovada:** `specs/onboarding-self-serve-whatsapp.md`

**Data:** 2026-08-06

## Overview

O incremento abre uma entrada pública iniciada pelo próprio prestador no
WhatsApp, preservando o fluxo híbrido já implementado: o webhook assinado prova
o número, um link curto conduz ao Turnstile e ao magic link por e-mail, e o
`provider` só nasce depois da confirmação da identidade e do preenchimento web.

O trabalho é uma evolução aditiva do onboarding por convite. Convites continuam
funcionando; o sistema ganha os modos `disabled`, `invite_only` e `public`, uma
rota pública `/comecar`, atribuição de aquisição e um funil operacional até a
primeira cobrança.

Nenhuma tarefa deste plano habilita `public` em produção. O rollout é uma ação
operacional posterior e explicitamente aprovada.

## Current State

- `Onboarding.tsx` e `Login.tsx` exigem um token bearer de onboarding.
- O token é correto e deve permanecer; ele representa uma sessão curta, não o
  convite administrativo.
- `startInvitedWhatsAppOnboarding` só cria sessão quando encontra uma linha em
  `private.whatsapp_signup_invites`.
- `private.whatsapp_onboarding_sessions.invite_id` é obrigatório e impede uma
  origem pública.
- Número desconhecido é cortado antes da LLM, comportamento que precisa ser
  preservado.
- Turnstile, magic link, retenção, deduplicação, limites e promoção transacional
  para `providers` já existem e serão generalizados, não reescritos.
- `public.events` já registra o funil de cobrança, mas não correlaciona etapas
  anteriores à existência de um `provider`.

## Architecture Decisions

### 1. Token de onboarding permanece; autorização de origem muda

O link `/cadastro?token=...` continua usando 32 bytes aleatórios, HMAC no banco,
TTL curto e consumo único. A sessão passa a ter uma origem discriminada:

```ts
type SignupEntry =
  | { type: "invite"; inviteId: string }
  | { type: "public"; attribution: SignupAttribution };
```

Isso evita dois fluxos paralelos de Auth e mantém uma única promoção para
`provider`.

### 2. Modos operacionais são runtime config, com compatibilidade

Nova configuração: `WHATSAPP_SIGNUP_MODE=disabled|invite_only|public`.

- Se a variável nova estiver ausente, `WHATSAPP_SIGNUP_ENABLED=true` mapeia para
  `invite_only` e `false` para `disabled` durante a transição.
- `disabled` bloqueia criação e continuação de qualquer onboarding pendente.
- `invite_only` permite somente sessões originadas por convite.
- `public` permite convite e self-serve.
- Contas ativas nunca dependem desse modo.

`WHATSAPP_SIGNUP_GLOBAL_DAILY_LIMIT` limita sessões aceitas e será configurado
como `20` no rollout inicial. Um limite separado,
`WHATSAPP_SIGNUP_ENTRY_DAILY_LIMIT`, limita eventos/envelopes do topo do funil;
ao atingi-lo, o CTA continua abrindo a frase-base sem atribuição.

O frontend consulta a capacidade em runtime pela API; não haverá uma segunda
feature flag em `VITE_*` que possa divergir do backend.

### 3. A intenção pública é exata, determinística e não usa LLM

Mensagem-base: `Quero começar no Prestou`.

O CTA acrescenta opcionalmente um envelope de atribuição assinado. O envelope
contém `journeyId`, campos normalizados e expiração de 24 horas, mas não concede
capacidade. `source`/`medium` aceitam até 32 caracteres e
`campaign`/`content`, até 64, no alfabeto canônico `[a-z0-9._-]`:

```text
Quero começar no Prestou <envelope-assinado>
```

- A assinatura HMAC impede adulteração silenciosa da atribuição.
- Envelope ausente, inválido ou editado degrada para `direct/unknown`; não
  bloqueia um candidato legítimo que enviou a frase-base exata.
- “Oi”, anexos e demais textos de números desconhecidos continuam silenciosos.
- O envelope nunca substitui assinatura Meta, `wa_id`, Turnstile, e-mail ou
  token do link.
- Se outro telefone reutilizar um envelope já reivindicado, recebe uma nova
  jornada `direct/unknown`; a atribuição não pode bloquear o cadastro.

### 4. Uma jornada correlaciona eventos antes e depois da conta

Cada entrada recebe um `journeyId` UUID. A sessão persiste esse ID, a origem e a
atribuição validada. `public.events` ganha `onboarding_journey_id` opcional e
unicidade `(onboarding_journey_id, type)` para tornar cada etapa idempotente.

Eventos novos:

| Evento | Momento |
| --- | --- |
| `cadastro_entrada_aberta` | CTA público solicita o link `wa.me` |
| `cadastro_whatsapp_iniciado` | inbound elegível é aceito |
| `cadastro_link_emitido` | token web é persistido |
| `cadastro_link_aberto` | token válido é consultado na web |
| `cadastro_email_autorizado` | Turnstile e reserva de e-mail passam |
| `cadastro_conta_criada` | `provider` nasce e sessão é consumida |

A primeira ativação de produto é derivada do primeiro `cobranca_criada` do
`provider` correlacionado por `cadastro_conta_criada`; não será criado evento
redundante.

Metadados permitidos: `entryMode`, `source`, `medium`, `campaign` e `content`.
Não entram telefone, e-mail, texto da mensagem, token, IP ou chave Pix.

### 5. Concorrência pública é serializada por telefone

O convite hoje fornece uma linha para `FOR UPDATE`; a entrada pública não.
Antes de consultar/criar uma sessão pública, a transação adquire
`pg_advisory_xact_lock(hashtext(phone))`. Depois, usa os índices únicos já
existentes para garantir no máximo uma sessão e um token ativos por telefone.

Todas as chamadas externas — resposta Meta, Turnstile e Supabase Auth — ficam
fora de transações que seguram locks.

### 6. Migração é aditiva e preserva o piloto

Em `private.whatsapp_onboarding_sessions`:

- `invite_id` passa a aceitar `NULL`;
- entram `entry_mode`, `onboarding_journey_id` e `attribution jsonb`;
- um `CHECK` exige convite em `invite` e proíbe convite em `public`;
- linhas atuais são retropreenchidas como `invite` antes de `NOT NULL` e
  validação das constraints.

Em `public.events`:

- entra `onboarding_journey_id uuid NULL`;
- índice único em `(onboarding_journey_id, type)` garante eventos idempotentes;
- índices compostos cobrem agregação por `(type, created_at)` e correlação por
  `(provider_id, type, created_at)`.

RLS permanece habilitada em `public.events`; `anon` e `authenticated` continuam
sem acesso direto. Tabelas privadas mantêm RLS como defesa em profundidade.
O `CHECK` de escopo dos contadores passa a aceitar `entry_global_day` para
limitar a emissão de envelopes sem criar estado ilimitado por IP.

### 7. Contratos HTTP são aditivos

Os endpoints existentes não mudam de forma:

- `GET /public/whatsapp-onboarding/:token`
- `POST /public/whatsapp-onboarding/:token/email`
- `POST /api/providers`
- endpoints administrativos de convite

Entram três recursos:

```text
GET  /public/whatsapp-signup
POST /public/whatsapp-signup-entries
GET  /api/admin/insights/signup
```

Contratos:

```ts
interface PublicSignupStatus {
  isAvailable: boolean;
}

interface CreateSignupEntryInput {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

interface CreateSignupEntryOutput {
  whatsappUrl: string;
}
```

O endpoint administrativo recebe período limitado e filtros opcionais, e
retorna contagens e conversões agregadas; não lista candidatos. Os erros mantêm
o formato existente `{ error: string, code?: string }` para não introduzir uma
segunda convenção no mesmo serviço.

## Dependency Graph

```text
Contrato de configuração
        │
        ├── Migração source-aware + journeyId
        │          │
        │          ├── Intent/atribuição assinada
        │          │          │
        │          │          ├── API pública + CTA /comecar
        │          │          └── Admissão do inbound público
        │          │                     │
        │          │                     └── Auth + criação do provider
        │          │                                  │
        │          └── Eventos idempotentes ──────────┤
        │                                             │
        └─────────────────────────────────────────────┴── Funil administrativo
                                                               │
                                                               └── Rollout
```

## Task List

### Phase 1: Foundation

## Task 1: Introduzir o contrato de modos sem quebrar configuração existente

**Description:** Trocar o booleano interno por um enum de modo, preservar o
fallback de `WHATSAPP_SIGNUP_ENABLED` e validar no startup somente os segredos
exigidos pelo modo ativo.

**Acceptance criteria:**

- [ ] `disabled`, `invite_only` e `public` têm semântica unitariamente testada.
- [ ] Ambientes atuais com apenas `WHATSAPP_SIGNUP_ENABLED` mantêm o
  comportamento de convite.
- [ ] Produção falha no startup quando o modo exige Meta/Turnstile e a
  configuração está incompleta; limites de sessão e entrada são positivos.

**Verification:**

- [ ] `pnpm --filter @prestou/api exec node --test --import tsx test/config.test.ts`
- [ ] `pnpm --filter @prestou/api typecheck`
- [ ] Revisão manual da matriz modo × pré-requisito.

**Dependencies:** None

**Files likely touched:**

- `apps/api/src/config.ts`
- `apps/api/src/server.ts`
- `apps/api/.env.example`
- `apps/api/test/config.test.ts`

**Estimated scope:** Medium (4 files)

## Task 2: Tornar sessões source-aware e adicionar correlação do funil

**Description:** Criar uma migração Supabase aditiva que generaliza a sessão,
retropreenche linhas do piloto e prepara eventos idempotentes e índices para as
consultas do funil.

**Acceptance criteria:**

- [ ] Dados existentes passam como `invite`, com constraints e índices válidos.
- [ ] Uma sessão `public` pode existir sem convite, mas nenhuma combinação
  inválida de `entry_mode`/`invite_id` é aceita.
- [ ] RLS, revogações e índices de FK/consulta permanecem corretos segundo os
  advisors do Supabase.

**Verification:**

- [ ] Criar a migração com `supabase migration new public_whatsapp_signup`.
- [ ] Aplicar em projeto Supabase de teste e executar o teste de integração do
  onboarding.
- [ ] Rodar `supabase db advisors` ou MCP equivalente e revisar constraints em
  `pg_constraint`/`pg_indexes`.

**Dependencies:** Task 1

**Files likely touched:**

- `supabase/migrations/<timestamp>_public_whatsapp_signup.sql`
- `apps/api/test/onboarding-fixture.ts`
- `apps/api/test/whatsapp-verification.test.ts`

**Estimated scope:** Medium (3 files)

### Checkpoint A: Foundation

- [ ] Migração sobe sobre o schema atual sem apagar ou recriar convites.
- [ ] Fluxo invite-only existente continua verde.
- [ ] `pnpm --filter @prestou/api test`, `pnpm typecheck` e `pnpm build` passam.
- [ ] Revisão humana do diff de migração antes de qualquer aplicação fora de
  teste.

### Phase 2: Public acquisition path

## Task 3: Criar o contrato assinado de intenção e os primitivos de analytics

**Description:** Implementar funções puras para normalizar atribuição,
assinar/validar o envelope e reconhecer a frase determinística, além de permitir
que `track` grave eventos correlacionados e idempotentes.

**Acceptance criteria:**

- [ ] Apenas campos allowlisted e limitados entram na atribuição; assinatura,
  expiração e adulteração são testadas.
- [ ] Envelope inválido nunca concede autorização e resulta em
  `direct/unknown` somente quando a frase-base exata está presente.
- [ ] `track` aceita `onboardingJourneyId` sem alterar chamadas existentes.

**Verification:**

- [ ] `pnpm --filter @prestou/api exec node --test --import tsx test/public-signup.test.ts`
- [ ] `pnpm --filter @prestou/api typecheck`
- [ ] Inspeção de casos de abuso: payload longo, Unicode confusável, token
  expirado, assinatura trocada e replay.

**Dependencies:** Tasks 1–2

**Files likely touched:**

- `apps/api/src/public-signup.ts`
- `apps/api/src/analytics.ts`
- `apps/api/test/public-signup.test.ts`

**Estimated scope:** Medium (3 files)

## Task 4: Entregar a rota pública e o CTA até o WhatsApp

**Description:** Expor status e criação de entrada, gerar somente URL para o
número oficial e implementar `/comecar` com CTA acessível e atribuição vinda da
query string.

**Acceptance criteria:**

- [ ] Em `public`, o CTA abre `https://wa.me/<numero-oficial>` com a frase pronta
  e envelope assinado; em outros modos mostra indisponibilidade sem vazar config.
- [ ] Entrada registra `cadastro_entrada_aberta` uma vez por `journeyId`; ao
  atingir o teto de tracking, o CTA degrada para mensagem sem atribuição.
- [ ] O frontend não reflete parâmetros arbitrários e rejeita URL que não seja
  HTTPS no host `wa.me`.

**Verification:**

- [ ] Teste focado da API para `GET /public/whatsapp-signup` e
  `POST /public/whatsapp-signup-entries`.
- [ ] `pnpm --filter @prestou/web exec vitest run src/pages/SignupStart.test.tsx`
- [ ] Verificação manual mobile e desktop de `/comecar?source=...`.

**Dependencies:** Task 3

**Files likely touched:**

- `apps/api/src/whatsapp-onboarding.ts`
- `apps/api/test/public-signup.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/pages/SignupStart.tsx`
- `apps/web/src/pages/SignupStart.test.tsx`

**Estimated scope:** Medium (5 files)

### Checkpoint B: Acquisition handoff

- [ ] A rota pública abre apenas o número oficial e nunca dispara outbound.
- [ ] Atribuição válida sobrevive no texto; inválida degrada com segurança.
- [ ] `invite_only` continua sendo o padrão e o novo CTA não abre cadastro.
- [ ] API e web passam em testes focados, typecheck e build.

### Phase 3: Core self-serve onboarding

## Task 5: Admitir inbound público sem permitir LLM ou duplicidade

**Description:** Generalizar a admissão do webhook para convite ou intenção
pública, serializar concorrência por telefone e emitir o token web fora do
caminho do assistente.

**Acceptance criteria:**

- [ ] Número novo + frase exata cria uma sessão pública e recebe um único link;
  “Oi”, anexo ou texto diferente fica silencioso e sem LLM.
- [ ] Replay, duas mensagens concorrentes e envelope reutilizado produzem no
  máximo uma sessão/token ativos por telefone.
- [ ] Número já ativo recebe orientação determinística de login/uso e a frase de
  cadastro não chega à LLM; o token de atribuição é redigido da persistência.

**Verification:**

- [ ] Testes de webhook nos três modos, incluindo corrida e replay.
- [ ] Teste comprova zero chamada ao orquestrador para desconhecido/pendente.
- [ ] Inspeção confirma chamada Meta somente depois do commit e locks em ordem
  consistente.

**Dependencies:** Tasks 2–4

**Files likely touched:**

- `apps/api/src/public-signup.ts`
- `apps/api/src/whatsapp-onboarding.ts`
- `apps/api/src/routes/whatsapp.ts`
- `apps/api/test/onboarding-fixture.ts`
- `apps/api/test/whatsapp-verification.test.ts`

**Estimated scope:** Medium (5 files)

## Task 6: Generalizar Auth e promoção para sessões públicas

**Description:** Remover joins obrigatórios com convite na leitura, reserva de
e-mail, lock e consumo, mantendo o mesmo Turnstile, magic link e `POST
/api/providers` para ambas as origens.

**Acceptance criteria:**

- [ ] Uma sessão pública válida completa e cria exatamente um `provider` com
  telefone provado; sessão de convite continua idêntica.
- [ ] `disabled` bloqueia toda continuação; `invite_only` bloqueia sessão pública
  e preserva sessão convidada; `public` aceita ambas.
- [ ] CAPTCHA inválido, e-mail conflitante, token encaminhado/reusado e duas
  finalizações concorrentes falham fechados e sem órfãos indevidos no Auth.

**Verification:**

- [ ] Teste de integração completo para origem pública e convidada.
- [ ] Testes de retenção e compensação de usuário Auth continuam passando.
- [ ] `pnpm --filter @prestou/api test` e typecheck passam.

**Dependencies:** Task 5

**Files likely touched:**

- `apps/api/src/whatsapp-onboarding.ts`
- `apps/api/src/routes/providers.ts`
- `apps/api/test/onboarding-fixture.ts`
- `apps/api/test/whatsapp-verification.test.ts`

**Estimated scope:** Medium (4 files)

### Checkpoint C: Core flow

- [ ] Em staging, um número novo percorre CTA → WhatsApp → link → Turnstile →
  magic link → perfil → conta.
- [ ] Convite administrativo percorre o mesmo backend sem regressão.
- [ ] Nenhum estado pré-ativo acessa LLM ou capacidade financeira.
- [ ] Corridas e replays resultam em no máximo uma conta.
- [ ] Revisão humana do fluxo e dos limites antes de seguir para UX/métricas.

### Phase 4: UX and measurement

## Task 7: Tornar a experiência web neutra à origem

**Description:** Substituir copy específica de convite, expor o caminho
“Começar pelo WhatsApp” no login e cobrir estados públicos de expiração,
indisponibilidade, e-mail enviado e conclusão.

**Acceptance criteria:**

- [ ] Login e onboarding não chamam todo token válido de “convite”.
- [ ] Usuário sem conta encontra `/comecar`; usuário existente continua com
  magic link de login e não entra em onboarding novamente.
- [ ] Fluxo atende teclado, foco, labels e anúncios de erro existentes.

**Verification:**

- [ ] Testes de Login, Onboarding e Auth para conta nova/existente.
- [ ] `pnpm --filter @prestou/web test` e typecheck passam.
- [ ] Verificação em navegador real nos breakpoints mobile e desktop.

**Dependencies:** Task 6

**Files likely touched:**

- `apps/web/src/pages/Login.tsx`
- `apps/web/src/pages/Onboarding.tsx`
- `apps/web/src/auth.tsx`
- `apps/web/src/pages/Login.test.tsx`
- `apps/web/src/pages/Onboarding.test.tsx`

**Estimated scope:** Medium (5 files)

## Task 8: Instrumentar todas as transições do onboarding

**Description:** Gravar eventos idempotentes nos pontos transacionais corretos,
com a mesma `journeyId` e metadados allowlisted para convite e público.

**Acceptance criteria:**

- [ ] As seis etapas são emitidas no máximo uma vez e a criação da conta é
  registrada na mesma transação do `provider`.
- [ ] Convite e público são distinguíveis; abandono mantém eventos sem reter
  telefone/e-mail e expurgo de sessão não apaga o funil.
- [ ] Primeira cobrança é derivável de `cobranca_criada` sem evento duplicado.

**Verification:**

- [ ] Teste de integração compara eventos após sucesso, replay e abandono.
- [ ] Consulta de segurança confirma ausência de PII/tokens em `metadata`.
- [ ] `pnpm --filter @prestou/api test` passa.

**Dependencies:** Tasks 3, 5–6

**Files likely touched:**

- `apps/api/src/analytics.ts`
- `apps/api/src/whatsapp-onboarding.ts`
- `apps/api/src/routes/providers.ts`
- `apps/api/test/whatsapp-verification.test.ts`

**Estimated scope:** Medium (4 files)

## Task 9: Expor o funil agregado para operação

**Description:** Consultar coortes por período/origem, calcular conversão e
abandono e mostrar um resumo no admin sem expor candidatos individuais.

**Acceptance criteria:**

- [ ] Endpoint admin retorna contagens por etapa, taxas entre etapas e primeira
  cobrança, com período máximo e filtros validados.
- [ ] Usuário não administrador recebe `403`; resposta nunca contém PII ou
  conteúdo de mensagem.
- [ ] Painel admin mostra o funil e diferencia `invite`, `public` e
  `direct/unknown`.

**Verification:**

- [ ] Teste de consulta cobre coortes, filtros, denominador zero e autorização.
- [ ] `pnpm --filter @prestou/web exec vitest run src/pages/Admin.test.tsx`
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` em dados de teste usa os índices planejados.

**Dependencies:** Task 8

**Files likely touched:**

- `apps/api/src/signup-analytics.ts`
- `apps/api/src/routes/insights.ts`
- `apps/api/test/signup-analytics.test.ts`
- `apps/web/src/pages/Admin.tsx`
- `apps/web/src/pages/Admin.test.tsx`

**Estimated scope:** Medium (5 files)

### Checkpoint D: UX and observability

- [ ] O funil completo é calculável sem juntar logs manualmente.
- [ ] Totais da API batem com uma consulta SQL independente no ambiente de
  teste.
- [ ] CTA, login, onboarding e admin passam por teste de navegador.
- [ ] Testes, typecheck e build do monorepo passam.

### Phase 5: Hardening and rollout readiness

## Task 10: Fechar segurança e documentação local

**Description:** Executar a revisão STRIDE e documentar a configuração local,
sem habilitar produção. Runbook, validação em staging e rollback foram
removidos explicitamente do escopo nesta iteração.

**Acceptance criteria:**

- [ ] Configuração local e limites estão documentados sem segredos.
- [ ] Verificações automatizadas cobrem o fluxo disponível localmente; staging
  e rollback não fazem parte desta entrega.
- [ ] Changelog/docs atuais do Supabase são revisados, advisors não têm achado
  crítico relevante e auditoria de dependências é triada.

**Verification:**

- [ ] `pnpm --filter @prestou/api test`
- [ ] `pnpm --filter @prestou/web test && pnpm typecheck && pnpm build`
- [ ] `git diff --check` e revisão de secrets.

**Dependencies:** Tasks 1–9

**Files likely touched:**

- `apps/api/.env.example`
- `README.md`
- `docs/whatsapp-operacao.md`
- `specs/fluxo-cadastro-convite-autenticacao-whatsapp.md`
- `specs/plano-cadastro-prestador-whatsapp.md`

**Estimated scope:** Medium (5 files)

### Checkpoint E: Ready for controlled rollout

- [ ] Todos os critérios da spec estão demonstrados por teste ou evidência de
  staging.
- [ ] Convite continua sendo rollback funcional, não apenas flag nominal.
- [ ] Produção permanece em `invite_only`.
- [ ] Responsável operacional, janela e aprovação para ativar `public` são
  definidos separadamente.

## Threat Model

| Boundary / threat | Risk | Control in plan |
| --- | --- | --- |
| Navegador → API pública | payload inflado, spam, atribuição forjada | Zod estrito, limites de tamanho, HMAC, teto global e fallback sem tracking |
| WhatsApp → webhook | spoofing ou replay | assinatura Meta antes do parse, `message_id` único e `wa_id` como prova |
| Número desconhecido → LLM | custo e prompt injection | intenção exata tratada antes do orquestrador; demais entradas silenciosas |
| Duas mensagens simultâneas | duas sessões/tokens | advisory lock por telefone + índices únicos + transação curta |
| Link web encaminhado | tomada da sessão bearer | TTL curto, consumo único, Turnstile, vínculo fixo ao telefone provado e e-mail único |
| Web → criação de provider | telefone adulterado | navegador nunca envia telefone; API usa somente sessão locked |
| Analytics | PII ou cardinalidade hostil | allowlist de campos/valores, nenhum texto/IP/telefone/e-mail, consulta agregada |
| Supabase Auth | usuários provisórios órfãos | criação após CAPTCHA, allowlist de usuários criados e compensação/retenção |
| Kill switch | sessão pública continuar após incidente | modo revalidado em cada etapa; `invite_only` nega origem pública |

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Migração quebrar sessões convidadas existentes | High | migração aditiva, backfill antes de constraints, teste com fixture legada e revisão antes de aplicar |
| Entrada pública amplificar spam/custo Meta | High | usuário inicia conversa, frase exata, limites atômicos, zero LLM e teto inicial de 20 sessões/dia |
| Concorrência sem linha de convite duplicar conta | High | advisory lock transacional por telefone, índices únicos e promoção idempotente |
| Atribuição se perder no salto web → WhatsApp | Medium | envelope assinado dentro da mensagem e `journeyId` persistida na sessão/eventos |
| Token de atribuição ser confundido com autorização | High | módulo e tipos separados; token apenas rotula analytics e inválido degrada para unknown |
| Mudança de modo divergir entre API e frontend | Medium | backend como fonte única consultada em runtime; sem flag Vite paralela |
| Evento duplicado distorcer conversão | Medium | unicidade por jornada/tipo e `ON CONFLICT DO NOTHING` na mesma transação |
| Consulta de funil degradar `events` | Medium | filtros temporais obrigatórios e índices compostos validados com `EXPLAIN` |
| Regressão no recrutamento assistido | High | convite permanece como variante explícita e é testado em cada checkpoint |
| Habilitação prematura em produção | High | plano não altera ambiente; gate final exige aprovação operacional separada |

## Parallelization

Não há autorização para delegar este trabalho a subagentes. Mesmo com execução
paralela futura, as dependências seguras seriam:

- Após Task 3, a UI da Task 4 pode evoluir em paralelo aos testes de contrato,
  desde que o contrato HTTP esteja congelado.
- Após Task 6, Task 7 (UX) e a preparação da consulta da Task 9 podem avançar em
  paralelo; a Task 9 só integra depois dos eventos da Task 8.
- Migração, admissão do inbound e promoção para `provider` devem permanecer
  sequenciais por compartilharem invariantes transacionais.

## Definition of Done

Uma tarefa só é concluída quando:

- seus critérios de aceite têm teste ou evidência manual registrada;
- testes focados passam e não removem cobertura existente;
- typecheck passa para o pacote tocado;
- nenhuma mudança fora do escopo aparece no diff;
- entradas externas são validadas e queries são parametrizadas;
- nenhuma credencial/PII nova aparece em logs, eventos ou fixtures;
- documentação e spec são atualizadas se a decisão mudou.

O incremento inteiro só é concluído quando `pnpm test`, `pnpm typecheck` e
`pnpm build` passam, a migração é validada em Supabase de teste, o smoke test de
staging passa e o usuário aprova o resultado.

## Open Questions

Não há pergunta de produto bloqueando a implementação. Antes do rollout real,
será necessário definir o responsável operacional e aprovar explicitamente a
mudança de `WHATSAPP_SIGNUP_MODE=invite_only` para `public` em produção.

## Gate for Next Phase

Este plano ainda não autoriza implementação. Após aprovação humana, criar
`tasks/todo.md` com as dez tarefas e suas verificações. Só depois da aprovação
do checklist iniciar Task 1, seguindo implementação incremental e TDD.
