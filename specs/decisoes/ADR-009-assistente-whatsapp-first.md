---
title: "ADR-009 — Assistente do prestador no WhatsApp (WhatsApp-first)"
created: 2026-07-22
status: aceita
tags:
  - prestou
  - spec
  - arquitetura
  - adr
  - assistente
  - whatsapp
  - openai
relacionado:
  - "[[ADR-008 - Assistente conversacional híbrido]]"
  - "[[ADR-010 - Memória de preenchimento de cobrança (slot-filling)]]"
  - "[[ADR-001 - Arquitetura híbrida Supabase + Railway]]"
  - "[[ADR-002 - Autenticação por magic link]]"
  - "[[Protocolo de confirmação de ações do assistente]]"
  - "[[Prestou - Interpretador em Linguagem Natural]]"
  - "[[Prestou - MVP]]"
---

# ADR-009 — Assistente do prestador no WhatsApp (WhatsApp-first)

## Decisão

Evoluir o assistente do prestador para o **WhatsApp bidirecional**, mantendo o
Dashboard como painel visual. O assistente conversacional passa a ter **um único
cérebro** — um orquestrador de intenções agnóstico de canal — servido por **duas
portas de entrada**: a HTTP autenticada por JWT (Dashboard, também usada como
banco de testes local) e o WhatsApp inbound (foco deste ciclo).

O provedor de LLM permanece **OpenAI `gpt-5.4-nano`** via Responses API, com as
mesmas garantias do [[ADR-008 - Assistente conversacional híbrido]]: o modelo
interpreta a intenção e extrai argumentos, mas **não consulta o banco, não gera
BR Code, não manipula a chave Pix e não executa ações financeiras**. A API
Fastify continua sendo a fonte da verdade e a autoridade de autorização.

Ações de escrita continuam passando pelo protocolo de propostas persistidas
([[Protocolo de confirmação de ações do assistente]]). No WhatsApp, a confirmação
é um **botão interativo** cujo identificador é o `proposalId`.

> **Registro de direção.** Esta decisão vai na direção oposta à recomendação do
> [[ADR-008 - Assistente conversacional híbrido]] e do
> [[Prestou - Interpretador em Linguagem Natural]] (§5), que pedem validar
> primeiro no Dashboard (Opção A) e só depois promover ao WhatsApp inbound
> (Opção B). O inbound transforma a WABA de **unidirecional → bidirecional**
> (webhook, janela de 24h, sessão, mais QA e custo por mensagem). Optou-se pelo
> WhatsApp-first, isolando a lógica num orquestrador agnóstico de canal para que
> o Dashboard continue funcionando com o mesmo motor e um eventual recuo custe
> pouco.

## Contexto

O Prestou já tem um assistente **single-shot** no Dashboard
(`POST /api/assistant/interpret`, `gpt-5.4-nano`, ferramenta única
`preparar_cobranca` → devolve rascunho e o prestador revisa no formulário
`/nova`). O [[Protocolo de confirmação de ações do assistente]] está
implementado, porém habilitado somente para `marcar_pago_manual` e disparado a
partir da tela de detalhe da cobrança, não do assistente.

Hoje **toda** a segurança depende do JWT do Supabase + `session_id`
(`requireProvider`), inclusive o escopo das propostas
(`assistant_action_proposals` é `provider_id` + `session_id`). **Uma mensagem de
WhatsApp não tem JWT.** Este é o problema central que o WhatsApp-first precisa
resolver.

Além disso, sem o formulário do Dashboard como tela de revisão, **criar cobrança
precisa entrar no protocolo de propostas** — trabalho de ação-de-escrita que o
caminho Dashboard não exigiria. Esse é o custo real da decisão.

## Objetivos

- Atender o prestador por WhatsApp: criar cobrança, consultar quem não pagou,
  status de cliente, resumo financeiro e marcar pago manual.
- Manter o Dashboard funcionando com o **mesmo orquestrador**, sem regressão.
- Preservar o JWT como identidade do Dashboard — o número de WhatsApp é
  identidade apenas na borda do webhook.
- Manter todas as garantias financeiras (propostas persistidas, idempotência,
  expiração, uso único, `paga` terminal).
- Manter custo e latência adequados ao piloto; nenhum dado financeiro ao modelo.
- Permitir testar o cérebro localmente **sem** depender do WhatsApp.

## Fora do escopo desta etapa

- Áudio / transcrição (V2; o adapter de modelo deixa pronto).
- Envio automático de mensagens ao **cliente final** (V2 — MVP mantém "prepara o
  link, prestador envia").
- Agenda / reagendamento em lote (V2 — sem endpoint, nada a interpretar).
- Contestar ou reabrir cobrança pelo chat (só após validar o protocolo na nova
  interface).
- Persistência de conversa / memória entre sessões (exigiria retenção, base
  legal e migration; desnecessário para validar).

## Arquitetura proposta

### Orquestrador agnóstico de canal

Extrair a lógica hoje inline em `apps/api/src/assistant.ts` para um orquestrador
fino:

```
entrada (texto) + identidade do prestador (providerId) + estado parcial
   → LLM tool calling (OpenAI Responses API, gpt-5.4-nano)
   → guardrails + resolução determinística de cliente (backend)
   → leitura direta na API  OU  proposta persistida p/ ação de escrita
   → resposta estruturada (união discriminada)
```

`interpretMessage({ providerId, message, partialDraft? }) → AssistantResult`. O
orquestrador **não conhece** o transporte nem o JWT: recebe o `providerId` já
resolvido. Quem resolve é o **adaptador de canal**.

### Duas portas de entrada, um cérebro

| Caminho | Auth do request | Derivação do `providerId` | Renderização |
|---|---|---|---|
| **Dashboard / HTTP** | JWT do Supabase (igual hoje) | `requireProvider` → `auth_user_id` → provider | cards React |
| **WhatsApp inbound** | **Assinatura da Meta** (`X-Hub-Signature-256` + verify token) | número verificado → provider (no servidor) | texto / botões |

O número **não substitui** o JWT. A assinatura da Meta é o "auth" do webhook —
impede requests forjados; o número apenas identifica *qual* prestador é, depois
de a origem estar provada. O banco **nunca** confia em `provider_id` externo em
nenhum dos caminhos.

### Identidade, sessão e confirmação no WhatsApp

1. **Número verificado.** O prestador cadastra o próprio WhatsApp em Settings e
   confirma via código enviado pelo canal outbound existente. Só números
   vinculados e verificados são atendidos; desconhecido → ignorado.
2. **Sessão de canal.** Generalizar o escopo da proposta de `session_id` para
   `(channel, channel_session)`. O Dashboard continua usando o `session_id` do
   JWT como seu `channel_session`; o WhatsApp usa o identificador do número. A
   janela de 24h da Cloud API delimita a sessão do WhatsApp.
3. **Confirmação por botão.** O "sim" vira um botão interativo cujo `id` é o
   `proposalId`, satisfazendo o guardrail "o 'sim' aponta para uma proposta
   específica". Para `marcar_pago_manual` (maior risco, `paga` terminal e
   irreversível), o botão é **obrigatório** — "sim" solto não é aceito.

### Mapa de capacidades

| Intenção | Ferramenta (LLM) | Backend | Escrita? |
|---|---|---|---|
| Criar cobrança | `preparar_cobranca` | `POST /api/charges` via executor de proposta | Sim |
| Quem me deve / atrasados | `listar_inadimplentes` | `GET /api/charges?status=atrasada`/`em_aberto` | Não |
| Status de cliente | `status_cliente` | `GET /api/charges?clientId=` | Não |
| Resumo / a receber | `resumo_financeiro` | `GET /api/financial-summary` / `/api/insights/funnel` | Não |
| Marcar pago manual | `marcar_pago_manual` | protocolo de propostas | Sim |
| Reenviar cobrança | `reenviar_cobranca` | devolve `wa.me` pronto (envio manual — MVP) | Não |
| Não suportado | `pedido_nao_suportado` | responde escopo + atalhos | Não |

**Resolução de referência** ("o João", "a lavagem de hoje"): o LLM não adivinha
ids. O backend injeta candidatos (`GET /api/clients`) e, em ambiguidade, o
assistente pergunta — reusa `buildDraft()`/`matchingClients`. **"O Pedro
pagou?" não é conciliação bancária:** sem PSP no MVP, a resposta reflete o
estado da cobrança e deve dizer isso explicitamente.

### Buscar quem não pagou (dois lugares)

- **WhatsApp** — `listar_inadimplentes` consulta `status=atrasada` (e
  opcionalmente `em_aberto`) do prestador da identidade de canal, calcula total
  e formata a mensagem (nome · valor · venceu em dd/mm), com limite + "e mais N".
- **Dashboard** — adicionar um campo de busca por nome de cliente consultando
  `GET /api/charges` server-side (que já suporta `clientId`/`status`/`from`/`to`),
  em vez do filtro client-side atual.

> **Pré-requisito de correção.** "atrasada" depende de "hoje". O assistente usa
> `America/Sao_Paulo`, mas `charges`, `financial-summary` e `reminders` usam
> `todayISO()` em **UTC** (`apps/api/src/state.ts`). Corrigir para o fuso de São
> Paulo **antes** de expor a busca de inadimplentes.

### LLM e privacidade

OpenAI `gpt-5.4-nano` via Responses API (`store:false`, `tool_choice:"required"`,
`parallel_tool_calls:false`, `safety_identifier` = hash do provider). Nenhum dado
de cliente ou financeiro vai ao modelo; a lista de clientes fica no backend e a
resolução é determinística. Manter a chamada isolada atrás de uma interface
`LlmProvider.interpret()` para troca futura (adapter hoje é inline).

## Plano de implementação

### Fase 1 — cérebro + leitura (testável sem WhatsApp)

1. Extrair o orquestrador de `apps/api/src/assistant.ts`
   (`interpretMessage({ providerId, message, partialDraft? })`).
2. Porta de teste HTTP `POST /api/assistant/chat` (auth `requireProvider`) que
   roda o orquestrador completo com OpenAI real — banco de testes local sem
   WhatsApp; `/api/assistant/interpret` vira um caso particular.
3. Ferramentas de leitura: `listar_inadimplentes`, `status_cliente`,
   `resumo_financeiro`, `pedido_nao_suportado`, escopadas pelo `providerId`.
4. Corrigir `todayISO()` → `America/Sao_Paulo`, com testes.
5. Dashboard: campo de busca por nome consultando `GET /api/charges`
   server-side; `AssistantCommand` passa a chamar o novo orquestrador.
6. **Passo final** — adaptador WhatsApp: vínculo/verificação de número
   (Settings), webhook `POST /api/whatsapp/webhook` (verify token + assinatura
   Meta) resolvendo provider por número e chamando o mesmo orquestrador, e
   renderizador `AssistantResult → texto/interactive`. Gate por `WHATSAPP_MODE`
   (em `log`, inbound simulado).

### Fase 2 — escrita pelo WhatsApp

Impacto no `marcar_pago_manual` — **não muda**: `executeMarkPaid`, a transição
`em_aberto → paga`, `SELECT ... FOR UPDATE`, expiração de 5 min, uso único,
idempotência e o guard `428`. **Muda:** (1) generalizar o escopo da proposta de
`provider_id`+`session_id` para `(channel, channel_session)` sem regredir o fluxo
disparado por `ChargeDetail.tsx`; (2) o gatilho da confirmação vira botão
interativo (`id=proposalId`).

Habilitar `criar_cobranca` no protocolo: novo executor de proposta chamando
`POST /api/charges`, `summary` montado de dados validados, confirmação por botão,
multi-turno preservando rascunho parcial (entrada não confiável). Testes de
idempotência, expiração, uso único, isolamento entre prestadores e entre sessões
de canal, e **regressão do fluxo de marcar-pago do Dashboard**.

### Fase 3 — piloto

20–50 frases reais antes de expor aos 10. Métricas do [[ADR-008 - Assistente
conversacional híbrido]]: % que chega ao rascunho, mensagens até o rascunho,
tempo até criação confirmada, sucesso das consultas de atrasadas, intenções não
suportadas frequentes, latência/erro por intenção, custo de tokens/conversa. Sem
armazenar texto integral nem dados identificáveis.

## Arquivos-chave

- Backend: `apps/api/src/assistant.ts` (extrair), novo `orchestrator.ts` +
  `channels/whatsapp.ts`, `apps/api/src/routes/{assistant,whatsapp,charges,action-proposals}.ts`,
  `apps/api/src/{state,config,auth,reminders}.ts` (fuso), migration de vínculo de
  número e generalização de `assistant_action_proposals`.
- Frontend: `apps/web/src/pages/{Dashboard,Settings}.tsx`, `apps/web/src/api.ts`.

## Alternativas consideradas

- **Dashboard-first (Opção A do Interpretador §5).** Menor risco na WABA; valida
  a hipótese sem webhook nem janela de 24h. Recusada em favor da visão "o
  prestador vive no WhatsApp", mas o orquestrador agnóstico mantém o recuo barato.
- **Número do WhatsApp como identidade global (sem JWT no Dashboard).**
  Rejeitada — o número não é um segredo e o Dashboard já tem JWT robusto; o número
  vale só na borda do webhook, atrás da assinatura da Meta.
- **Aceitar "sim" textual para confirmar ações.** Rejeitada para ações de
  escrita de alto risco; o botão com `id=proposalId` elimina ambiguidade.
- **Migrar para Claude Haiku** (recomendação do Interpretador §7). Adiada — o
  código já usa OpenAI; o adapter mantém a troca futura barata.

## Consequências

- Assistente e Dashboard passam a compartilhar um orquestrador; novas intenções
  exigem contrato, autorização, resposta e testes próprios.
- O backend ganha um adaptador de canal WhatsApp (webhook, identidade por número,
  renderizador) e um serviço de verificação de número.
- O protocolo de propostas passa a ser escopado por `(channel, channel_session)`,
  habilitando ações de escrita fora do JWT sem afrouxar as garantias.
- Surge dependência operacional da WABA bidirecional (assinatura, janela de 24h,
  custo por mensagem a partir de out/2026) — a ser medida no piloto.

## Riscos e questões em aberto

- **Segurança do inbound**: assinatura da Meta e vínculo de número são a
  superfície crítica; número não verificado nunca é atendido.
- **Assistente do Dashboard**: ~~manter ativo para o prestador (recomendado) ou
  rebaixar a ferramenta interna de dev~~ — **decidido (2026-07-22): manter ativo
  para o prestador.** A porta `POST /api/assistant/chat` serve tanto o prestador
  quanto o banco de testes local do orquestrador; ambos usam o mesmo cérebro.
- **Divergência documental**: existem dois "ADR-008" (vault "Propostas
  persistidas para ações financeiras" vs repo "Assistente conversacional
  híbrido") — reconciliar numeração/títulos.
- **LGPD**: registrar no consentimento que há assistente processando texto; nada
  de comprovante ou chave Pix ao modelo; logs só de intenção, resultado,
  latência e erro.

## Estado implementado até 2026-07-23

- Orquestrador agnóstico de canal compartilhado por Dashboard e WhatsApp.
- Settings exibe o estado atual do número, permite enviar ou reenviar o código,
  confirmar os 6 dígitos e trocar o número, preservando os erros específicos da
  API. O fluxo tem cobertura frontend focada em estado verificado, sucesso
  completo e nova tentativa após erro de confirmação.
- Webhook GET/POST com verify token e assinatura HMAC da Meta.
- Identidade por número vinculado e verificado, incluindo equivalência do nono
  dígito brasileiro.
- WABA de teste inscrita no app e fluxo bidirecional validado.
- Token sem expiração de usuário do sistema com permissão mínima de mensagens.
- Proposta de cobrança específica do canal, com expiração de 10 minutos,
  cancelamento, lock transacional, uso único e idempotência.
- Botões **Criar cobrança / Cancelar** e criação pelo mesmo serviço usado pelo
  Dashboard, sem mudança no fluxo de criação HTTP existente.
- Guardrail persistente antes da OpenAI: deduplicação, limites por prestador,
  circuit breaker global, tamanho máximo, lease de concorrência, sequência de
  pedidos inválidos e cooldown.
- Dados do guardrail no schema `private`, sem texto integral e sem acesso por
  `anon` ou `authenticated`.

O desenho final manteve `whatsapp_charge_proposals` separado das propostas de
ação do Dashboard. Essa escolha evitou generalizar o protocolo existente antes
de haver uma segunda ação compartilhada; `marcar_pago_manual` pelo WhatsApp
permanece fora do escopo implementado.

O runbook operacional e a configuração vigente estão em
[`docs/whatsapp-operacao.md`](../../docs/whatsapp-operacao.md).
