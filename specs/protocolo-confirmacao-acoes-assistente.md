---
title: "Protocolo de confirmação de ações do assistente"
created: 2026-07-21
status: implementada para marcar_pago_manual
tags:
  - prestou
  - assistente
  - segurança
---

# Protocolo de confirmação de ações do assistente

`paga` é um estado terminal. Por isso, `marcar_pago_manual` é uma ação de alto
risco e nunca pode ser executada diretamente pelo assistente.

## Garantias

- O modelo propõe a ferramenta e os argumentos. Ele também pode propor valores
  monetários a partir da mensagem do prestador.
- Zod valida o formato e os limites dos argumentos; isso não garante que o
  cliente, a cobrança ou o valor interpretados pelo modelo estejam corretos.
- O backend resolve o pagamento dentro do prestador autenticado, monta o resumo
  a partir dos dados persistidos e grava a proposta no PostgreSQL.
- O usuário confirma os parâmetros exatos exibidos. A confirmação recebe apenas
  o `proposalId`; o modelo não reconstrói a ferramenta nem os argumentos.
- A proposta pertence ao prestador e ao `session_id` verificado do JWT, expira
  em cinco minutos e pode executar seu efeito somente uma vez.
- A chave de idempotência é criada pelo orquestrador antes da proposta. Repetir
  a criação com a mesma chave e os mesmos parâmetros devolve a proposta
  existente; reutilizá-la com outro conteúdo é rejeitado.
- Confirmações concorrentes são serializadas por `SELECT ... FOR UPDATE`. A
  transição, sua auditoria, o evento e o consumo da proposta são confirmados na
  mesma transação. Repetições devolvem o resultado persistido sem executar de
  novo.

Essas garantias independem da memória do processo e, portanto, continuam
válidas entre réplicas e depois de um redeploy.

## Contrato implementado

Criar a proposta:

```http
POST /api/action-proposals
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "tool": "marcar_pago_manual",
  "arguments": { "paymentId": "uuid" },
  "idempotencyKey": "uuid"
}
```

Confirmar exatamente a proposta exibida:

```http
POST /api/action-proposals/:proposalId/confirm
Authorization: Bearer <access_token>
```

`POST /api/payments/:id/mark-paid` retorna `428 ACTION_PROPOSAL_REQUIRED` para
impedir que clientes antigos contornem o protocolo.
