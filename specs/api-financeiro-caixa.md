---
title: "API e experiência — Financeiro por regime de caixa"
created: 2026-07-23
status: implementada
tags:
  - prestou
  - spec
  - api
  - financeiro
  - caixa
---

# API e experiência — Financeiro por regime de caixa

## Objetivo

Responder quanto dinheiro efetivamente entrou em cada mês, permitir completar o
controle com receitas recebidas fora do Prestou e produzir um CSV conferível.

Esta visão é separada do resumo de carteira por vencimento existente em
`GET /api/financial-summary`.

## Regras comuns

- todos os endpoints exigem `Authorization: Bearer <access_token>`;
- o prestador é derivado do JWT e nunca recebido no corpo ou na URL;
- cada consulta e alteração é escopada pelo prestador autenticado;
- valores são inteiros em centavos;
- datas financeiras são dias no formato `AAAA-MM-DD`;
- meses usam `AAAA-MM`;
- pagamentos são atribuídos ao mês de `paid_at` em `America/Sao_Paulo`;
- receitas avulsas usam `received_date`;
- formas de pagamento aceitas são `pix`, `dinheiro`, `cartao`,
  `transferencia` e `outro`;
- pagamento parcial não é suportado nesta fase.

## Modelo de dados

### Extensão de `payments`

- `received_amount_cents`: valor efetivamente recebido, sem alterar o valor
  originalmente cobrado;
- `payment_method`: forma de pagamento;
- `financial_note`: observação opcional de até 500 caracteres;
- `financial_voided_at`: soft delete exclusivamente financeiro. Não altera o
  status da cobrança.

Pagamentos existentes no estado `paga` são migrados com o valor original e
forma `pix`. Consultas mantêm fallback para esses valores.

### `manual_receipts`

Representa uma receita recebida fora de uma cobrança. O cliente é opcional e,
quando informado, deve pertencer ao mesmo prestador. Exclusão é lógica por
`voided_at`.

### `financial_entry_events`

Registra criação, correção e exclusão lógica. A auditoria de
pagamentos guarda somente campos financeiros e não replica token público ou BR
Code.

As tabelas estão no schema `public`, têm RLS habilitado como defesa em
profundidade e não concedem acesso a `anon` ou `authenticated`. O navegador usa
somente a API autenticada.

## Consultar o Financeiro

```http
GET /api/financial?month=2026-07
```

Sem `month`, usa o mês atual em `America/Sao_Paulo`.

```json
{
  "month": "2026-07",
  "availableMonths": ["2026-07", "2026-06"],
  "items": [
    {
      "source": "payment",
      "sourceId": "uuid",
      "chargeId": "uuid",
      "description": "Corte de grama",
      "amountCents": 15007,
      "receivedDate": "2026-07-23",
      "paymentMethod": "pix",
      "note": null,
      "client": { "id": "uuid", "name": "Maria Cliente" }
    }
  ],
  "summary": {
    "receivedCents": 15007,
    "previousMonthReceivedCents": 0,
    "pendingCents": 30000,
    "overdueCents": 10000
  }
}
```

`receivedCents` é exatamente a soma dos itens retornados. `pendingCents` e
`overdueCents` representam a carteira atual, não uma fotografia histórica do
mês selecionado.

`availableMonths` inclui os meses com pagamentos ou receitas avulsas e mantém o
mês atualmente selecionado para permitir adicionar o primeiro registro.

## Adicionar receita avulsa

```http
POST /api/financial/manual-receipts
Content-Type: application/json
```

```json
{
  "clientId": null,
  "description": "Atendimento particular",
  "amountCents": 18000,
  "receivedDate": "2026-07-23",
  "paymentMethod": "dinheiro",
  "note": "Recebido no local"
}
```

Retorna `201` com `{ "entry": ... }`.

## Corrigir receita avulsa

```http
PATCH /api/financial/manual-receipts/:id
```

Recebe o mesmo corpo completo da criação. A alteração grava o estado anterior e
posterior na auditoria.

## Excluir receita avulsa

```http
DELETE /api/financial/manual-receipts/:id
```

Retorna `204`. O registro recebe `voided_at`, deixa de compor listas/totais e
permanece auditável.

## Corrigir pagamento de cobrança

```http
PATCH /api/financial/payments/:id
Content-Type: application/json
```

```json
{
  "amountCents": 15007,
  "receivedDate": "2026-07-23",
  "paymentMethod": "pix",
  "note": "Data conferida no extrato"
}
```

Somente pagamentos em estado `paga` podem ser corrigidos. A correção não altera
o valor original da cobrança.

## Excluir recebimento do Financeiro

```http
DELETE /api/financial/payments/:id
```

- preenche `financial_voided_at` sem alterar `payments.status`;
- a cobrança continua `paga` no histórico operacional;
- o recebimento deixa de aparecer em listas, totais, comparação mensal,
  assistente, resumo financeiro e CSV;
- valores e datas originais são preservados para auditoria;
- um evento `payment_voided` é registrado.

A migração corretiva também identifica registros `payment_reopened` produzidos
pela implementação anterior, restaura essas cobranças para `paga` e aplica o
soft delete financeiro.

## Exportar CSV

```http
GET /api/financial/export.csv?month=2026-07
```

Resposta UTF-8 com BOM, separador `;` e download autenticado. Colunas:

1. Data do recebimento;
2. Cliente;
3. Serviço;
4. Valor;
5. Forma de pagamento;
6. Origem;
7. Situação;
8. Observação.

Campos iniciados por `=`, `+`, `-` ou `@` são neutralizados para evitar execução
de fórmulas ao abrir o CSV em uma planilha.

## Experiência web

- rota autenticada `/financeiro`;
- link explícito para voltar ao painel principal;
- opção fixa “Financeiro” no cabeçalho;
- seleção de qualquer mês com registros;
- recebido no mês e comparação com o mês anterior;
- a receber e em atraso como carteira atual;
- lista rastreável com acesso à cobrança de origem;
- formulário de receita avulsa com cliente opcional;
- edição e ação “Excluir do Financeiro”, explicando que o recebimento sai dos
  cálculos sem reabrir a cobrança;
- estado vazio que explica como completar o mês;
- download do CSV.

## Assistente

O resumo já existente passa a calcular “Recebido no mês” pela data efetiva e
inclui receitas avulsas. Novos comandos de escrita, como registrar uma receita
pelo WhatsApp, não fazem parte desta fase e aguardam validação da tela web.

## Critérios de aceite cobertos

- cobrança vencida em um mês e paga em outro entra no mês do pagamento;
- cada centavo de `receivedCents` corresponde a um item da lista;
- correção de data move o registro para o mês correto;
- receita sem cliente pode ser registrada;
- soft delete remove o recebimento de todos os cálculos sem reabrir a cobrança
  nem apagar o histórico;
- totais e CSV usam a mesma fonte de registros;
- dados não atravessam a fronteira do prestador autenticado;
- datas consideram `America/Sao_Paulo`.

## Fora do escopo

- pagamentos parciais;
- despesas, lucro ou fluxo de caixa projetado;
- NFS-e;
- preparação ou transmissão tributária;
- conciliação bancária;
- criação ou correção de receitas pelo WhatsApp.
