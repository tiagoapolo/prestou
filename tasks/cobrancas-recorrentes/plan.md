# Plano de implementação: cobranças recorrentes mensais

## Visão geral

Implementar séries mensais finitas, com data final obrigatória, sem contabilizar
competências futuras como valores a receber. Cada competência gerada será uma
cobrança normal e independente, com um pagamento, link Pix, lembretes e baixa.

Fonte: [`specs/cobrancas-recorrentes-mensais.md`](../../specs/cobrancas-recorrentes-mensais.md).

Este plano fica isolado porque `tasks/plan.md` e `tasks/todo.md` pertencem ao
onboarding self-serve já em execução.

## Revisão do código atual

### Aproveitar

- O cálculo atual de fim de mês preserva a âncora do dia 31.
- Links do Dashboard, Financeiro, lembretes e confirmação pública passaram a
  usar `paymentId`, identificando a competência correta.
- A UI já tem uma opção explícita de repetição que pode pedir a data final.
- Baseline em 2026-08-06: API 78 testes passando e 2 integrações puladas; web 15
  testes passando; `git diff --check` limpo.

### Corrigir antes da entrega

1. O código cria 2–24 `payments` antecipadamente; os totais tratam todo o futuro
   como “A receber”.
2. Recorrência é inferida por `COUNT(payments)`, sem série, estado, data final,
   próxima competência, pausa, edição ou cancelamento.
3. Vários pagamentos sob uma `charge` representam parcelamento, não mensalidades
   independentes.
4. O `COUNT(*)` correlacionado por item degrada a listagem e confunde qualquer
   cobrança multipagamento com recorrência.
5. O contrato `occurrences` não expressa a data final obrigatória.
6. Os testes atuais não protegem idempotência, concorrência, isolamento ou saldo.

## Arquitetura

### Modelo

Criar `charge_series` como fonte da regra futura e adicionar referências
opcionais em `charges`:

```text
charge_series 1 ───── 0..24 charges 1 ───── 1 payment
      │                      │
      └── regra futura       └── fato financeiro gerado
```

A série guarda prestador, cliente, descrição, valor, primeiro vencimento,
dia-âncora, data final, próximo vencimento, estado e timestamps. O banco terá:

- `CHECK` de valor, âncora, datas e estado;
- RLS e revogação de `anon`/`authenticated`;
- índice por prestador/data;
- índice parcial de séries ativas por `next_due_date`;
- unicidade parcial de `(charge_series_id, series_sequence)` em `charges`;
- índices para todas as novas chaves estrangeiras.

Cobranças avulsas mantêm os novos campos nulos.

### Criação aditiva

Manter `POST /api/charges`. O campo opcional será:

```json
{
  "recurrence": {
    "frequency": "monthly",
    "endDate": "2027-12-31"
  }
}
```

Sem recorrência, nada muda. Com recorrência, a transação cria a série e somente a
primeira cobrança. A resposta preserva os campos atuais e acrescenta o resumo da
série.

### Geração idempotente

`runRecurringCharges(today)` buscará séries ativas alcançadas por `today + 7`,
bloqueará cada série com `FOR UPDATE`, criará competências elegíveis, avançará o
próximo vencimento e concluirá quando necessário. A unicidade no banco protege
replay e concorrência.

O cron existente continuará chamando `POST /api/internal/run-reminders`; a rota
gerará recorrências antes dos lembretes e acrescentará `recurring` à resposta.
Isso evita novo serviço ou configuração operacional.

### Gestão autenticada

- `GET /api/charge-series` paginado;
- `GET /api/charge-series/:id`;
- `PATCH /api/charge-series/:id` para descrição, valor, dia e data final;
- `POST /api/charge-series/:id/pause`;
- `POST /api/charge-series/:id/resume`;
- `POST /api/charge-series/:id/cancel`.

Toda consulta inclui `provider_id`. Gestão nunca altera cobranças já geradas.

### Apresentação compatível

Cobranças continuam orientadas por `paymentId` e recebem referência opcional:

```json
{
  "recurrence": {
    "seriesId": "uuid",
    "sequence": 2,
    "occurrences": 12
  }
}
```

O total vem da regra de calendário, não da contagem de pagamentos existentes.

## Ordem de implementação

```text
Calendário/contrato
        ▼
Migração + primeira competência
        ├──────────────┐
        ▼              ▼
Geração diária     Gestão da série
        └──────┬───────┘
               ▼
Apresentação da API
               ▼
Criação web → detalhe/ações → painel
```

## Checkpoints

### Backend básico — Tasks 1–2

- datas e limites protegidos por testes;
- série e primeira competência atômicas;
- cobrança avulsa compatível;
- somente a primeira competência entra no financeiro.

### Operação — Tasks 3–5

- replay/concorrência sem duplicidade;
- gestão futura isolada por prestador;
- totais ignoram competências futuras;
- testes e typecheck da API verdes.

### Web — Tasks 6–8

- criação com data final e prévia;
- gestão acessível de estado;
- competência ligada à série correta;
- testes, typecheck e build da web verdes.

### Entrega — Task 9

- suites, typecheck e build completos;
- SQL validado localmente quando o runtime Supabase estiver disponível;
- navegador limpo em 320 px e desktop;
- diff sem segredos, código morto ou alterações fora do escopo.

## Modelo de ameaças

| Ameaça | Controle |
|---|---|
| IDOR entre prestadores | autenticação + `provider_id` em toda consulta + testes negativos |
| Replay do cron | lock transacional + índice único + idempotência |
| Datas/valor adulterados | Zod + `CHECK` + limite de 24 competências |
| Cancelamento retroativo | série separada; cobranças geradas não são mutadas |
| Link da competência errada | mensagem derivada do `paymentId` recém-criado |
| PII em analytics | IDs e valores apenas; sem nome ou WhatsApp |
| Abuso do cron | `CRON_SECRET` existente; resposta sem dados de clientes |

## Riscos

| Risco | Mitigação |
|---|---|
| Working tree com mudanças sobrepostas | edições cirúrgicas e diff por arquivo |
| Falha após commit e antes da notificação | cobrança permanece válida; notificação falha é auditável e retentável |
| Mudança de dia altera quantidade futura | recalcular prévia e validar 2–24 antes da atualização |
| Pausa atravessa data final | não recuperar meses; concluir quando não houver data futura |
| Supabase local indisponível | validar por testes/SQL estático e declarar a limitação; não aplicar em produção |
| UI de gestão crescer | página focada, sem nova store ou dependência |

## Fora do escopo

- gestão pelo assistente do WhatsApp;
- envio automático ao cliente;
- frequências além de mensal ou série sem data final;
- pró-rata, reajuste, juros e nota fiscal;
- migração em produção;
- commit, push ou PR sem solicitação.

## Verificação

```bash
pnpm --filter @prestou/api test
pnpm --filter @prestou/web test
pnpm typecheck
pnpm test
pnpm build
```

## Questões abertas

Nenhuma. O cron atual será reutilizado e nenhuma dependência será adicionada.
