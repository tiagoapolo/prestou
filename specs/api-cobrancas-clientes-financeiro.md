---
title: "API — Cobranças, clientes e resumo financeiro"
created: 2026-07-21
status: implementada
tags:
  - prestou
  - spec
  - api
---

# API — Cobranças, clientes e resumo financeiro

> **Nota após a Fase 1 do Financeiro:** o endpoint
> `GET /api/financial-summary` desta spec continua representando a carteira de
> cobranças pelo vencimento. A visão de caixa por data efetiva do recebimento,
> receitas avulsas, correções e CSV está documentada em
> [`api-financeiro-caixa.md`](./api-financeiro-caixa.md).

## Regras comuns

- Todos os endpoints desta especificação exigem `Authorization: Bearer <access_token>`.
- O prestador é derivado do JWT. Nenhum endpoint aceita `provider_id` informado pelo cliente.
- Um prestador acessa somente seus próprios clientes, cobranças e totais financeiros.
- Parâmetros inválidos retornam `400`; ausência ou invalidade da autenticação retorna `401`.
- Valores monetários são inteiros em centavos.
- Datas usam `AAAA-MM-DD` e meses usam `AAAA-MM`.

## Listar clientes

```http
GET /api/clients
```

Retorna todos os clientes do prestador autenticado, ordenados por nome. O endpoint é usado para reaproveitar um cliente ao criar uma cobrança.

```json
{
  "clients": [
    {
      "id": "uuid",
      "name": "Maria Cliente",
      "whatsapp": "11977776666"
    }
  ]
}
```

## Listar cobranças

```http
GET /api/charges
```

Retorna as cobranças mais recentes do prestador, ordenadas por data de criação decrescente. A ordenação usa o identificador do pagamento como desempate para manter a paginação estável.

### Parâmetros de consulta

| Parâmetro | Tipo | Padrão | Regra |
|---|---:|---:|---|
| `page` | inteiro | `1` | Deve ser maior que zero. |
| `pageSize` | inteiro | `20` | Deve estar entre `1` e `100`. |
| `clientId` | UUID | — | Restringe ao cliente informado, desde que pertença ao prestador. |
| `status` | texto | — | Aceita `em_aberto`, `cliente_confirmou`, `paga` ou `atrasada`. |
| `from` | data | — | Inclui vencimentos a partir desta data. |
| `to` | data | — | Inclui vencimentos até esta data. |

Quando `from` e `to` são informados, `from` não pode ser posterior a `to`. Os filtros podem ser combinados.

`atrasada` é um estado derivado: pagamento persistido como `em_aberto` cujo vencimento é anterior à data atual. Consequentemente, o filtro `status=em_aberto` retorna somente cobranças abertas ainda não vencidas.

### Resposta

```json
{
  "items": [
    {
      "paymentId": "uuid",
      "chargeId": "uuid",
      "description": "Corte de grama",
      "amountCents": 15007,
      "amountLabel": "R$ 150,07",
      "dueDate": "2026-07-31",
      "status": "em_aberto",
      "client": {
        "id": "uuid",
        "name": "Maria Cliente",
        "whatsapp": "11977776666"
      },
      "paymentUrl": "https://site.example/pay/token",
      "hasComprovante": false,
      "clientConfirmedAt": null,
      "paidAt": null,
      "paidVia": null,
      "whatsappDeeplink": "https://wa.me/..."
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  },
  "totals": {
    "aReceberCents": 15007,
    "recebidoMesCents": 0,
    "atrasadasCount": 0,
    "aguardandoValidacaoCount": 0
  }
}
```

`pagination.total` considera os filtros da requisição. `totals` preserva a visão geral do painel e considera todas as cobranças do prestador, independentemente da página e dos filtros. `recebidoMesCents` usa o mês atual da data de vencimento.

## Resumo financeiro mensal

```http
GET /api/financial-summary
```

Resume as cobranças com vencimento no mês selecionado e retorna seus itens de forma paginada. Sem `month`, usa o mês atual.

### Parâmetros de consulta

| Parâmetro | Tipo | Padrão | Regra |
|---|---:|---:|---|
| `month` | mês | mês atual | Formato `AAAA-MM`. |
| `page` | inteiro | `1` | Deve ser maior que zero. |
| `pageSize` | inteiro | `20` | Deve estar entre `1` e `100`. |

### Resposta

```json
{
  "month": "2026-07",
  "items": [
    {
      "paymentId": "uuid",
      "chargeId": "uuid",
      "description": "Corte de grama",
      "amountCents": 15007,
      "dueDate": "2026-07-31",
      "status": "em_aberto",
      "client": {
        "id": "uuid",
        "name": "Maria Cliente",
        "whatsapp": "11977776666"
      },
      "paidAt": null
    }
  ],
  "summary": {
    "totalCents": 15007,
    "receivedCents": 0,
    "pendingCents": 15007,
    "overdueCents": 0
  },
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

Os campos de `summary` consideram todas as cobranças do mês, não somente a página retornada:

- `totalCents`: valor total com vencimento no mês;
- `receivedCents`: valor das cobranças em estado `paga`;
- `pendingCents`: valor das cobranças que ainda não estão pagas;
- `overdueCents`: valor das cobranças abertas e vencidas.

Os itens são ordenados por vencimento decrescente e, em caso de empate, pela criação mais recente e pelo identificador do pagamento.

## Critérios de aceite

- Paginação não omite cobranças entre páginas quando a ordenação permanece inalterada.
- Filtros de cliente, estado e período podem ser usados isoladamente ou em conjunto.
- Estado atrasado é sempre derivado e nunca persistido.
- Totais não são limitados ao tamanho da página.
- O mês financeiro é delimitado pela data de vencimento, incluindo o primeiro dia e excluindo o primeiro dia do mês seguinte.
- Clientes e dados financeiros nunca atravessam a fronteira do prestador autenticado.
