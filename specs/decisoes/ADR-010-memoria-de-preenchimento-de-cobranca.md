---
title: "ADR-010 — Memória de preenchimento de cobrança (slot-filling)"
created: 2026-07-22
status: aceita
tags:
  - prestou
  - spec
  - arquitetura
  - adr
  - assistente
  - whatsapp
relacionado:
  - "[[ADR-009 - Assistente do prestador no WhatsApp (WhatsApp-first)]]"
  - "[[ADR-008 - Assistente conversacional híbrido]]"
  - "[[Protocolo de confirmação de ações do assistente]]"
  - "[[Prestou - Interpretador em Linguagem Natural]]"
---

# ADR-010 — Memória de preenchimento de cobrança (slot-filling)

## Decisão

Dar ao orquestrador uma **memória de curta duração do preenchimento de cobrança**,
por prestador, para que uma cobrança iniciada em uma mensagem e completada na
seguinte **retome o contexto** em vez de recomeçar do zero.

A memória é implementada como **slot-filling determinístico no backend**: quando
`preparar_cobranca` volta como `clarification` (falta algum dado), o backend
**persiste o rascunho parcial** — só os campos já extraídos. Na mensagem seguinte,
o backend **mescla** o que o modelo extraiu com o parcial guardado antes de
resolver o rascunho.

O modelo **continua stateless e sem receber nenhum dado**: recebe uma mensagem por
vez, sem histórico de conversa. Todo o merge acontece no backend, mantendo a
fronteira de privacidade do [[ADR-009 - Assistente do prestador no WhatsApp (WhatsApp-first)]]
e do [[ADR-008 - Assistente conversacional híbrido]].

Decisão aprovada por Fonseca em 22 de julho de 2026.

## Contexto

O interpretador era **stateless por mensagem**: `interpretMessage` recebia apenas
o texto atual e o repassava ao modelo como uma única mensagem de usuário, sem
histórico. Fluxo real que motivou a decisão:

1. Prestador: *"cria uma cobrança para o Joaquim, de 89 reais, serviço de
   vidraçaria"* → cliente novo, sem WhatsApp cadastrado → o assistente pede o
   telefone.
2. Prestador: *"+55 41 997888888"* → o modelo vê **só** esse texto isolado,
   extrai o telefone e devolve `null` para nome, serviço e valor → o assistente
   pede tudo de novo.

O contexto da mensagem anterior nunca chegava ao modelo. Não era falha de prompt,
e sim ausência de estado conversacional.

## Alternativas consideradas

- **A — Slot-filling determinístico (escolhida).** Persistir o rascunho parcial
  com TTL curto e mesclar no backend. Modelo continua vendo uma mensagem por vez;
  zero dado extra ao modelo. Previsível, barato, testável; escopo limitado à
  cobrança.
- **B — Histórico de conversa ao LLM.** Persistir as últimas N mensagens e
  enviá-las como `input` na Responses API. Mais robusto e geral (cobre também as
  intenções de leitura e ruído como *"a mãe dele é bem legal"*), mas manda mais
  contexto — inclusive dados que o prestador digitou — ao modelo e tem superfície
  maior. **Recusada** por furar a fronteira de privacidade e por peso
  desproporcional ao problema.
- **C — Biblioteca de orquestração (LangChain/LangGraph).** As abstrações de
  memória guardam *buffer de conversa*, não slot-filling de domínio com validação
  Zod — o merge e a validação continuariam sendo escritos à mão, agora acoplados
  a uma API externa que muda com frequência, invertendo o controle do "cérebro"
  como função pura. **Recusada** para este escopo; LangGraph só se justificaria se
  fôssemos para a Opção B / um agente multi-turno com muitas ferramentas.

## Consequências

- Nova tabela `whatsapp_pending_charges`: **um rascunho parcial por prestador**
  (PK em `provider_id`), `partial jsonb`, `expires_at` com **TTL de 10 minutos**
  (alinhado ao `whatsapp_charge_proposals`), RLS ligada e sem acesso a
  `anon`/`authenticated`.
- `interpretMessage` ganha uma dependência **opcional** `memory: ChargeMemory`.
  Sem ela, o comportamento é idêntico ao anterior — por isso o assistente
  single-shot do Dashboard (`POST /api/assistant/interpret`) e os testes antigos
  não mudam.
- As duas portas do orquestrador completo passam a memória real (`dbChargeMemory`):
  o WhatsApp inbound e `POST /api/assistant/chat`.
- **Troca de assunto encerra o preenchimento.** Qualquer intenção que não seja
  `preparar_cobranca` limpa o parcial, para que ele não vaze para uma cobrança
  futura. O TTL é apenas a rede de segurança.
- **Cliente diferente = outra cobrança.** Se a mensagem cita um nome de cliente
  diferente do rascunho pendente, o merge descarta o pendente em vez de misturar.
- Rascunho concluído (vira `draft`) ou erro de campo limpam o parcial.

## Regras de merge

- Cada campo novo (não-nulo) sobrescreve o do parcial; campo ausente (nulo) herda
  do parcial.
- Nome de cliente divergente descarta o parcial e trata a mensagem como cobrança
  nova.
- O que se persiste é o **parcial pré-default** (ex.: `dueDate` nulo permanece
  nulo; o vencimento padrão só é aplicado na resolução do rascunho).

## Segurança e privacidade

- O modelo **não** recebe o rascunho parcial nem histórico de conversa; o merge é
  100% backend, coerente com [[ADR-009 - Assistente do prestador no WhatsApp (WhatsApp-first)]].
- Estado escopado por `provider_id`, resolvido na borda (JWT no Dashboard, número
  verificado no WhatsApp) — nunca por identidade enviada pelo cliente.
- TTL curto e limpeza por troca de assunto minimizam a janela em que dados de uma
  cobrança inacabada ficam retidos.

## Limitação conhecida

Inerente ao slot-filling (era o trade-off ante a Opção B): dentro de uma mesma
cobrança em andamento, uma correção **parcial** que omite um campo já preenchido
mantém o valor anterior desse campo. É o comportamento esperado de preenchimento
incremental; TTL, descarte por troca de assunto e descarte por nome de cliente
divergente cobrem os casos ruins. Se esse limite incomodar na prática, o caminho
é promover para a Opção B (histórico ao LLM), isolada atrás da porta `ChargeMemory`.

## Critérios de aceite

- Iniciar a cobrança faltando o WhatsApp e, na mensagem seguinte, enviar só o
  telefone conclui o rascunho sem repetir cliente, serviço e valor.
- Trocar de assunto no meio do preenchimento (ex.: *"quem me deve?"*) descarta o
  parcial; uma cobrança posterior começa limpa.
- Citar outro cliente na mensagem seguinte trata como cobrança nova, sem herdar
  dados da anterior.
- Sem `memory`, `interpretMessage` mantém o comportamento single-shot anterior.
- O parcial expira sozinho após o TTL.
