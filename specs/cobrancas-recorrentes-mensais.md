---
title: "Spec — Cobranças recorrentes mensais com data final"
created: 2026-08-06
status: implementada
tags:
  - prestou
  - spec
  - cobrancas
  - recorrencia
relacionado:
  - "[[ADR-010 — Memória de preenchimento de cobrança (slot-filling)]]"
  - "[[API — Cobranças, clientes e financeiro]]"
  - "[[Plano GTM — ICP Serviços]]"
---

# Spec: cobranças recorrentes mensais com data final

## Premissas validadas

1. Recorrência significa automatizar a criação periódica de cobranças; não é
   débito automático, assinatura no cartão nem parcelamento com juros.
2. O primeiro recorte atende prestadores individuais com uma carteira mensal:
   personal trainer, professor particular, jardinagem, psicólogo sem convênio,
   social media e ocupações semelhantes.
3. A série é mensal, finita e exige data final no momento da criação.
4. Cada competência gera uma cobrança normal e independente, preservando o fluxo
   atual de Pix, envio pelo prestador, lembretes, confirmação e baixa.
5. O ADR-010 continua cuidando apenas da memória curta de preenchimento de uma
   cobrança. Ele não representa nem armazena uma série recorrente.

## Objetivo

Permitir que um prestador cadastre uma única vez uma mensalidade e deixe o
Prestou preparar as cobranças mensais até uma data final definida. O produto deve
eliminar a recriação manual da mesma cobrança sem transformar o Prestou em
intermediador financeiro.

### Problema

Hoje cada cobrança é iniciada como um evento único. A memória do ADR-010 reduz o
retrabalho dentro de uma conversa, mas o prestador ainda precisa lembrar de
repetir cliente, serviço, valor e vencimento todo mês. Na Camada 1 do ICP, essa
dor se repete por calendário e é o principal motivo para recorrência nativa.

### Usuário principal

Prestador autônomo e solo que:

- atende clientes identificáveis por nome e WhatsApp;
- cobra o mesmo serviço e valor mensalmente;
- recebe por Pix na própria chave;
- executa ou mantém o serviço antes de receber;
- controla mensalidades e atrasos manualmente.

### História principal

> Como prestador com clientes mensais, quero informar cliente, serviço, valor,
> primeiro vencimento e data final uma única vez, para que o Prestou prepare cada
> cobrança mensal no momento certo e eu apenas revise e envie a mensagem.

## Escopo funcional do MVP

### 1. Criar uma série mensal

Na criação de cobrança pela web, o prestador pode marcar “Repetir todo mês” e
deve informar:

- cliente salvo ou novo cliente;
- descrição do serviço;
- valor fixo em centavos;
- primeiro vencimento;
- data final obrigatória;
- confirmação explícita de que se trata de uma série mensal.

A data final é inclusiva: uma competência é criada quando seu vencimento
calculado é anterior ou igual à data final.

Regras:

- a série deve produzir no mínimo duas competências;
- a série pode abranger no máximo 24 competências;
- a data final não pode ser anterior ao segundo vencimento calculado;
- o primeiro vencimento pode ser hoje ou uma data futura;
- datas são interpretadas no calendário de `America/Sao_Paulo`;
- o valor é fixo para as competências ainda não geradas.

### 2. Calcular os vencimentos

O dia do primeiro vencimento é a âncora mensal da série.

- Se o dia existir no mês, ele é preservado.
- Se não existir, usa-se o último dia daquele mês.
- O ajuste de um mês curto não muda a âncora dos meses seguintes.

Exemplo: uma série ancorada em 31/01 vence em 28/02 (ou 29/02), volta a 31/03 e
vence em 30/04.

### 3. Gerar cobranças por competência

- A primeira competência é criada imediatamente com a série.
- Cada competência posterior é gerada sete dias corridos antes do vencimento.
- Se uma série for criada dentro dessa janela, toda competência já alcançada
  pela janela é gerada imediatamente.
- Cada competência tem identificador, link público, código Pix, estado e trilha
  financeira próprios.
- Uma restrição de unicidade lógica por série e competência impede duplicação,
  inclusive em reexecução ou concorrência do job.
- Falhas transitórias são retentadas sem gerar cobranças duplicadas.
- Uma falha definitiva fica registrada e visível para operação; ela não avança
  silenciosamente como se a competência tivesse sido criada.

Somente competências efetivamente geradas entram em “A receber”, “Em atraso” e
no resumo financeiro. O valor futuro total da série não é contabilizado como
recebível antes da geração.

### 4. Preparar envio e lembretes

- Ao gerar uma competência futura, o Prestou notifica o prestador e prepara uma
  mensagem com o link correto para o cliente.
- O prestador continua responsável por tocar e enviar a mensagem ao cliente.
- O Prestou não envia automaticamente uma cobrança ao cliente neste MVP.
- Depois de gerada, a competência reutiliza a cadência atual de lembretes ao
  prestador: no vencimento, D+2 e D+5, enquanto continuar em aberto.
- O envio e os lembretes devem sempre referenciar a competência correta, nunca
  apenas a série abstrata.

### 5. Consultar uma série

O prestador consegue ver:

- cliente, descrição e valor vigentes;
- primeiro vencimento, próximo vencimento e data final;
- estado da série;
- quantidade prevista de competências;
- quantidade gerada;
- cobranças geradas e seus estados;
- próxima ação disponível.

Estados da série:

- `ativa`: pode gerar novas competências;
- `pausada`: não gera enquanto estiver pausada;
- `cancelada`: não volta a gerar;
- `concluida`: todas as competências previstas até a data final já foram
  geradas, ainda que alguma cobrança individual continue em aberto.

O estado de pagamento pertence à competência, não à série.

### 6. Editar competências futuras

O prestador pode alterar, para competências ainda não geradas:

- descrição;
- valor;
- dia de vencimento;
- data final, respeitando o mínimo de duas e o máximo de 24 competências.

Regras:

- alterações nunca modificam cobranças já geradas;
- o cliente da série não pode ser trocado; para outro cliente, cria-se outra
  série;
- reduzir a data final não pode excluir uma competência já gerada;
- ampliar a data final não pode ultrapassar 24 competências;
- editar uma série concluída só é permitido se a nova data final criar pelo
  menos uma competência futura válida; nesse caso ela volta a `ativa`.

### 7. Pausar, retomar e cancelar

- Pausar impede novas gerações, sem alterar cobranças existentes.
- Meses que venceram durante a pausa são tratados como intencionalmente pulados
  e não são criados retroativamente ao retomar.
- Ao retomar, a próxima competência elegível é a primeira data de vencimento
  futura dentro da data final.
- Se não houver vencimento futuro, a série passa a `concluida`.
- Cancelar exige confirmação e impede definitivamente novas gerações.
- Cancelar ou pausar nunca apaga, cancela ou quita uma cobrança já gerada.

### 8. Cobranças avulsas e ADR-010

- O fluxo de cobrança avulsa continua funcionando sem campos de recorrência.
- A memória curta do ADR-010 não é usada como armazenamento durável de série.
- No MVP, configuração e manutenção da série acontecem na web.
- Criar, editar, pausar ou cancelar séries pelo assistente do WhatsApp fica fora
  deste recorte e requer uma especificação conversacional própria.

## Fora do escopo

- recorrência semanal, quinzenal, bimestral ou anual;
- série sem data final;
- débito automático, Pix Automático ou cartão recorrente;
- parcelamento, juros, multa, desconto ou renegociação;
- reajuste automático por índice ou aniversário;
- pró-rata por início, pausa ou cancelamento no meio do mês;
- múltiplos clientes na mesma série;
- múltiplos serviços ou valores variáveis na mesma competência;
- emissão de nota fiscal;
- envio automático da cobrança ao cliente;
- criação e gestão da série pelo WhatsApp;
- recuperação automática de competências puladas durante uma pausa.

## Requisitos de experiência

- A interface deve chamar o recurso de “cobrança mensal” ou “série mensal”, não
  de “assinatura”, para não prometer cobrança automática.
- Antes da confirmação, deve mostrar uma prévia com quantidade de competências,
  primeiro e último vencimentos e valor por mês.
- O total da série pode aparecer como informação, mas deve ser rotulado como
  “valor previsto até a data final” e nunca somado ao saldo financeiro atual.
- A confirmação deve explicar que o Prestou prepara as cobranças e que o
  prestador continua enviando as mensagens.
- Uma competência deve aparecer no painel como cobrança normal, acompanhada de
  “mensalidade N de M” e acesso à série de origem.
- Pausa e cancelamento exigem mensagens distintas: pausa é reversível;
  cancelamento é definitivo para novas competências.

## Requisitos de dados e integridade

- Toda série pertence a exatamente um `provider_id` e um `client_id`.
- Nenhuma leitura ou escrita pode atravessar a fronteira do prestador autenticado.
- Valores são inteiros em centavos; datas de negócio são `AAAA-MM-DD`.
- A série guarda a âncora original de vencimento separada das datas ajustadas de
  cada competência.
- Cada cobrança gerada mantém a série e a competência de origem auditáveis.
- O job de geração é idempotente e transacional.
- Alterações de série registram antes/depois e ator.
- Exclusões físicas não fazem parte do fluxo normal; cancelamento é estado de
  negócio.
- A geração não depende do LLM e não envia dados da série ao modelo.

## Eventos e métricas

Registrar no mínimo:

- `serie_mensal_criada`;
- `serie_mensal_editada`;
- `serie_mensal_pausada`;
- `serie_mensal_retomada`;
- `serie_mensal_cancelada`;
- `serie_mensal_concluida`;
- `cobranca_recorrente_gerada`;
- `cobranca_recorrente_falhou`.

Cada evento deve carregar `providerId`, `seriesId` e, quando houver,
`chargeId`/`paymentId`, sem incluir nome ou WhatsApp do cliente nos metadados.

Métricas de produto:

- séries criadas por prestador ativado;
- proporção de séries que chegam à segunda competência;
- competências geradas sem intervenção manual;
- tempo entre geração e envio pelo prestador;
- recebimento e atraso de recorrentes versus avulsas;
- pausas e cancelamentos antes da segunda competência;
- falhas e duplicidades de geração, cuja meta é zero duplicidade.

## API conceitual

Os nomes finais serão fechados no plano de interface, mas o produto precisa das
seguintes capacidades autenticadas:

- criar série mensal;
- listar séries do prestador;
- consultar série e competências;
- editar somente regras futuras;
- pausar;
- retomar;
- cancelar;
- executar geração idempotente pelo job interno.

As APIs de cobranças existentes continuam retornando competências como cobranças
normais e podem acrescentar referência opcional à série.

## Stack técnica existente

- Monorepo pnpm 11.9+ e Node.js 24.
- API TypeScript com Fastify 5, Zod 3 e driver PostgreSQL.
- PostgreSQL no Supabase, com RLS e acesso de dados pela API server-side.
- Web React 19, React Router 7, Vite 8 e componentes Radix/shadcn.
- Testes da API com `node:test`; testes web com Vitest e Testing Library.

## Comandos

Executar a partir da raiz do repositório:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @prestou/api test
pnpm --filter @prestou/web test
pnpm dev:api
pnpm dev:web
```

O projeto não possui comando de lint configurado; não se deve inventar um gate
de lint sem decisão explícita.

## Estrutura do projeto

```text
apps/api/src/          API, domínio, job e notificações
apps/api/src/routes/   Rotas autenticadas e internas
apps/api/test/         Testes unitários e de integração da API
apps/web/src/pages/    Telas de criação, consulta e gestão
apps/web/src/          Tipos e cliente HTTP compartilhados na web
supabase/migrations/   Modelo persistente, índices e restrições
specs/                 Especificações vivas do produto
specs/decisoes/        ADRs para decisões arquiteturais duráveis
tasks/                 Plano e tarefas, após aprovação desta spec
```

## Estilo de código

- TypeScript estrito, módulos ESM e validação na borda com Zod.
- `camelCase` em TypeScript e JSON; `snake_case` no PostgreSQL.
- Datas civis em `AAAA-MM-DD`; timestamps em ISO 8601.
- Valores monetários como inteiros em centavos.
- Funções de domínio puras para calendário; I/O isolado nas portas de banco,
  rota e notificação.
- Nomes devem expressar “série” e “competência”, evitando chamar competência de
  parcela ou série de assinatura.

Exemplo de contrato de domínio desejado:

```ts
interface MonthlyChargeSeriesSchedule {
  firstDueDate: string;
  endDate: string;
  anchorDay: number;
}

function nextMonthlyDueDate(
  schedule: MonthlyChargeSeriesSchedule,
  after: string,
): string | null {
  // Função pura; respeita a âncora e nunca ultrapassa endDate.
}
```

## Estratégia de testes

### Unidade

- cálculo de meses normais, fim de mês e ano bissexto;
- inclusão da data final;
- mínimo de duas e máximo de 24 competências;
- cálculo da próxima competência depois de pausa;
- transições válidas e inválidas de estado;
- separação entre métricas previstas e valores financeiros gerados.

### Integração da API e banco

- criação atômica da série e primeira competência;
- isolamento por prestador em toda rota;
- unicidade por série/competência sob duas execuções concorrentes;
- job repetido produz o mesmo resultado sem duplicar;
- edição só afeta competências ainda não geradas;
- pausa, retomada, cancelamento e conclusão;
- falha durante geração faz rollback completo da competência;
- filtros e resumo financeiro incluem apenas cobranças geradas.

### Web

- data final é obrigatória quando a recorrência está ativa;
- prévia exibe quantidade e datas corretas;
- erros de intervalo são acessíveis e associados ao campo;
- confirmação diferencia série de cobrança automática;
- telas representam corretamente estados e ações permitidas;
- cobranças avulsas permanecem sem regressão.

### Verificação

- Todo critério de sucesso abaixo deve ter teste automatizado no nível mais baixo
  que prove o comportamento.
- `pnpm typecheck`, `pnpm test` e `pnpm build` devem passar.
- O fluxo completo deve ser validado manualmente em viewport móvel antes da
  entrega; não há framework E2E configurado hoje.

## Limites de execução

### Sempre fazer

- validar entrada na API e aplicar isolamento por `provider_id`;
- usar transação, unicidade e idempotência na geração;
- preservar cobranças já geradas ao editar, pausar ou cancelar;
- calcular datas sem depender do fuso do processo;
- manter cobranças avulsas compatíveis;
- rodar typecheck, testes e build antes de concluir;
- atualizar esta spec antes de mudar o comportamento acordado.

### Perguntar antes

- alterar o limite de 24 competências ou a antecedência de sete dias;
- adicionar dependência ou serviço de agendamento;
- mudar o esquema de banco além do modelo aprovado no plano;
- alterar a cadência atual de lembretes;
- enviar mensagens automaticamente ao cliente;
- incluir gestão de séries pelo WhatsApp;
- mudar contratos públicos existentes ou configuração de CI.

### Nunca fazer

- apresentar a série como débito automático ou pagamento garantido;
- criar todas as competências futuras antecipadamente e inflar “A receber”;
- alterar ou apagar silenciosamente uma cobrança já gerada;
- recuperar meses pausados sem ação explícita do prestador;
- usar o ADR-010 como persistência da série;
- enviar PII do cliente em eventos analíticos ou ao LLM;
- remover teste existente para fazer a mudança passar;
- editar segredos, artefatos gerados ou dependências vendorizadas.

## Critérios de sucesso

1. O prestador cria uma série válida com primeiro vencimento e data final e vê a
   quantidade, o primeiro e o último vencimentos antes de confirmar.
2. Uma série nunca é aceita com menos de duas ou mais de 24 competências.
3. A primeira cobrança é criada na confirmação e as seguintes, sete dias antes
   de cada vencimento.
4. Duas execuções concorrentes do job geram no máximo uma cobrança para a mesma
   série e competência.
5. Uma âncora no dia 31 ajusta fevereiro e abril sem perder o dia 31 em março e
   maio.
6. Somente cobranças geradas aparecem nos totais financeiros.
7. Editar valor, descrição, vencimento ou data final não modifica cobranças já
   geradas.
8. Pausar impede geração; retomar não recupera meses vencidos; cancelar impede
   geração definitivamente.
9. Cada competência preserva link, Pix, estado, lembretes e baixa independentes.
10. O prestador recebe uma ação de envio quando a competência é gerada; nenhum
    cliente recebe mensagem automática neste MVP.
11. Cobranças avulsas e o fluxo de memória do ADR-010 continuam funcionando sem
    regressão.
12. Nenhuma série ou competência pode ser lida ou alterada por outro prestador.
13. Falhas são auditáveis e retentáveis sem duplicidade.
14. Typecheck, testes e build completos passam.

## Decisões aprovadas

1. **Antecedência:** gerar competências futuras sete dias antes do vencimento.
2. **Canal de configuração:** criar e gerir séries inicialmente pela web; o
   WhatsApp recebe notificações e abre a mensagem pronta para envio.
3. **Horizonte:** exigir de duas a 24 competências, derivadas do primeiro
   vencimento e da data final inclusiva.
4. **Pausa:** não criar retroativamente os meses que venceram durante a pausa.

## Questões abertas

Nenhuma questão bloqueia a implementação. Qualquer alteração nas decisões acima
deve ser incorporada nesta especificação antes de mudar o comportamento.
