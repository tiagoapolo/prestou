---
title: "Avaliação — Cadastro do prestador pelo WhatsApp vs. login pelo dashboard"
created: 2026-07-23
status: descoberta
tags:
  - prestou
  - produto
  - onboarding
  - whatsapp
  - autenticacao
---

# Avaliação — Cadastro do prestador pelo WhatsApp vs. login pelo dashboard

## Pergunta

Vale a pena implementar o cadastro do prestador pelo WhatsApp em vez de exigir
login pela plataforma do dashboard?

## O que já existe hoje

- Auth por **magic link (e-mail)** via Supabase; `provider.auth_user_id` +
  `email` são a identidade.
- Assistente **bidirecional no WhatsApp** já em produção (Meta Cloud API,
  webhook, classificação de intenção por LLM, slot-filling).
- Tabela `provider_whatsapp_numbers` com verificação de número — mas com uma
  decisão de design deliberada, registrada no próprio código
  (`apps/api/src/routes/whatsapp.ts`):

  > "Só um número verificado é atendido pelo inbound; a autoridade continua
  > sendo o JWT."

Ou seja: hoje o WhatsApp é um **canal vinculado a uma identidade que nasce no
dashboard**, não uma fonte de identidade. A pergunta, no fundo, é: vale inverter
isso?

## Recomendação: não substituir — fazer um híbrido "WhatsApp-first, web-confirm"

Trocar o login do dashboard por cadastro 100% via WhatsApp é **alto esforço +
alto risco** por três motivos concretos ao caso do Prestou:

1. **Retrabalho no modelo de identidade.** Se o WhatsApp vira o provedor de
   identidade, a mesma pessoa ainda precisa entrar no dashboard depois. Isso
   exige auth por telefone (OTP) na web também, ou linking de conta — dois
   sistemas de identidade convivendo. O design atual evitou isso de propósito.

2. **A chave Pix é o campo mais perigoso de coletar em chat.** É para onde o
   dinheiro vai. Capturar/confirmar chave Pix em texto livre no WhatsApp tem
   risco real de erro de digitação → dinheiro na conta errada. Um formulário com
   validação e tela de confirmação visível é muito mais seguro.

3. **O dashboard não vai desaparecer.** Todo o roadmap do painel financeiro
   (fechamento mensal, comprovantes, notas fiscais, export) precisa de uma
   superfície web. Cadastro por WhatsApp **não elimina** o auth do dashboard —
   ele **adiciona** um segundo caminho de onboarding.

### O sweet spot

Deixar o prestador **começar** pelo WhatsApp (onde o público já vive) e
**terminar o sensível** na web:

- No WhatsApp, aproveitar o slot-filling existente → capturar nome, profissão e
  verificar o número (já implementado).
- Enviar um **deep link / magic link** para uma tela única web onde ele confirma
  a **chave Pix** (com validação) e dá o **consentimento LGPD** explícito
  (`consent_at` tem peso jurídico).

Isso corta a fricção onde ela dói de verdade (descoberta + ativação), reutiliza
a infra de intenção/slot-filling, e **não mexe** no modelo de autoridade nem
expõe a chave Pix a erro de chat. Esforço médio, risco baixo.

### O telefone chega validado "de graça"

Ponto central do híbrido, e o que o torna barato: **a validação do número não é
um passo extra — ela acontece como subproduto do início pelo WhatsApp.**

Quando o prestador manda a primeira mensagem (fluxo user-initiated), a Meta
Cloud API entrega o `wa_id` do remetente já autenticado pela própria Meta. O
número está provado pelo simples fato de a mensagem ter chegado daquele
aparelho — não é preciso enviar um código OTP e pedir que ele digite de volta.

Consequências práticas:

- **Nada de OTP na entrada.** O passo web de confirmação (chave Pix +
  consentimento) não precisa reverificar o telefone; ele já vem validado.
- **O deep link carrega o número provado.** Gerar o link amarrado ao `wa_id`
  verificado da conversa, com token de uso único e curta validade. Ao abrir a
  tela web, a sessão já sabe qual telefone é — o prestador só confirma o
  sensível.
- **Reaproveita a tabela existente.** É o mesmo mecanismo de
  `provider_whatsapp_numbers`, só que a verificação passa a ser feita **na
  criação da conta** (por ter mensageado primeiro), em vez de depois, nas
  Settings. Grava-se `verified_at` no momento do vínculo.
- **Base pronta para a aposta de longo prazo.** Com o número já validado e
  ligado à conta desde o cadastro, migrar depois a identidade da web para
  telefone (Supabase phone auth) fica natural — o âncora já existe.

O único cuidado é o inverso: **não confiar no número apenas porque a mensagem
chegou, sem amarrá-lo a um token de uso único no deep link.** A prova de posse
do telefone vem do inbound; a prova de que quem abriu a tela web é a mesma
pessoa vem do token. Os dois juntos.

## Sobre o "vale a pena agora"

O Prestou está em **piloto assistido com poucos prestadores** e em fase de
descoberta do módulo financeiro. Dois pontos:

- Nessa escala, o ROI de construir um fluxo completo de signup por WhatsApp é
  baixo — dá para onboardar os pilotos manualmente. Construir isso quando a
  fricção de onboarding for uma **queda medida** (drop-off no magic link), não
  uma hipótese.
- O próprio plano do painel financeiro já lista a pergunta que decide isso:
  "O Financeiro será usado principalmente no site ou também pelo WhatsApp?"
  (pergunta 18). A resposta das entrevistas da Fase 0 é o gatilho certo para
  decidir se o telefone deve virar a identidade âncora de longo prazo.

## Resumo

O magic link por e-mail é provavelmente a maior fricção real (público de
prestador quase não usa e-mail no Brasil), e vale atacar. Mas atacar com o
híbrido acima, não substituindo o dashboard. A aposta grande — telefone como
identidade única nas duas superfícies (Supabase phone auth) — só depois que a
Fase 0 confirmar que o público é WhatsApp-native.

## Próximos passos quando o tema for retomado

1. Medir o drop-off real do magic link no piloto antes de investir.
2. Nas entrevistas da Fase 0, responder à pergunta de canal (site vs. WhatsApp).
3. Se confirmar a fricção, especificar o híbrido: estados do slot-filling de
   onboarding + a tela web única de confirmação (chave Pix + consentimento).
4. Só então avaliar a migração de identidade para telefone (Supabase phone
   auth) como aposta de longo prazo.

---

# Plano técnico — unificação do número de WhatsApp

## Motivação

Hoje existem **dois números** por prestador, e eles podem divergir:

- `providers.whatsapp` — capturado no onboarding, editável por `UPDATE` direto
  nas Settings (`apps/api/src/routes/providers.ts:190`), **sem validação**. É o
  destino de **todas** as notificações (`apps/api/src/notify.ts:126`).
- `provider_whatsapp_numbers.phone_e164` — verificado por OTP, usado para
  **liberar o inbound** (`apps/api/src/routes/whatsapp.ts:306`).

Isso gera dois defeitos concretos:

1. **O OTP não prova o número que diz provar.** O código de verificação do
   `phone_e164` é entregue em `providers.whatsapp`
   (`apps/api/src/notify.ts:126`), não no número candidato. Se os dois diferem,
   confirmar o código prova posse do número **antigo**, e `verified_at` é gravado
   mesmo assim.
2. **O inbound responde no número errado.** O prestador é resolvido pelo
   `phone_e164` verificado, mas a resposta vai para `provider.whatsapp`
   (`apps/api/src/routes/whatsapp.ts:317`). Se divergem, o assistente responde
   num número diferente do que enviou a mensagem.

Unificar em **um número canônico, que só vira canônico depois de provado**,
resolve os dois de uma vez.

## Estado-alvo

- `providers.whatsapp` é a **fonte única da verdade**: destino das notificações
  **e** chave de resolução do inbound.
- `providers.whatsapp_verified_at` marca se está provado.
- Toda troca de número passa por OTP **enviado ao número novo**; até confirmar, o
  número antigo continua valendo.
- `provider_whatsapp_numbers` deixa de existir; seu papel transitório
  (candidato + código + expiração) vai para uma tabela `whatsapp_verifications`.

## Schema (migração)

```sql
-- 1. Coluna de verificação no número canônico.
alter table public.providers
  add column whatsapp_verified_at timestamptz;

-- 2. Backfill: o número PROVADO hoje é o phone_e164 verificado; ele vira o
--    canônico. Quem não tem número verificado fica com whatsapp legado e
--    verified_at nulo (não-provado).
update public.providers pr
   set whatsapp = wn.phone_e164,
       whatsapp_verified_at = wn.verified_at
  from public.provider_whatsapp_numbers wn
 where wn.provider_id = pr.id
   and wn.verified_at is not null;

-- 3. Unicidade só entre números PROVADOS (não quebra em legados duplicados
--    ainda não verificados). Mantém a regra "um número verificado -> uma conta".
create unique index uq_providers_whatsapp_verified
  on public.providers (whatsapp)
  where whatsapp_verified_at is not null;

-- 4. Estado transitório de verificação pendente (1:1 com o prestador).
create table public.whatsapp_verifications (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  candidate_phone text not null,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_verifications enable row level security;
revoke all on public.whatsapp_verifications from anon, authenticated;

-- 5. Remover a tabela antiga só depois de o código novo estar no ar
--    (ver "Rollout"). Em piloto pequeno, pode ir na mesma migração.
drop table public.provider_whatsapp_numbers;
```

## Mudanças no código

### `notify.ts` — permitir destino explícito (a correção do bug)

- Adicionar `to?: string` a `NotifyInput`.
- Em `sendViaCloudApi`, usar `input.to ?? input.provider.whatsapp`
  (`apps/api/src/notify.ts:126`).
- A verificação passa o **número candidato** como `to`. Nenhum outro caller muda.

### `POST /api/whatsapp/number/start`

- Recebe o telefone candidato (schema atual `startSchema`).
- Rejeita (409) se o candidato já é o `providers.whatsapp` **verificado** de
  outra conta.
- Upsert em `whatsapp_verifications` (candidato + código de 6 dígitos + TTL de
  10 min) — mantém `VERIFICATION_TTL_MINUTES`.
- Envia o OTP **para o candidato** (`notifyProvider({ ..., to: candidate })`).

### `POST /api/whatsapp/number/confirm`

- Valida código e expiração contra `whatsapp_verifications`.
- Em sucesso, numa transação:
  `UPDATE providers SET whatsapp = candidate, whatsapp_verified_at = now()` e
  `DELETE FROM whatsapp_verifications WHERE provider_id = ?`.
- Tratar violação do índice único (candidato tomado nesse meio-tempo) → 409.

### `GET /api/whatsapp/number`

- Retornar `providers.whatsapp`, `verified = whatsapp_verified_at is not null`, e
  o `candidate_phone` pendente (se houver), para a UI mostrar "verificação em
  andamento".

### `providers.ts` — Settings deixa de editar o número direto

- Remover `whatsapp` do `UPDATE` de Settings
  (`apps/api/src/routes/providers.ts:190`): número só muda via start/confirm.
  `pix_key`, `default_due_days` etc. continuam ali.

### Inbound gating — resolver pelo número canônico

- Trocar o JOIN em `provider_whatsapp_numbers`
  (`apps/api/src/routes/whatsapp.ts:306`) por:

  ```sql
  SELECT * FROM providers
   WHERE whatsapp IN (?, ?) AND whatsapp_verified_at IS NOT NULL
  ```

- Com isso, a resposta em `apps/api/src/routes/whatsapp.ts:317`
  (`toE164(provider.whatsapp)`) passa a ser, por construção, o mesmo número que
  mandou a mensagem — divergência deixa de ser possível.

### Onboarding — nasce verificado

- **Onboarding web:** rodar o passo de verificação (reusar start/confirm) como
  parte do signup; `whatsapp_verified_at` só é gravado após o confirm.
- **Cadastro-por-WhatsApp (híbrido):** gravar `whatsapp_verified_at` a partir do
  `wa_id` autenticado do inbound — a prova vem de graça, sem OTP.
- **Legados do piloto:** já resolvidos pelo backfill.

## Concorrência e casos de borda

- Unicidade **parcial** (só verificados) evita quebrar em números legados
  não-provados duplicados e reproduz a semântica do índice atual
  (`idx_provider_whatsapp_numbers_verified`).
- A promoção no confirm confia no índice único como árbitro final; capturar a
  violação em vez de checar-e-depois-gravar.
- `whatsappIdentityCandidates` (com/sem o 9º dígito) continua igual — a query de
  inbound segue usando `IN (?, ?)`.

## Rollout

Para o piloto (poucos prestadores), uma migração única + um deploy resolve.
Se quiser zero downtime:

1. Deploy A: adicionar coluna/índice/tabela, backfill, e trocar o código para
   **ler/gravar** em `providers` (mantendo `provider_whatsapp_numbers` só como
   leitura morta).
2. Deploy B: `DROP TABLE provider_whatsapp_numbers`.
