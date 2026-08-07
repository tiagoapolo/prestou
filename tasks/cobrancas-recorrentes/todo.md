# Tarefas: cobranças recorrentes mensais

## Task 1 — Calendário e contrato

- [x] RED: testar âncora, bissexto, data final inclusiva e limites 2–24.
- [x] GREEN: consolidar funções puras e trocar `occurrences` por `endDate`.
- [x] Verificar: teste focado e typecheck da API.
- [x] Arquivos: `recurrence.ts`, teste novo, `charge-creation.ts`.

## Task 2 — Série e primeira competência

- [x] Criar migração com constraints, índices, RLS e revogações.
- [x] Criar série e primeira cobrança na mesma transação.
- [x] Manter cobrança avulsa compatível.
- [x] Verificar: testes de criação, suite API, typecheck e `supabase db reset` se disponível.
- [x] Arquivos: migração, `recurrence.ts`, `charge-creation.ts`, rota e teste.

## Task 3 — Geração diária

- [x] RED: provar janela de sete dias, replay e avanço/conclusão.
- [x] GREEN: job por série com lock e unicidade.
- [x] Integrar ao cron atual e notificar apenas o prestador.
- [x] Verificar: testes do job, suite API e typecheck.
- [x] Arquivos: `recurrence.ts`, teste, `reminders.ts`, `insights.ts`, `server.ts`.

## Task 4 — Gestão autenticada

- [x] Criar rotas de lista, detalhe, edição, pausa, retomada e cancelamento.
- [x] Provar isolamento e imutabilidade das cobranças geradas.
- [x] Pular meses pausados e concluir sem próximo vencimento.
- [x] Verificar: testes de rota/estado, suite API e typecheck.
- [x] Arquivos: nova rota, `recurrence.ts`, teste e `server.ts`.

## Task 5 — Apresentação da API

- [x] Retornar série, sequência e total nas cobranças recorrentes.
- [x] Retornar `recurrence: null` nas avulsas.
- [x] Remover `COUNT(payments)` correlacionado.
- [x] Verificar: testes de resposta, suite API e typecheck.
- [x] Arquivos: rota de cobranças, tipos e teste de fluxo.

## Checkpoint backend

- [x] Suite e typecheck da API passam.
- [x] Somente cobranças geradas entram no financeiro.
- [x] Revisão de autorização, SQL, índices e idempotência concluída.

## Task 6 — Criação web

- [x] RED: data final obrigatória, prévia e payload com `endDate`.
- [x] GREEN: adaptar formulário e manter o fluxo avulso.
- [x] Garantir labels, ajuda e teclado.
- [x] Verificar: teste focado, suite web e typecheck.
- [x] Arquivos: `NewCharge.tsx`, teste, tipos e estilos.

## Task 7 — Detalhe e gestão web

- [x] Exibir estado, próxima data, data final e competências.
- [x] Editar, pausar, retomar e cancelar com confirmação.
- [x] Tratar loading, erro e ações indisponíveis.
- [x] Verificar: teste da página, suite web e typecheck.
- [x] Arquivos: nova página/teste, `App.tsx`, tipos e estilos.

## Task 8 — Integração no painel

- [x] Mostrar “mensalidade N de M”.
- [x] Ligar detalhe da competência à série.
- [x] Preservar links por `paymentId` no Financeiro e notificações.
- [x] Verificar: testes relacionados, suite web e typecheck.
- [x] Arquivos: Dashboard, ChargeDetail, Financial e tipos.

## Task 9 — Qualidade final

- [x] Atualizar API docs, README e spec se necessário.
- [x] Revisar correção, arquitetura, segurança, performance e legibilidade.
- [x] Rodar `pnpm typecheck`, `pnpm test`, `pnpm build` e `git diff --check`.
- [ ] Verificar navegador em 320 px e desktop, console, rede e acessibilidade.

> Limitação: o navegador local chegou ao login sem erros de console, mas não
> havia uma sessão autenticada para abrir as telas privadas em 320 px e desktop.
