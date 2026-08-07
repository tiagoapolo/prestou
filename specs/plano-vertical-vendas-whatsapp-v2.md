---
title: "Spec — Vertical Prestou Vendas (MVP)"
created: 2026-08-05
updated: 2026-08-06
status: especificacao-em-revisao
supersedes: plano-vertical-vendas-whatsapp.md
tags:
  - prestou
  - produto
  - vendas
  - whatsapp
  - financeiro
---

# Spec — Vertical Prestou Vendas (MVP)

## Estado e propósito

Esta é a fonte de verdade do MVP da vertical Vendas. Ela consolida e substitui
o escopo ampliado de
[`plano-vertical-vendas-whatsapp.md`](./plano-vertical-vendas-whatsapp.md).
As decisões de produto abaixo foram aprovadas em 6 de agosto de 2026; os gates
de descoberta e disposição de pagamento continuam obrigatórios antes da
implementação.

O fluxo deste documento é: **especificar → aprovar → planejar → decompor em
tarefas → implementar**. Aprovar esta especificação não autoriza iniciar a
implementação nem pular os gates de validação.

## Objetivo

Estender o Prestou para vendedores independentes que trabalham sozinhos,
vendem presencialmente e pelo WhatsApp, possuem clientes recorrentes ou
identificáveis e recebem parte das vendas depois.

O primeiro resultado que o produto deve entregar é permitir que o vendedor:

1. registre um pedido ou uma venda sem precisar cadastrar catálogo;
2. informe quanto já recebeu e quanto falta receber;
3. acompanhe o que precisa entregar e quem ainda precisa pagar;
4. registre o recebimento posterior ou prepare uma cobrança do saldo;
5. use Serviços e Vendas no mesmo cadastro e número de WhatsApp.

O MVP terá sucesso quando esse ciclo funcionar de ponta a ponta, sem duplicar
valores no Financeiro, sem expor dados entre vendedores e sem transformar o
Prestou em PDV, ERP ou intermediador de pagamentos.

## Stack técnica

| Camada | Tecnologia vigente |
|---|---|
| Monorepo | Node.js 24, pnpm 11.9 e TypeScript estrito |
| Web | React 19, Vite 8, React Router 7, Tailwind CSS 4 e shadcn/ui |
| API | Fastify 5, Zod 3 e driver `postgres` |
| Dados e autenticação | PostgreSQL e Auth do Supabase |
| WhatsApp | Meta Cloud API e orquestrador existente |
| Pix | pacote interno `@prestou/pix` |
| Testes | Node Test Runner na API/pacote Pix e Vitest + Testing Library na web |

Não serão adicionados frameworks, serviços ou dependências para este MVP sem
necessidade demonstrada e aprovação explícita.

## Comandos

Executar a partir da raiz do monorepo:

```bash
corepack enable
pnpm install --frozen-lockfile

pnpm dev:api
pnpm dev:web

pnpm build
pnpm typecheck
pnpm test

pnpm --filter @prestou/api test
pnpm --filter @prestou/web test
pnpm --filter @prestou/pix test
```

Para qualquer mudança de banco, descobrir primeiro a versão e a sintaxe da CLI
instalada; não presumir comandos por memória:

```bash
supabase --version
supabase migration new vertical_vendas_mvp
supabase db push --dry-run
```

Não existe script de lint configurado no repositório. O gate estático vigente é
`pnpm typecheck`; adicionar lint ou alterar CI exige aprovação.

## Estrutura do projeto

```text
apps/api/src/             API Fastify, domínio, orquestração e integrações
apps/api/src/routes/      contratos HTTP autenticados e públicos
apps/api/test/            testes unitários e de integração da API
apps/web/src/pages/       telas e fluxos do produto
apps/web/src/components/  componentes reutilizáveis e acessíveis
packages/pix/             geração e validação do BR Code Pix
supabase/migrations/      schema, constraints, índices, RLS e permissões
specs/                    especificações vivas e pesquisa de produto
specs/decisoes/           decisões arquiteturais permanentes
tasks/                    plano e tarefas, criado somente após aprovar a spec
```

Vendas será um domínio próprio, separado das tabelas de cobranças de Serviços,
mas reutilizará identidade do prestador, clientes quando aplicável, Financeiro,
auditoria e infraestrutura do WhatsApp.

## Estilo de código

- nomes técnicos, tipos, tabelas e enums novos em inglês;
- mensagens apresentadas ao usuário em português brasileiro;
- valores monetários como inteiros em centavos, nunca `float`;
- datas civis em `AAAA-MM-DD` e instantes em `timestamptz`;
- TypeScript estrito, sem `any`, com validação Zod na borda;
- regras financeiras em funções determinísticas, fora de handlers e do LLM;
- funções pequenas, retorno explícito e erros compreensíveis para o usuário.

Exemplo no estilo vigente do projeto:

```ts
export const amountCentsSchema = z.number({
  required_error: "Valor é obrigatório",
  invalid_type_error: "Valor inválido",
}).int("Valor inválido").positive("Valor deve ser maior que zero").max(
  9_999_999,
  "Valor máximo é R$ 99.999,99",
);
```

## Estratégia de testes

O detalhamento dos cenários está em [Plano de testes](#plano-de-testes). O gate
mínimo será:

- **unidade:** cálculos de total, recebido, pendente e estados derivados, com
  todos os ramos de invariantes financeiras exercitados;
- **integração:** transações, concorrência, idempotência, constraints,
  isolamento por `provider_id`, RLS e permissões explícitas;
- **orquestrador/WhatsApp:** roteamento entre Serviços e Vendas, confirmação,
  expiração, repetição de webhook e nenhuma persistência por interpretação
  direta do modelo;
- **web:** estados vazio/carregando/erro, criação, consulta, correção, anulação,
  acessibilidade e viewport móvel;
- **não regressão:** saída do Financeiro e CSV idêntica para contas sem vendas;
- **aceite:** os 18 casos enumerados nesta spec precisam passar.

Não há meta percentual de cobertura configurada hoje. A exigência é cobertura
comportamental: toda regra de negócio nova, falha esperada e caso de aceite deve
ter teste automatizado no nível mais baixo que forneça confiança suficiente.

## Limites de execução

### Sempre fazer

- validar entradas na borda e recalcular totais financeiros no backend;
- derivar o prestador da autenticação, nunca de `provider_id` enviado pelo
  cliente;
- criar mudanças de banco em migração versionada gerada pela CLI;
- habilitar RLS e declarar `GRANT`/`REVOKE` explicitamente na mesma migração;
- testar isolamento, concorrência, idempotência e não regressão de Serviços;
- exigir confirmação explícita antes de toda escrita originada no WhatsApp;
- atualizar esta spec antes de implementar qualquer mudança de decisão.

### Perguntar antes

- ampliar o escopo além de pedido, venda, entrada, saldo e recebimento;
- alterar tabelas ou semântica existentes de cobranças e pagamentos;
- adicionar dependências, serviços externos, templates proativos ou custos;
- mudar autenticação, CI, deploy, retenção de dados ou contratos públicos;
- expor tabelas novas diretamente ao navegador ou à Data API do Supabase.

### Nunca fazer

- enviar segredos, chave `service_role` ou conexão PostgreSQL ao navegador;
- autorizar por `user_metadata` editável ou apenas pelo papel `authenticated`;
- criar tabela exposta sem RLS e sem política de propriedade por prestador;
- usar `SECURITY DEFINER` para contornar autorização;
- enviar dados financeiros ou pessoais ao LLM;
- aceitar pagamento acima do saldo, duplicar recebimentos ou apagar histórico;
- chamar resultado de "lucro", "sobrou" ou "saldo do dia" sem registrar saídas;
- incluir estoque, fiscal, juros, parcelas ou múltiplos caixas por antecipação.

## Critérios de sucesso

### Para autorizar o planejamento técnico

- esta spec cobre objetivo, stack, comandos, estrutura, estilo, testes, limites
  e critérios de aceite;
- as decisões fechadas e o escopo explicitamente excluído foram aprovados;
- perguntas de descoberta estão classificadas como gates, não como decisões
  silenciosas de implementação.

### Para autorizar a implementação

- o gate zero declarou, com evidência, o ramo A, B ou C;
- somente o ramo A permite executar este MVP como especificado;
- a Fase 0 confirmou linguagem, comportamento de registro, frequência de saldo
  posterior, ICP e economia unitária;
- o conjunto de avaliação do assistente está congelado;
- API, invariantes e concorrência foram detalhadas e aprovadas no plano.

### Para considerar o MVP pronto

- o ciclo pedido → entrada → valor a receber → recebimento funciona via
  WhatsApp e web;
- contas híbridas preservam Serviços e usam o mesmo número;
- venda à vista aceita cliente e produto opcionais; saldo ou entrega exige
  cliente;
- vencimento é opcional e ausência de data nunca produz atraso;
- totais de vendido, recebido e a receber são distintos e verificáveis;
- nenhuma corrida ou repetição gera pagamento acima do saldo ou duplicidade;
- vendas entram no Financeiro uma única vez e contas sem vendas não mudam;
- isolamento, RLS, permissões, auditoria e os 18 casos de aceite passam;
- o piloto produz evidência explícita para continuar, ajustar ou encerrar.

## Questões abertas

As perguntas em [Perguntas abertas para descoberta](#perguntas-abertas-para-descoberta)
não bloqueiam a aprovação desta spec, mas bloqueiam a Fase 1 quando relacionadas
a preço, comportamento, linguagem, frequência de saldo posterior, ICP ou
economia unitária. Nenhuma delas pode ser respondida silenciosamente durante a
implementação.

## Resumo executivo

Criar uma vertical do Prestou para o **vendedor independente multicanal** que
trabalha sozinho, vende presencialmente e pelo WhatsApp, tem catálogo pequeno e
recebe parte na hora e parte depois. O produto ajuda a registrar pedidos,
lembrar o que entregar, saber quem ainda deve e cobrar o saldo — sem virar PDV.

A vertical reutiliza cadastro, número de WhatsApp, identidade do prestador,
infraestrutura financeira e Dashboard do Prestou. Cobranças e vendas continuam
domínios separados.

> **Promessa inicial:** anote o pedido pelo WhatsApp, saiba quem ainda precisa
> pagar e cobre o saldo sem procurar em conversas.

O MVP é deliberadamente menor que a v1 deste plano. O wedge é **pedido → saldo →
recebimento**. Tudo que não serve a esse ciclo saiu do MVP e volta por evidência
do piloto, não por antecipação.

## Pré-condição: gate zero

Este plano assume um plano individual entre R$ 14,90 e R$ 29,90. Essa premissa
**nunca foi testada** — o Prestou não tem hoje nenhuma infraestrutura de
cobrança, e nenhum usuário de Serviços jamais pagou nada.

Enquanto isso não for respondido, a Fase 1 não abre. O teste está desenhado em
[`teste-disposicao-de-pagamento.md`](./teste-disposicao-de-pagamento.md), leva
cerca de três semanas e não exige nada desta vertical.

O resultado dele não decide apenas se esta vertical acontece — decide qual
versão dela acontece:

- **Ramo A**, a assinatura converte: este plano segue como está;
- **Ramo B**, não converte porque falta valor: Vendas não resolve; o caminho é
  aprofundar Serviços ou subir o ICP;
- **Ramo C**, não converte apesar do valor: Vendas fica **mais** importante,
  porque monetizar fluxo exige volume transacionado — mas então o princípio
  "sem taxa por venda" precisa ser revisto antes de construir.

## Mudanças em relação à v1

Esta versão mantém a modelagem de domínio da v1, que estava correta, e ataca
tamanho de escopo, método de validação e decisões deixadas em aberto.

**Cortes de escopo:**

| Item | v1 | v2 | Motivo |
|---|---|---|---|
| `daily_closings` e fechamento | no MVP | fora | O próprio plano classifica fechamento como loop secundário; a tabela custa uma cascata de invalidação em todo caminho de edição |
| `business_expenses` | no MVP | fora | Não pertence ao wedge; sem gastos, "saldo do dia" some — e com ele a maior fonte de confusão com lucro |
| `estimated_unit_cost_cents` | colunas em `products` e `sale_items` | fora | O MVP proíbe exibir margem; a coluna só convida a usar |
| "Saldo do dia" | métrica central do fechamento | fora | Sem gastos registrados, o número seria enganoso |

**Decisões que a v1 deixou como "ou" e aqui estão fechadas:**

- estado pendente do WhatsApp: **uma linha por prestador com discriminador de
  domínio**, nunca duas tabelas paralelas (ver [Estado e idempotência](#estado-e-idempotência));
- auditoria: **estender a trilha financeira existente**, não criar trilha nova;
- convenção de enum: **inglês para colunas novas**, exceto `payment_method`, que
  reusa o conjunto já existente no schema.

**Regras relaxadas por fricção:**

- `payment_due_date` passa a ser **opcional**. Saldo sem data combinada é o caso
  comum no ICP e não pode bloquear o fluxo primário.

**Regras adicionadas:**

- devolução tratada por anulação com motivo, em vez de "o suporte corrige";
- economia unitária calculada **antes** da Fase 1, não medida no piloto;
- conjunto de avaliação do assistente vira entregável da Fase 0;
- gates com n=12 passam a ser critérios de evidência em números absolutos.

**Correções:**

- gate da Fase 3 que dizia "retenção motivada pelo fechamento" contradizia a
  seção de retenção da própria v1; corrigido;
- tamanho do beachhead ajustado para excluir revendedores monomarca;
- citações de mercado marcadas com ano e nível de confiança.

## Decisões recomendadas

1. Usar o **mesmo número de WhatsApp** do Prestou para Serviços e Vendas.
2. Identificar o usuário pelo número verificado já associado ao `provider`.
3. Perguntar no onboarding se ele trabalha com serviços, vendas ou ambos.
4. Manter vendas fora das tabelas de cobranças e pagamentos.
5. Integrar vendas ao Financeiro como nova origem, sem cópia em
   `manual_receipts`.
6. O MVP é pedido, recebimento e saldo. Fechamento, gastos, estoque e margem
   ficam fora até o piloto pedir.
7. Não exibir nenhum número chamado "saldo", "sobrou" ou "lucro" enquanto não
   houver registro de saídas.
8. Toda escrita pelo WhatsApp produz proposta explícita e exige confirmação.
9. Permitir registro agregado; o vendedor não deve interromper cada atendimento.
10. No piloto, o assistente administrativo atende somente números de vendedores
    verificados.
11. Tratar **entrada + saldo a receber** como capacidade essencial, sem alterar a
    regra de parcelas das cobranças de Serviços.
12. Cliente é opcional na venda integralmente recebida e obrigatório quando
    houver entrega futura ou saldo.
13. Separar estado de entrega e estado de pagamento.
14. Produto continua opcional; ausência de catálogo nunca bloqueia registro.
15. Vencimento do saldo é opcional; sem data, a venda entra em "Para receber" e
    nunca em "Em atraso".

## Contexto e oportunidade

O Prestou resolve cobranças de serviços via Pix, acompanhamento de quem deve,
lembretes e confirmação de pagamento. Para o ICP recomendado, parte do dinheiro
entra na hora e parte depois da encomenda ou entrega. O link deixa de ser o
centro da experiência, mas segue útil para cobrar o saldo sem transformar o
Prestou em intermediador financeiro.

O trabalho principal desse vendedor:

1. registrar rapidamente o que cada cliente pediu;
2. lembrar o que precisa entregar;
3. saber quem pagou, quem deu entrada e quem ainda deve;
4. cobrar o saldo sem procurar informação em várias conversas;
5. distinguir o que vendeu do dinheiro que realmente entrou;
6. separar Pix, dinheiro, cartão e outras formas;
7. acompanhar se a semana está melhor ou pior.

Registrar gastos, separar dinheiro pessoal e entender margem são trabalhos
reais desse usuário, mas não são o wedge — e estão fora do MVP.

A base já implementada reduz o custo de testar:

- identidade e onboarding por WhatsApp;
- assistente bidirecional com orquestrador agnóstico de canal;
- confirmação persistida de ações de escrita;
- guardrails de custo, abuso, duplicidade e concorrência;
- pagamentos em Pix, dinheiro, cartão, transferência e outro;
- Financeiro mensal por regime de caixa;
- receitas avulsas e auditoria financeira;
- autenticação, API, PostgreSQL e Storage no Supabase;
- geração própria de BR Code Pix.

## Tese de mercado e escolha do beachhead

| Segmento | Tamanho direcional | Ano do dado | Aderência | Complexidade competitiva |
|---|---:|---|---|---|
| Venda direta / porta a porta | ~3 milhões (bruto) | 2024 | muito alta | média |
| Venda direta **multimarca ou independente** | fração a estimar na Fase 0 | — | muito alta | baixa |
| Ambulantes | 1,0–1,3 milhão | 2017 | média | média |
| Empresas comerciais | até 1,5 milhão | 2023 | baixa–média | muito alta |

**O número que importa não é 3 milhões.** Revendedores monomarca de grandes
marcas já têm aplicativo próprio que registra pedido e, às vezes, entrega. Para
esses, o Prestou só agrega na parte de recebimento e saldo — uma proposta bem
mais fraca. O beachhead real é o subconjunto multimarca, independente ou de
marcas pequenas sem app. **Estimar essa fração é objetivo explícito da Fase 0**,
e o número ajustado deve substituir os 3 milhões em qualquer material posterior.

As categorias não são mutuamente exclusivas e os números não devem ser somados.

Fontes:

- [ABEVD — força de vendas e uso de WhatsApp](https://www.abevd.org.br/como-a-humanizacao-move-r-50-bilhoes-na-venda-direta-brasileira/);
- [ABEVD — desempenho da venda direta em 2024](https://www.abevd.org.br/venda-direta-movimenta-r-50-bilhoes-em-2024-e-segue-em-expansao/);
- [IBGE — comércio ambulante](https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/20769-comercio-ambulante-como-alternativa-de-ganhar-a-vida);
- [IBGE — Pesquisa Anual de Comércio 2023](https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/44145-ocupacao-no-comercio-cresce-pelo-terceiro-ano-seguido-e-chega-a-10-5-milhoes-de-pessoas).

> **Pendência de precisão:** o valor de 1,5 milhão de empresas comerciais está
> atribuído à PAC 2023, mas a matéria citada trata de pessoas ocupadas no
> comércio (10,5 milhões). Confirmar a fonte correta ou remover o número.

### Por que esse ICP primeiro

1. **Reutiliza o diferencial atual:** cliente, Pix, cobrança e confirmação de
   pagamento já existem.
2. **WhatsApp é canal de trabalho:** sem rotina nova para aprender.
3. **Há dois momentos de valor:** organizar o pedido e recuperar o saldo.
4. **Cliente é identificável:** permite histórico, recorrência e cobrança.
5. **Operação simples:** um decisor, um número, catálogo curto.
6. **Diferenciação defensável:** a continuidade entre pedido, recebimento e
   cobrança, não catálogo ou estoque.

### Por que não os adjacentes

- **Venda anônima e acelerada:** usa caixa, mas quase nada do diferencial de
  clientes e cobrança; menor disposição de pagar.
- **Pequena loja:** paga mais, mas exige venda rápida, estoque, fiscal, múltiplos
  usuários e maquininha. Compete com PDVs consolidados.
- **Ambulante relacional:** permanece no ICP quando recebe encomendas, usa
  WhatsApp e vende com pagamento posterior.

## Público inicial

### Segmento do piloto

Vendedores independentes multicanal que:

- vendem catálogo pequeno e repetitivo;
- trabalham sozinhos;
- usam WhatsApp diariamente;
- atendem presencialmente e pelo WhatsApp;
- têm clientes recorrentes ou identificáveis;
- misturam pronta entrega, encomenda e pagamento posterior;
- recebem por Pix e dinheiro;
- hoje controlam de memória, em papel ou em mensagens para si mesmos;
- não usam ERP ou PDV;
- decidem sozinhos adotar e pagar.

### Critérios operacionais do ICP

| Dimensão | Faixa ou comportamento |
|---|---|
| Estrutura | titular sozinho ou com ajuda familiar informal |
| Catálogo | ~1–50 produtos recorrentes; cadastro opcional |
| Volume | hipótese inicial de 20–100 vendas ou pedidos por mês |
| Clientes | parte recorrente e identificável por nome e WhatsApp |
| Canais | presencial + WhatsApp |
| Recebimento | Pix e dinheiro; parte à vista e parte depois |
| Controle atual | memória, caderno, planilha ou conversa consigo mesmo |
| Marca | multimarca, independente ou marca sem aplicativo próprio |
| Decisão | o próprio vendedor escolhe e usa |
| Fiscal | não depende de emissão fiscal no MVP |

As faixas são hipóteses de descoberta, não regras de elegibilidade.

### Score de aderência

Pontuar de 0 a 2: usa WhatsApp para receber pedidos; vende presencialmente; tem
clientes recorrentes; recebe parte depois; controla manualmente; trabalha
sozinho; catálogo pequeno; aceita Pix; decide pela adoção; sente perda de tempo,
esquecimento ou atraso.

- **16–20 — fit alto:** candidato principal;
- **11–15 — fit médio:** persona adjacente para contraste;
- **0–10 — fit baixo:** não orientar o MVP por suas necessidades.

### Personas

**Central — revendedor relacional.** Vende cosméticos, roupas, acessórios ou
produtos domésticos; conversa antes e depois da venda; recebe entrada e cobra
saldo na entrega; hoje procura pedidos em conversas diferentes; valoriza saber
quem ainda precisa pagar.

**Adjacente — ambulante relacional.** Circula por feira, praia, escritórios ou
eventos; tem fregueses recorrentes; recebe encomendas pelo WhatsApp; a maioria
das vendas é à vista, mas algumas ficam para depois.

**Adjacente — pequena loja de uma pessoa.** Ponto fixo, um operador; só entra se
não exigir código de barras, fiscal ou múltiplos caixas.

**Anti-persona — venda anônima de alta velocidade.** Transações de segundos,
cliente não identificado, tudo pago na hora. Registrar custa mais que o
benefício.

### Fora do segmento inicial

Lojas com múltiplos caixas ou funcionários; restaurantes com comandas;
negócios que precisam de emissão fiscal; crediário com parcelas, juros ou
renegociação; cobrança de terceiros; catálogo com variações complexas;
integração obrigatória com maquininha, banco ou marketplace; controle contábil.

## Hipóteses a validar

**Problema.** O vendedor perde contexto entre conversas, pedidos, entregas e
pagamentos. Não sabe com confiança o que precisa entregar nem quem ainda deve.

**Comportamento.** Ele aceita registrar pedidos relevantes no momento em que
negocia pelo WhatsApp, e vendas à vista em lote no fim do período. Não registra
cada transação presencial se isso exigir vários campos ou abrir o Dashboard.

**Canal.** O mesmo WhatsApp reduz treinamento e aumenta recorrência. O Dashboard
serve para conferência e correção, não para o registro cotidiano.

**Valor.** O primeiro valor percebido é não esquecer pedidos e saldos a cobrar.
Estoque, lucro e fechamento não são o wedge.

### Riscos das hipóteses

- o vendedor pode considerar qualquer registro manual trabalhoso;
- vendas em dinheiro podem ser esquecidas mais que vendas Pix;
- vendedores podem preferir olhar o extrato bancário;
- aplicativos de marca podem já registrar parte dos pedidos;
- o vendedor pode evitar cadastrar clientes por achar invasivo;
- "entrada" pode ser confundida com quitação;
- cobrar saldos pode causar desconforto e o usuário pode não enviar nada.

## Jobs to be done

### Principal

> Quando combino uma venda presencialmente ou pelo WhatsApp, quero registrar o
> pedido, o que já recebi e o que falta receber, para entregar corretamente e
> cobrar sem constrangimento.

### Secundários no MVP

Registrar pedido para entrega futura; registrar venda integralmente paga;
registrar entrada e saldo; encontrar quem ainda deve; enviar cobrança do saldo
com Pix; registrar várias vendas à vista de uma vez; corrigir lançamento sem
perder histórico; separar "vendido" de "recebido"; consultar resultado do dia,
semana e mês; usar Serviços e Vendas no mesmo cadastro.

### Reconhecidos e fora do MVP

Registrar gastos do negócio; não misturar caixa com dinheiro pessoal; conferir
dinheiro físico contra o informado; entender margem e reposição. Aparecem como
demanda medida, não como funcionalidade.

> **Limite honesto:** a maioria dos vendedores usa a mesma chave Pix para vida
> pessoal e negócio (pergunta aberta #9). Enquanto isso for verdade, o Prestou
> **não resolve** separação de dinheiro pessoal, e isso não deve ser comunicado
> como benefício.

## Princípios de produto

1. **Pendências antes de estoque.**
2. **Lote antes de venda unitária:** aceitar "vendi R$ 180 hoje".
3. **Pedido e recebimento são fatos diferentes:** vender R$ 100 e receber R$ 30
   cria R$ 70 a receber; não cria R$ 100 no caixa.
4. **Nenhum número de resultado sem as duas pontas:** enquanto não houver
   saídas registradas, não existe "saldo", "sobrou" nem "lucro".
5. **WhatsApp para registrar, Dashboard para conferir.**
6. **Uma fonte da verdade:** não duplicar a mesma venda em dois lugares.
7. **Números explicáveis:** todo total abre os lançamentos que o compõem.
8. **Correção auditável:** alterações e exclusões são lógicas e registradas.
9. **Cobrança como instrumento:** a venda é o fato comercial; a cobrança é meio
   operacional de receber o saldo.
10. **Confirmação proporcional ao risco:** toda escrita mostra cliente, data,
    total, recebido e saldo antes de executar.
11. **Sem crédito sofisticado:** um saldo por venda; parcelas, juros e
    renegociação ficam fora.
12. **Linguagem cotidiana:** "vendeu", "recebeu", "falta receber".

## Posicionamento das verticais

| Prestou Serviços | Prestou Vendas |
|---|---|
| "Cobre e acompanhe quem deve" | "Organize pedidos, recebimentos e saldos" |
| Recebimento pode acontecer depois | Na hora, em parte ou depois |
| Cliente é obrigatório | Opcional à vista, obrigatório com saldo |
| Vencimento e status são centrais | Pedido, entrega, recebido e saldo são centrais |
| Link e lembrete têm valor | Mensagem e Pix apoiam a cobrança do saldo |
| Pergunta: quem me deve? | Perguntas: o que entregar e quem me deve? |

O nome e a conta permanecem únicos. "Serviços" e "Vendas" são modos do produto,
não aplicativos ou números diferentes.

## Escopo do MVP

### Incluído

- modo `services`, `sales` ou `hybrid` no perfil;
- mesmo número de WhatsApp para as duas verticais;
- catálogo opcional e pequeno;
- registro agregado, venda à vista ou pedido detalhado;
- cliente opcional à vista e obrigatório para entrega ou saldo;
- entrada e um saldo a receber por venda, com vencimento opcional;
- cobrança Pix do saldo, preparada e enviada manualmente;
- registro de recebimento posterior;
- estado de entrega separado do estado de pagamento;
- múltiplas formas de pagamento na mesma venda;
- anulação com motivo, incluindo devolução;
- resumo diário, semanal e mensal calculado sob demanda;
- correção e exclusão lógica com auditoria;
- página Vendas no Dashboard;
- integração das entradas com o Financeiro;
- eventos de funil e métricas de qualidade do assistente.

### Explicitamente fora do MVP

- **fechamento diário persistido** (`daily_closings`, `needs_review`);
- **registro de gastos** e qualquer métrica de saldo de caixa da vertical;
- **custo de mercadoria**, CMV, margem ou lucro;
- estoque em tempo real e alerta de reposição;
- parcelário, juros, multa, renegociação e limite de crédito;
- várias datas futuras de pagamento para a mesma venda;
- integração com banco, Open Finance ou maquininha;
- emissão fiscal;
- múltiplos vendedores, caixas ou lojas;
- leitor de código de barras e impressão de recibo;
- fidelidade, e-commerce ou link de compra;
- áudio;
- lembretes proativos.

Quando o usuário pedir algo desta lista pelo WhatsApp, a resposta é um "ainda
não faço isso" registrado como sinal de demanda. **Essa é a instrumentação que
decide a Fase 4** — não a intuição do time.

## Experiência proposta

### 1. Escolha de modo

No onboarding e nas Configurações:

> Como você trabalha?
>
> - Presto serviços
> - Vendo produtos
> - Faço os dois

Contas existentes migram como `services`. Mudar depois não apaga nem transforma
dados. O modo configura navegação, sugestões e intenções prioritárias.

### 2. Primeira configuração de Vendas

Pedir somente:

- como vende: presencial, WhatsApp ou ambos;
- se costuma receber tudo na hora, entrada + saldo ou depois;
- produtos mais frequentes, opcionalmente com preço.

Não bloquear a primeira venda por falta de catálogo. A meta de ativação é chegar
a uma proposta correta de venda em menos de cinco minutos após confirmar o
número.

### 3. Registro de venda pelo WhatsApp

Entradas aceitas:

> Vendi R$ 180 hoje, 120 no Pix e 60 em dinheiro.

> Vendi 12 águas a 5 reais no Pix.

> A Maria pediu dois kits de R$ 40. Pagou R$ 30 no Pix e vai pagar o resto na
> sexta.

> Separei uma bolsa de R$ 120 para a Ana entregar amanhã. Ela ainda não pagou.

Resposta antes de persistir:

> Registrar venda de hoje?
>
> Total: R$ 180,00<br>
> Pix: R$ 120,00<br>
> Dinheiro: R$ 60,00
>
> [Confirmar] [Corrigir] [Cancelar]

Com saldo e data:

> Registrar pedido da Maria?
>
> Total vendido: R$ 80,00<br>
> Recebido agora: R$ 30,00 no Pix<br>
> Falta receber: R$ 50,00 até 31/07<br>
> Entrega: pendente
>
> [Confirmar] [Corrigir] [Cancelar]

Com saldo e sem data:

> Falta receber: R$ 50,00 — sem data combinada

Regras:

- aceitar venda total sem produto;
- aceitar um ou vários produtos;
- permitir uma ou várias formas de pagamento;
- permitir soma recebida entre zero e o total;
- exigir cliente quando houver saldo ou entrega pendente;
- **não** exigir vencimento; perguntar no máximo uma vez e aceitar "não sei";
- impedir recebimento acima do total;
- diferenciar data da venda, data esperada de entrega e data de recebimento;
- quando preço ou quantidade forem ambíguos, perguntar em vez de inferir;
- usar `America/Sao_Paulo` para datas civis;
- deduplicar pelo ID da mensagem inbound e pela proposta confirmada.

### 4. Recebimento posterior e cobrança do saldo

> A Maria pagou os R$ 50 que faltavam no Pix.

> Quem ainda está me devendo?

> Preparar cobrança do saldo da Ana.

Regras:

- resolver cliente e venda no backend; o LLM nunca escolhe IDs;
- se houver mais de uma venda em aberto para o cliente, perguntar qual;
- registrar somente após confirmação explícita;
- o recebimento usa sua data efetiva e forma de pagamento;
- o saldo é derivado do total menos recebimentos ativos;
- quando o saldo chega a zero, o estado passa a `paid`;
- uma mensagem com Pix Copia e Cola pode ser preparada para o saldo atual;
- o vendedor envia manualmente e confirma quando o dinheiro entrar;
- corrigir ou excluir um recebimento recalcula o saldo e mantém auditoria.

### 5. Produto opcional

> Vendi R$ 100 no Pix.

A venda recebe um item descritivo sem `product_id`. Compõe todos os totais
financeiros. Sem produto não há ranking por item nem quantidade.

Depois de descrições recorrentes, o assistente pode sugerir:

> Você mencionou "kit de sabonetes" algumas vezes. Quer salvar como produto por
> R$ 35?

Nunca criar produto silenciosamente nem bloquear venda por catálogo vazio.

### 6. Devolução e cancelamento

Devolução é rotina em cosméticos e roupas — as duas primeiras categorias da
persona central. Tratá-la como "o suporte corrige no banco" contamina a métrica
de suporte manual e arrisca as invariantes.

No MVP:

> A Ana devolveu a bolsa, vou devolver os R$ 120.

Anula a venda e seus recebimentos ativos na mesma transação, com
`voided_reason = 'devolucao'`. Os valores saem dos totais a partir da anulação;
o histórico permanece. Não há estorno parcial nem devolução de item isolado —
essas transições continuam bloqueadas, e a frequência com que forem pedidas é
medida.

### 7. Consultas pelo WhatsApp

- "Quanto vendi hoje?"
- "Quanto eu realmente recebi hoje?"
- "Quem ainda precisa pagar?"
- "O que preciso entregar amanhã?"
- "Quanto a Maria ainda deve?"
- "Quanto entrou no Pix esta semana?"
- "Quais vendas registrei hoje?"

"Quanto lucrei?" e "Quanto sobrou?" respondem com transparência, sem inventar
um número de resultado:

> Ainda não consigo calcular isso: eu registro o que entra, mas não o que você
> gasta. Hoje você vendeu R$ X e recebeu R$ Y, e falta receber R$ Z.

Cada ocorrência é contada como demanda por registro de gastos.

### 8. Área Vendas no Dashboard

- listas "Para entregar" e "Para receber" **acima** do resumo;
- resumo de hoje: vendido, recebido e a receber;
- divisão por forma de pagamento;
- vendas concluídas;
- detalhe por cliente com histórico de pedidos e recebimentos;
- ação de preparar cobrança do saldo;
- adicionar, corrigir e excluir logicamente;
- navegação por dia;
- produtos frequentes;
- acesso ao Financeiro mensal;
- estado de dados incompletos;
- modo simples para quem não usa catálogo.

Para usuários híbridos, a navegação mostra "Cobranças", "Vendas" e "Financeiro".
Para usuários de uma vertical, a área principal abre no modo escolhido.

## Modelo de domínio proposto

Direção para implementação. Nomes e constraints devem ser fechados numa spec de
API antes da migração.

**Convenção de enum:** colunas novas usam valores em inglês. A exceção é
`payment_method`, que reusa o conjunto já existente no schema
(`pix`, `dinheiro`, `cartao`, `transferencia`, `outro`).

### Extensão de `providers`

Adicionar `business_mode`: `services`, `sales` ou `hybrid`. Padrão e backfill
`services`. Configura experiência e roteamento; nunca autoriza acesso a dados
sozinho.

### `products`

`id`; `provider_id`; `name`; `unit_label` opcional; `default_price_cents`
opcional; `active`; `created_at`; `updated_at`.

Regras: nome único entre produtos ativos do vendedor, sem diferenciar
maiúsculas; produto pode ser desativado, nunca apagado se já usado; o preço da
venda é copiado para o item, preservando histórico.

Sem coluna de custo. Ela volta na Fase 4, junto com o modelo de CMV que a
justifica.

### `sales`

Representa um pedido, uma venda à vista ou um lote agregado.

- `id`;
- `provider_id`;
- `client_id`, opcional somente quando não houver saldo nem entrega pendente;
- `sold_date`;
- `payment_due_date`, **opcional**;
- `expected_delivery_date`, opcional;
- `delivery_status`: `not_applicable`, `pending`, `delivered`, `cancelled`;
- `sales_channel`: `in_person`, `whatsapp`, `mixed`, `other`;
- `source`: `whatsapp` ou `web`;
- `note`, opcional;
- `voided_at`;
- `voided_reason`: `registration_error`, `return`, `cancellation`;
- `created_at`; `updated_at`.

O total vendido é a soma dos itens. Status financeiro e saldo são derivados dos
recebimentos ativos, nunca armazenados como segunda fonte da verdade.

Regras:

- cliente obrigatório se saldo > 0 ou `delivery_status = pending`;
- venda agregada integralmente paga pode existir sem cliente e sem produto;
- venda não pode ser editada para total inferior ao já recebido;
- estado de entrega não altera caixa nem status financeiro;
- cancelar pedido sem recebimento preserva o registro com
  `delivery_status = cancelled`;
- anular venda aplica soft delete ao cabeçalho e aos recebimentos ativos na
  mesma transação, com motivo, e grava auditoria.

### `sale_items`

`id`; `sale_id`; `product_id` opcional; `description_snapshot`; `quantity`;
`unit_price_cents` opcional; `line_total_cents`; `created_at`.

Item sem produto representa total agregado. Quantidade é inteira no MVP; venda
por peso só amplia o tipo após validação.

### `sale_payments`

`id`; `sale_id`; `provider_id` (redundante de propósito, para índice e
isolamento explícito); `received_date`; `payment_method`; `amount_cents`;
`source`; `note` opcional; `voided_at`; `created_at`; `updated_at`.

Regras:

- a soma dos pagamentos ativos fica entre zero e o total dos itens;
- a aplicação valida dentro da mesma transação;
- cada pagamento compõe o Financeiro como entrada rastreável;
- uma venda com Pix e dinheiro gera duas linhas financeiras da mesma venda,
  evitando o método ambíguo "misto";
- novos recebimentos adquirem lock da venda antes de validar o saldo;
- recebimento não pode exceder o saldo, inclusive sob concorrência;
- exclusão é lógica e pode reabrir o saldo sem apagar histórico.

### Invariantes e cálculos

```text
sold_total_cents     = soma de sale_items ativos
received_total_cents = soma de sale_payments ativos
outstanding_cents    = sold_total_cents - received_total_cents

unpaid  = received_total_cents = 0
partial = 0 < received_total_cents < sold_total_cents
paid    = received_total_cents = sold_total_cents
overdue = outstanding_cents > 0
          e payment_due_date is not null
          e payment_due_date < hoje
```

Saldo sem `payment_due_date` **nunca** é `overdue`. Ele aparece em "Para
receber" com rótulo "sem data combinada" e pode ganhar data depois.

| Ação | Entrega | Financeiro | Caixa |
|---|---|---|---|
| Criar pedido sem entrada | `pending` | `unpaid` | nenhum |
| Criar pedido com entrada | `pending` | `partial` | entrada na data efetiva |
| Marcar entregue | `delivered` | não muda | nenhum |
| Registrar saldo integral | não muda | `paid` | entrada na data efetiva |
| Corrigir recebimento | não muda | recalculado | move ou ajusta entrada |
| Excluir recebimento | não muda | recalculado | remove entrada dos totais |
| Anular por devolução | `cancelled` | anulado | remove entradas dos totais |

Estorno parcial e desconto após a venda ficam fora do MVP.

### Desempenho da carteira

O saldo não é coluna persistida: "quem me deve?" agrega `sale_payments` por
venda. Na escala do piloto (dezenas de vendedores, ~100 vendas/mês cada) isso é
irrelevante e não deve ser otimizado.

Se virar problema, a mitigação é manter `received_total_cents` desnormalizado em
`sales`, atualizado na mesma transação que já adquire lock da linha, com teste
de invariância provando igualdade com a soma. **Não implementar antes de medir.**

### Cobrança do saldo

O MVP não transforma venda em `charges` nem duplica recebimento em `payments`:

1. calcular o saldo atual no backend;
2. gerar BR Code Pix com a chave do vendedor e o valor exato;
3. preparar mensagem e `wa.me` para o cliente;
4. o vendedor envia manualmente;
5. após receber, registra o pagamento da venda.

Isso isola os domínios e preserva `sale_payments` como fonte única. A página
pública com confirmação do cliente pode vir depois, preferencialmente
generalizando "solicitação de pagamento" em vez de acoplar venda a `charges`.

### Auditoria

**Decisão:** estender a trilha financeira existente. A tabela de auditoria hoje
restringe `source_type` a `('payment', 'manual_receipt')` e `action` a
`('created', 'updated', 'voided', 'payment_reopened')`. A migração adiciona
`sale` e `sale_payment` ao primeiro conjunto.

Em qualquer caso: registrar estado anterior e posterior; manter soft delete;
não guardar texto bruto do WhatsApp na auditoria financeira; permitir rastrear
cada centavo até a origem.

### Índices e isolamento

- índices por `provider_id` + data para vendas ativas;
- índices por `sale_id` para itens e pagamentos;
- índice de vendas ativas por `provider_id` + `payment_due_date`;
- FKs compostas ou validação equivalente impedem relacionar venda, cliente e
  recebimento de vendedores diferentes;
- RLS habilitada em todas as novas tabelas de `public`;
- `anon` e `authenticated` sem acesso direto, mantendo o navegador atrás da API;
- nenhuma rota aceita `provider_id` do cliente; ele vem do JWT ou do número
  verificado;
- tabelas filhas sempre resolvidas por uma raiz do vendedor;
- `service_role` e conexão do banco continuam exclusivos da API.

Não depender da configuração de exposição automática da Data API: além de RLS,
revogar acesso direto explicitamente, como o schema atual já faz.

## Integração com o Financeiro

### Fonte da verdade

Venda confirmada não cria `manual_receipt`. O Financeiro passa a unir três
origens: pagamentos de cobranças, receitas avulsas e pagamentos de vendas. A
query atual já é um UNION das duas primeiras; a terceira é extensão.

O Pix preparado para o saldo não cria linha em `charges` nem `payments`. Quando
o vendedor registra o recebimento, a única entrada é `sale_payments`.

### Semântica

- `Recebido no mês` inclui `sale_payments` pela `received_date` efetiva;
- `A receber de vendas` usa total vendido menos recebimentos ativos;
- `Em atraso de vendas` exige saldo positivo **e** vencimento definido e
  anterior a hoje;
- a lista informa origem `Venda` e dá acesso ao registro;
- vendas com pagamentos divididos aparecem separadas por forma de pagamento;
- a soma dos itens financeiros continua exatamente igual ao total recebido;
- cards agregados de "A receber" e "Em atraso" podem somar cobranças e vendas,
  mas o detalhe sempre separa `Serviços` de `Vendas`.

**`Vendido no período` não entra no Financeiro.** O painel é de regime de caixa;
introduzir um número de competência ao lado de "Recebido" convida exatamente à
confusão que o resto do plano evita. "Vendido" vive apenas na área Vendas, com
data própria, e nunca soma com "Recebido" em nenhuma superfície.

### Não regressão

Feature flag protege o domínio de Vendas, mas o Financeiro é código
compartilhado. O contrato de não regressão é verificável:

> Para um provider sem nenhuma venda, toda resposta do Financeiro e todo CSV
> exportado são idênticos ao comportamento anterior, campo a campo.

Isso é um teste, não uma intenção.

### Exportação

Evoluir o CSV para identificar a origem `venda`, preservando proteção contra
fórmulas e totais conferíveis. Sem coluna de saída enquanto não houver gastos.

## WhatsApp: um número, dois domínios

### Roteamento

Após validar a assinatura da Meta e resolver o `provider` pelo número:

1. carregar `business_mode`;
2. verificar rascunho ou proposta pendente;
3. interpretar a intenção;
4. restringir ferramentas às capacidades habilitadas;
5. executar consulta ou criar proposta de escrita;
6. renderizar texto e botões no mesmo canal.

### Estado e idempotência

**Decisão fechada.** Hoje existe `whatsapp_pending_charges` com **PK em
`provider_id`** — um rascunho vivo por prestador. Criar uma segunda tabela
paralela com a mesma chave permitiria dois rascunhos simultâneos no mesmo
número, e um "sim" seco voltaria a ser ambíguo — exatamente o problema que a
desambiguação híbrida tenta resolver.

A migração generaliza a tabela existente para `whatsapp_pending_drafts`,
mantendo `provider_id` como PK e acrescentando `domain` (`charge` | `sale`) e
`intent`. O invariante é: **no máximo um rascunho vivo por prestador, qualquer
que seja o domínio**. Abrir um rascunho de venda substitui um rascunho de
cobrança pendente, e o assistente avisa.

Além disso:

- `assistant_action_proposals.tool` tem CHECK que enumera as ferramentas; cada
  intenção de escrita nova exige alteração dessa constraint na migração;
- uma mensagem inbound aceita no máximo uma ação persistida;
- o ID da mensagem Meta é a chave de deduplicação;
- confirmação referencia um `proposalId` específico;
- propostas expiram, têm uso único e são escopadas por vendedor e canal;
- a transação grava cabeçalho, itens, recebimentos e evento atomicamente;
- reprocessar o webhook devolve o mesmo resultado sem duplicar a venda.

### Ambiguidade no modo híbrido

"Recebi 100 da Maria" não deve ser classificado à força:

> Foi o pagamento de um serviço ou de uma venda? Se foi venda, qual pedido da
> Maria?

Enquanto houver rascunho ou proposta pendente, a resposta é interpretada naquele
contexto, sem trocar de domínio silenciosamente.

### Intenções

| Intenção | Tipo | Confirmação |
|---|---|---|
| `registrar_venda` | escrita | obrigatória |
| `registrar_pedido` | escrita | obrigatória |
| `registrar_recebimento_venda` | escrita financeira | obrigatória |
| `marcar_entrega` | escrita | obrigatória |
| `preparar_cobranca_saldo` | leitura com geração Pix | não persiste |
| `corrigir_venda` | escrita | obrigatória |
| `anular_venda` | escrita | obrigatória |
| `resumo_vendas` | leitura | não |
| `listar_vendas` | leitura | não |
| `listar_saldos_vendas` | leitura | não |
| `listar_entregas_pendentes` | leitura | não |
| `status_venda_cliente` | leitura | não |
| `gerenciar_produto` | escrita | obrigatória |

São 13 intenções novas, contra 18 na v1 — a diferença são gastos e fechamento.

O LLM interpreta intenção e extrai argumentos, mas não consulta o banco, não
calcula totais oficiais e não executa escrita. Produtos são resolvidos no
backend por nome normalizado; ambiguidade gera pergunta. Dados financeiros e o
catálogo completo não vão ao modelo.

### Classificação: roteamento em dois estágios

O orquestrador atual resolve ~5 intenções num `switch` sobre uma única
chamada de função. Passar para 18 intenções num classificador só degrada
precisão justamente onde o gate exige 90%.

Desenho proposto:

1. **Estágio 1 — domínio.** Determinístico quando possível: `business_mode`
   resolve sozinho para contas `services` e `sales`. Só contas `hybrid` chegam
   ao estágio de desambiguação.
2. **Estágio 2 — intenção dentro do domínio.** O schema apresentado ao modelo
   contém apenas as intenções daquele domínio: no máximo 13, nunca 18.

Isso mantém o custo e a precisão do caso `sales` puro próximos do que já existe
hoje para `services`, e concentra a dificuldade nas contas híbridas — que são
minoria mensurável.

### Conjunto de avaliação — entregável da Fase 0

O gate de 90% não é verificável sem instrumento. A Fase 0 produz:

- ≥200 mensagens reais anonimizadas, coletadas no concierge;
- rótulo de intenção esperada e slots esperados para cada uma;
- inclusão deliberada de mensagens incompletas, contraditórias, com dois
  pedidos, com valor por extenso e com nome ambíguo;
- congelamento antes da Fase 2 começar; casos novos vão para um segundo
  conjunto, para não contaminar a medição.

Sem esse conjunto congelado, a Fase 2 não abre.

### Janela de atendimento

Mensagens iniciadas pelo vendedor usam a janela de 24 horas da Meta. Como não
há lembrete proativo no MVP, o piloto **não depende de template aprovado** — o
que também mantém o custo de mensageria próximo de zero.

## Contratos de API candidatos

Todos autenticados, com o vendedor derivado do JWT.

### Perfil

- `PATCH /api/provider/business-mode`

### Produtos

- `GET /api/sales/products`
- `POST /api/sales/products`
- `PATCH /api/sales/products/:id`
- `DELETE /api/sales/products/:id` — desativa quando já utilizado

### Vendas

- `GET /api/sales?date=AAAA-MM-DD&clientId=&paymentStatus=&deliveryStatus=`
- `POST /api/sales`
- `GET /api/sales/:id`
- `PATCH /api/sales/:id`
- `DELETE /api/sales/:id` — soft delete, exige `reason`
- `POST /api/sales/:id/payments`
- `PATCH /api/sales/:saleId/payments/:paymentId`
- `DELETE /api/sales/:saleId/payments/:paymentId` — soft delete
- `POST /api/sales/:id/mark-delivered`
- `POST /api/sales/:id/prepare-balance-pix`
- `GET /api/sales/receivables?status=open|overdue|undated&clientId=`
- `GET /api/sales/daily-summary?date=AAAA-MM-DD` — cálculo sob demanda, sem
  persistência

Não existem rotas de gastos nem de fechamento no MVP.

Clientes existentes são reutilizados. A criação de venda aceita `clientId` ou
nome + WhatsApp, e o serviço de domínio resolve ou cria o cliente com as mesmas
garantias de isolamento das cobranças.

### Regras de contrato

- valores inteiros em centavos;
- datas civis `AAAA-MM-DD` no fuso `America/Sao_Paulo`;
- validação Zod na borda;
- limite de itens e pagamentos por request;
- transações atômicas para vendas;
- soma recebida maior que o total retorna conflito sem persistir;
- venda com saldo sem cliente é rejeitada;
- venda com saldo **sem vencimento é aceita** e listada como `undated`;
- `paymentStatus` é calculado, nunca aceito em escrita;
- respostas nunca expõem IDs ou dados de outro vendedor;
- escrita originada no WhatsApp chama o mesmo serviço de domínio das rotas;
- endpoints de criação aceitam chave de idempotência;
- erros de ambiguidade são recuperáveis e não persistem dados parciais.

Antes de implementar, criar uma spec própria com exemplos completos de request,
response, erros e invariantes, seguindo o padrão de
[`api-financeiro-caixa.md`](./api-financeiro-caixa.md).

## Arquitetura e pontos de mudança

### Banco e migrações

- criar cada migração com `supabase migration new`, sem inventar timestamp;
- separar fundação da vertical, generalização do rascunho e integração
  financeira, para facilitar rollback e revisão;
- aplicar RLS, revokes, constraints e índices na mesma migração das tabelas;
- alterar o CHECK de `source_type` da auditoria financeira e o de `tool` em
  `assistant_action_proposals` junto das intenções que os exigem;
- testar backfill de `business_mode` com contas existentes;
- rodar advisors e revisar segurança antes de promover;
- não usar extensões novas.

### API

- `apps/api/src/routes/sales.ts`;
- `apps/api/src/sales.ts` para regras e transações;
- `apps/api/src/sale-payments.ts` para recebimentos e concorrência;
- `apps/api/src/sales-receivables.ts` para saldos e Pix;
- `apps/api/src/sales-summary.ts` para cálculos puros;
- extensão de `apps/api/src/orchestrator.ts` com o roteamento em dois estágios;
- extensão de `apps/api/src/llm.ts` para schema de ferramenta por domínio;
- extensão de `apps/api/src/assistant-data.ts`;
- generalização de `apps/api/src/charge-memory.ts` para rascunho por domínio;
- integração em `apps/api/src/routes/financial.ts`;
- tipos compartilhados em `apps/api/src/types.ts`;
- registro das rotas em `apps/api/src/server.ts`.

Separar interpretação, regra de domínio e persistência. O orquestrador não
constrói SQL nem recalcula totais que pertencem ao serviço de vendas.

### Web

- `apps/web/src/pages/Sales.tsx`;
- formulários de venda e produto;
- listas de entregas e saldos pendentes;
- detalhe da venda com linha do tempo de recebimentos;
- tipos e cliente HTTP em `apps/web/src/types.ts` e `apps/web/src/api.ts`;
- rotas e navegação em `apps/web/src/App.tsx`;
- extensão do Financeiro para a nova origem.

A primeira tela prioriza ações: "Para entregar", "Para receber" e "Registrar
venda". O resumo do dia vem depois das pendências.

## Economia unitária — antes de construir

A v1 tratava custo por ciclo como métrica do piloto, ou seja, descoberta depois
de construir. É mais barato descobrir numa planilha.

**Premissas a validar contra a fatura real:**

- conversas iniciadas pelo usuário (service) não têm custo de mensageria;
- sem lembretes proativos, não há template pago no MVP;
- cada mensagem inbound gera uma chamada de interpretação;
- um ciclo completo pedido → consulta → recebimento consome cerca de 5
  mensagens.

**Ordem de grandeza (verificar com preço vigente do provedor):** com um modelo
econômico e prompts na faixa de 1,5k tokens de entrada, um ciclo completo custa
poucos centavos. O que muda a conclusão é o volume:

| Perfil | Vendas/mês | Custo LLM estimado | % de R$ 19,90 |
|---|---:|---:|---:|
| Leve | 20 | ~R$ 1,50 | ~8% |
| Mediano | 50 | ~R$ 3,50 | ~18% |
| Pesado | 100 | ~R$ 7,00 | ~35% |

**Implicação:** o usuário pesado do ICP — justamente o mais engajado — consome
uma fração relevante da receita só em interpretação. Isso precisa de resposta
antes da Fase 1:

1. **Atalho determinístico antes do LLM** para mensagens que casam padrões
   simples ("sim", "não", confirmações, "quem me deve"), que são boa parte do
   tráfego de um ciclo;
2. **Prompt enxuto por domínio**, consequência natural do roteamento em dois
   estágios;
3. **Preço mais alto para o tier de volume**, se 1 e 2 não bastarem;
4. reuso dos limites de custo e abuso que o guardrail já implementa.

Refazer a tabela com números reais é tarefa da Fase 0, e o resultado é
pré-condição da Fase 1.

## Estratégia de aquisição e monetização

### Posicionamento

Evitar "sistema de vendas" e "PDV", que criam expectativa de estoque, fiscal e
maquininha.

> Seus pedidos, recebimentos e clientes no WhatsApp. Saiba quem pagou e cobre o
> que falta sem procurar em conversas.

Variação para ambulante relacional:

> Registre vendas e encomendas e acompanhe quem ainda paga depois, pelo
> WhatsApp.

### Canais a testar

1. grupos de revendedores e empreendedores no WhatsApp;
2. comunidades locais de cosméticos, roupas, alimentos e artesanato;
3. indicação entre vendedores com benefício não financeiro;
4. contadores e agentes locais que atendem MEIs, sem posicionar o Prestou como
   solução fiscal;
5. distribuidores e marcas pequenas em B2B2C, só após validar uso direto;
6. feiras e associações de ambulantes.

Não começar com mídia paga ampla: "controle de vendas" atrai lojas e
restaurantes, fora do escopo.

### Oferta e preço

- teste gratuito ou piloto assistido até o primeiro valor percebido;
- plano individual entre R$ 14,90 e R$ 29,90 por mês;
- sem taxa por venda e sem dinheiro passando pelo Prestou;
- limite por volume só se a economia unitária exigir;
- plano gratuito permanente não se decide antes de medir retenção e custo.

O teste de preço exige compromisso observável: reserva, pré-cadastro com preço
exposto ou pagamento reembolsável. Perguntar "você pagaria?" gera falso positivo.

### Momento de ativação

Usuário ativado é aquele que, em até 24 horas, registra uma venda ou pedido
real, confirma total e recebido, e volta a consultar o registro. Cadastrar
perfil, produto ou abrir o Dashboard não conta.

### Loop de retenção

```text
novo pedido
  → registra e confirma
  → entrega ou recebe depois
  → consulta "Para receber" ou "Para entregar"
  → registra o recebimento
  → registra o próximo pedido
```

A retenção vem do ciclo de pedidos e saldos. Não há loop de fechamento no MVP.

## Plano do piloto

### Amostra

- 12–15 participantes;
- ao menos 8 com score de ICP alto;
- no máximo quatro categorias, para não fragmentar aprendizado;
- ao menos 5 que recebam entrada + saldo toda semana;
- ao menos 3 ambulantes relacionais;
- ao menos 6 multimarca ou independentes, para medir a lacuna dos apps de marca;
- excluir quem dependa de fiscal, vários funcionários ou parcelário.

### Duração e suporte

- uma semana de baseline observando o método atual;
- duas semanas usando concierge ou produto;
- entrevistas no início, no terceiro dia, no sétimo e no encerramento;
- suporte disponível, mas toda intervenção manual é registrada como fricção;
- nenhum lembrete humano silencioso: medir separadamente uso espontâneo e
  provocado.

### Método de gate

**Com n=12 não existe percentual com significado.** A diferença entre 40% e 25%
são duas pessoas. Todos os gates abaixo são **contagens absolutas acompanhadas
da evidência que as sustenta**. Percentuais voltam a fazer sentido depois do
piloto fechado, com amostra maior.

Cada critério exige evidência nomeada no diário: um caso concreto, com data,
descrito pelo participante — não uma resposta de concordância.

### Diário de evidências

Para cada participante: mensagem original anonimizada; intenção esperada e
resultado; campos que precisaram de pergunta; proposta confirmada, corrigida ou
abandonada; resultado de negócio; intervenção do time; motivo de não uso em cada
dia; objeção de preço; pedido de funcionalidade fora do MVP.

### Critérios de decisão

**Avançar:** gates de comportamento e valor atingidos, sem falha de confiança.

**Iterar:** dor confirmada, mas linguagem, registro ou canal impedem hábito.

**Reposicionar:** o valor está em outro ponto do ciclo que não pedido e saldo.

**Encerrar o beachhead:** problema raro, app de marca já resolve, ou disposição
de pagamento não cobre aquisição e operação.

## Roadmap por gates

### Gate zero — Disposição de pagamento

Precede tudo e não depende desta vertical. Ver
[`teste-disposicao-de-pagamento.md`](./teste-disposicao-de-pagamento.md).

Só se abre a Fase 0 no ramo A, ou no ramo C **depois** de redesenhar a
monetização. No ramo B, este plano é arquivado.

### Fase 0 — Descoberta e concierge

Objetivo: provar que pedido + saldo é valioso, e produzir os dois instrumentos
que as fases seguintes exigem.

- recrutar 12–15 vendedores, priorizando score acima de 15;
- incluir ao menos 6 revendedores relacionais, 3 ambulantes e 3 de fit médio;
- acompanhar ao menos cinco jornadas reais de pedido até recebimento;
- observar como identificam cliente, produto, entrega, entrada e saldo;
- **estimar a fração multimarca / sem app de marca** do segmento;
- verificar se apps de marca resolvem pedido, recebimento ou só reposição;
- testar as palavras "pedido", "venda", "entrada", "falta receber" e "saldo";
- simular o assistente manualmente com mensagens reais;
- comparar registro por pedido, venda individual e lote;
- testar disposição de pagamento em R$ 14,90, R$ 19,90 e R$ 29,90;
- registrar pedidos de gasto, fechamento, áudio e estoque sem prometer entrega.

Gate para avançar — todos em números absolutos, com evidência:

- **≥8 participantes** descrevem um caso concreto e datado dos últimos 30 dias
  de saldo esquecido ou cobrado com atraso;
- **≥8** distinguem "vendido", "recebido" e "falta receber" diante de um exemplo
  numérico, sem ajuda;
- **≥5** concluem no concierge um ciclo completo pedido → saldo → recebimento;
- **≥5** voltam a mandar mensagem espontaneamente num dia sem contato do time;
- **≥5** assumem compromisso observável a R$ 19,90;
- **conjunto de avaliação com ≥200 mensagens rotuladas está congelado**;
- **tabela de economia unitária refeita com preços reais**, com resposta
  definida para o perfil de volume alto.

Os dois últimos são entregáveis, não medições: sem eles a Fase 1 não abre.

### Fase 1 — Fundação técnica atrás de feature flag

Objetivo: criar o domínio sem alterar a experiência de Serviços.

- adicionar `business_mode` com backfill seguro;
- criar `products`, `sales`, `sale_items`, `sale_payments` com constraints,
  índices, RLS e revokes;
- estender o CHECK de `source_type` da auditoria financeira;
- implementar serviços de domínio e cálculos puros;
- implementar APIs de produtos, vendas, recebimentos, saldos e resumo;
- suportar entrada + saldo com lock transacional e sem overpayment;
- gerar Pix do saldo sem acoplar venda a `charges`;
- adicionar idempotência, soft delete com motivo e auditoria;
- integrar vendas como origem do Financeiro;
- proteger tudo com feature flag por vendedor;
- instrumentar eventos antes de abrir o piloto.

Gate para avançar:

- testes de isolamento e somas passam;
- **teste de não regressão prova saída idêntica do Financeiro e do CSV para
  provider sem vendas**;
- cada centavo de venda é rastreável;
- vendido, recebido e a receber fecham matematicamente;
- concorrência não permite recebimento acima do saldo;
- reprocessar a mesma criação não duplica dados.

### Fase 2 — WhatsApp Vendas

Objetivo: completar o ciclo diário sem exigir o Dashboard.

- generalizar `whatsapp_pending_charges` para `whatsapp_pending_drafts` com
  `domain`, preservando a PK em `provider_id`;
- implementar roteamento em dois estágios;
- adicionar as 13 intenções e estender o CHECK de `assistant_action_proposals`;
- implementar rascunho multi-turno e resolução de produto;
- criar propostas confirmáveis por botão;
- tratar ambiguidade no modo híbrido;
- adicionar atalhos determinísticos para mensagens simples;
- manter limites de custo e abuso existentes.

Gate para avançar, medido **contra o conjunto congelado da Fase 0**:

- mediana de até duas mensagens do pedido à proposta correta;
- ≥90% dos casos geram proposta correta ou pergunta segura;
- nenhuma escrita sem confirmação;
- nenhum evento duplicado em retry de webhook;
- custo médio por ciclo dentro do orçado na Fase 0.

### Fase 3 — Dashboard e piloto fechado

- lançar `/vendas` para usuários habilitados;
- oferecer modo agregado sem catálogo;
- exibir "Para entregar" e "Para receber" acima do resumo;
- permitir correções auditáveis;
- conduzir piloto com 10 a 20 vendedores por duas semanas;
- suporte assistido e entrevistas ao fim de cada semana;
- revisar preço, posicionamento e frequência de uso.

Gate de product-market signal, em números absolutos sobre os ativados:

- ao menos 2 em cada 3 ativados registram movimentação em três ou mais dias na
  segunda semana;
- ao menos 2 em cada 3 pedidos e recebimentos não exigem correção posterior;
- ao menos metade dos ativados usa "Para receber" ou "Para entregar" na segunda
  semana;
- ao menos metade relata cobrança recuperada ou entrega lembrada, com caso
  concreto;
- suporte manual abaixo de um quinto dos dias registrados;
- **a retenção é explicada pelo ciclo de pedido e saldo**, e os participantes
  conseguem nomear o que perderiam se o produto sumisse.

### Fase 4 — Condicionada aos dados

Só avançar no que os sinais medidos apontarem. As candidatas, em ordem do que a
instrumentação do MVP consegue detectar:

- **registro de gastos e saldo de caixa** — medido por quantas vezes usuários
  tentaram registrar gasto ou perguntaram "quanto sobrou";
- **fechamento diário persistido** — medido por quantos pediram para "fechar o
  dia" e por quantos conferem retroativamente;
- **estoque e margem** — medido por perguntas de reposição e lucro;
- devolução parcial e estorno;
- áudio;
- página pública com confirmação do cliente;
- conciliação assistida com extrato.

Antes de usar a palavra "lucro", validar CMV, compras para vários dias, perdas,
retiradas pessoais e despesas operacionais.

## Métricas

### North star do piloto

**Vendedores com movimentação útil em pelo menos três dias da semana que
revisitam ao menos uma entrega ou saldo pendente.**

Movimentação útil é pedido, venda, recebimento, entrega, cobrança ou consulta de
pendência real.

### Funil

1. vertical Vendas ativada;
2. primeira venda ou pedido registrado;
3. primeiro saldo a receber criado;
4. primeiro cliente associado a um saldo;
5. lista "Para receber" consultada;
6. primeiro recebimento posterior registrado;
7. primeiro ciclo pedido → pagamento concluído;
8. movimentação em três dias da mesma semana;
9. retorno na segunda semana;
10. conversão para plano pago.

Vendas à vista sem cliente saem do funil no passo 2 e são contadas à parte —
elas não passam pelos passos 3 e 4 por definição.

### Qualidade do produto

Tempo até o primeiro registro; mensagens até proposta confirmável; taxa de
correção e anulação, por motivo; violações da identidade
`vendido = recebido + saldo`; distribuição `paid`/`partial`/`unpaid`; tempo entre
venda e recebimento; saldos vencidos e recuperados; **saldos sem data**;
entregas pendentes resolvidas; uso do Pix preparado; vendas sem produto e sem
cliente; proporção agregado versus por produto; proporção Pix e dinheiro;
usuários que abrem o Dashboard após registrar pelo WhatsApp.

### Demanda pelo que ficou fora

Contagem explícita, por usuário e por semana: tentativas de registrar gasto;
perguntas sobre lucro ou "quanto sobrou"; pedidos de fechamento do dia; pedidos
de estoque; pedidos de devolução parcial; pedidos de áudio. **Estas métricas
decidem a Fase 4.**

### ICP e negócio

Score de aderência na entrada; retenção por faixa de score; retenção por
categoria; proporção com pagamento posterior semanal; valor recuperado após
consulta ou cobrança; conversão por preço testado; custo de suporte por vendedor
ativo; **custo de LLM por ciclo e por vendedor, comparado ao orçado**; origem da
aquisição; razões de churn.

### Qualidade do assistente

Intenção reconhecida; intenção ambígua; proposta confirmada, corrigida,
cancelada ou expirada; mensagens não suportadas; latência e custo por fluxo;
proporção resolvida por atalho determinístico sem chamar o modelo; duplicidades
impedidas; acertos no conjunto de avaliação congelado.

### Guardrails

- zero acesso entre vendedores;
- zero venda persistida sem confirmação;
- zero recebimento acima do saldo;
- zero venda com saldo sem cliente;
- zero duplicidade por retry conhecido;
- totais do WhatsApp, API, Dashboard e exportação idênticos;
- zero regressão mensurável no Financeiro de contas sem vendas;
- nenhuma queda relevante na conclusão de cobranças de Serviços;
- nenhuma mensagem proativa.

## Plano de testes

### Unidade

Soma de itens, recebimentos e saldo; estados derivados; bloqueio de overpayment;
`overdue` só com data definida; vendido por data da venda e recebido por data
efetiva; divisão por forma de pagamento; datas no fuso de São Paulo; formatação
monetária; resolução determinística de produto; transições de proposta; atalhos
determinísticos que evitam o modelo.

### Integração da API e banco

Isolamento por `provider_id` em todas as rotas; transação completa de venda;
rollback se item ou pagamento falhar; lock concorrente no recebimento; duas
confirmações simultâneas não ultrapassam o saldo; idempotência de criação; soft
delete com motivo e auditoria; backfill de contas de Serviços; venda com várias
formas de pagamento; venda sem produto integralmente paga; venda com saldo exige
cliente; **venda com saldo sem data é aceita e nunca fica `overdue`**;
recebimento posterior move `partial` para `paid`; correção reabre saldo; vínculo
não cruza `provider_id`; BR Code usa o saldo atual; **Financeiro e CSV idênticos
para provider sem vendas**; constraints e índices esperados; RLS e ausência de
grants diretos.

### Orquestrador e WhatsApp

Vendedor de Serviços não recebe ferramentas de Vendas; vendedor de Vendas não
entra no fluxo de cobrança; híbrido recebe desambiguação; **abrir rascunho de
venda com rascunho de cobrança vivo substitui e avisa**; rascunho incompleto
continua na mensagem seguinte; botão confirma só a proposta daquele vendedor e
canal; proposta expirada não executa; webhook repetido não duplica; mensagens
desconhecidas não criam conta; nenhum dado financeiro vai ao LLM; execução
completa do conjunto de avaliação congelado.

### Web

Estados vazio, carregando e erro; criação agregada e por produto; divisão de
pagamento; pedido com entrada e saldo; saldo sem data exibido corretamente;
listas de entrega e recebimento; linha do tempo de recebimentos; correção e
anulação com motivo; navegação por modo de negócio; acessibilidade e tela
pequena.

### Casos de aceite do MVP

1. "Vendi 180, 120 Pix e 60 dinheiro" cria venda de R$ 180 após confirmação e
   aparece igual no dia e no Financeiro.
2. "Maria pediu dois kits de 40, pagou 30 e paga 50 sexta" cria venda de R$ 80,
   recebimento de R$ 30 e saldo de R$ 50 com cliente e vencimento.
3. "Maria pediu dois kits de 40 e pagou 30, depois ela me paga" cria a mesma
   venda com saldo **sem data**, e a venda nunca aparece como em atraso.
4. Soma recebida menor que o total é permitida; maior é rejeitada.
5. Venda integralmente paga pode ser registrada sem produto e sem cliente.
6. Venda com saldo sem cliente é rejeitada.
7. "A Maria pagou os 50 que faltavam" quita somente a venda correta.
8. Duas confirmações concorrentes do último saldo produzem um recebimento.
9. Pix preparado usa o saldo atual e não cria entrada financeira.
10. "A Ana devolveu a bolsa" anula venda e recebimentos, com motivo `return`, e
    remove os valores dos totais sem apagar histórico.
11. Editar o dia de uma venda a move entre períodos.
12. Conta híbrida cria cobrança e venda no mesmo número.
13. "Recebi 100 da Maria" em modo híbrido pede esclarecimento.
14. Abrir rascunho de venda enquanto há rascunho de cobrança pendente substitui
    o anterior e avisa o vendedor.
15. Retry do mesmo webhook produz uma única venda.
16. Um vendedor não consulta, edita nem confirma dados de outro.
17. Contas existentes continuam em Serviços sem mudança visível, e seu
    Financeiro responde exatamente como antes.
18. "Gastei 60 em mercadoria" responde que ainda não é suportado e incrementa a
    contagem de demanda por registro de gastos.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Escopo virar PDV | gates, lista de fora do MVP e Fase 4 condicionada a métrica |
| Usuário não registrar todo dia | lote, poucos campos e concierge antes do build |
| Número de resultado ser lido como lucro | nenhum "saldo" ou "sobrou" no MVP |
| Mistura entre Serviços e Vendas | domínios, tabelas e intenções separados |
| Duplicidade no Financeiro | venda como fonte direta, sem `manual_receipt` espelho |
| Vendido confundido com recebido | cards, datas e linguagem separados |
| Entrada lida como quitação | proposta sempre mostra total, recebido e falta |
| Corrida gerar recebimento acima do saldo | lock transacional e idempotência |
| Dois rascunhos vivos no mesmo número | uma linha por prestador com `domain` |
| Precisão cair com 13 intenções | roteamento em dois estágios e conjunto congelado |
| Custo de LLM comer a mensalidade | economia unitária antes da Fase 1, atalhos determinísticos |
| Devolução virar edição manual de banco | anulação com motivo desde o MVP |
| App da marca já resolver pedidos | recrutar multimarca e dimensionar a fração real |
| Cadastro de cliente gerar atrito | exigir só com saldo ou entrega |
| Vencimento obrigatório gerar data falsa | vencimento opcional |
| Cliente se sentir constrangido | mensagem editável e envio manual |
| Erro do LLM criar dado financeiro | confirmação, cálculo determinístico, escrita no backend |
| Regressão no Financeiro compartilhado | teste de saída idêntica para provider sem vendas |

## Perguntas abertas para descoberta

1. O vendedor prefere registrar ao longo do dia, por turno ou no fim?
2. Ele pensa em quantidade de produtos ou apenas no total vendido?
3. Como confere vendas em dinheiro?
4. Em que momento o pedido vira venda: combinação, entrega ou pagamento?
5. O cliente paga antes, na entrega ou depois dela?
6. **Que fração dos saldos tem data combinada de verdade?**
7. Entrada e saldo costumam ter uma ou várias datas de pagamento?
8. Catálogo inicial ajuda ou atrasa a ativação?
9. Vendedores usam a mesma chave Pix para vida pessoal e negócio?
10. Quantos participantes também prestam serviços e precisam do modo híbrido?
11. Quantas vendas por semana são pagas depois ou parcialmente?
12. Como o vendedor identifica pedidos com nomes repetidos?
13. **Que fração do segmento é monomarca com app próprio?**
14. O app da marca registra o recebimento ou somente o pedido?
15. **Com que frequência acontece devolução, e ela é total ou parcial?**
16. Qual foi o último pagamento esquecido ou cobrado atrasado?
17. Uma mensagem com Pix basta ou a confirmação do cliente é essencial?
18. O que faria o vendedor registrar um pedido no Prestou em vez de deixá-lo na
    conversa original?
19. Qual compromisso real aceita assumir em R$ 14,90, R$ 19,90 e R$ 29,90?
20. Quantas vezes por semana ele tenta registrar um gasto ou pergunta quanto
    sobrou?

## Sequência recomendada de entrega

0. **Rodar o teste de disposição de pagamento com os usuários de Serviços e
   declarar o ramo A, B ou C.** Nada abaixo começa antes disso.
1. Executar a descoberta e registrar evidências.
2. Dimensionar a fração real do beachhead e a frequência de pagamento posterior.
3. Refazer a economia unitária com preços reais e decidir a resposta ao volume.
4. Congelar o conjunto de avaliação do assistente.
5. Fechar linguagem de pedido, vendido, recebido, saldo e entrega.
6. Especificar API, concorrência e invariantes numa spec própria.
7. Criar fundação de dados atrás de feature flag.
8. Entregar pedido, venda e recebimento parcial com testes.
9. Integrar Financeiro sem duplicidade, com teste de não regressão.
10. Entregar intenções e confirmações no mesmo WhatsApp.
11. Entregar "Para entregar" e "Para receber".
12. Rodar piloto fechado e decidir continuar, ajustar ou encerrar.
13. Só então avaliar gastos, fechamento, estoque, margem e página pública, na
    ordem que os dados apontarem.

## Definição de pronto do MVP

- um vendedor pode ativar Vendas sem perder Serviços;
- o mesmo número atende os modos configurados;
- vendas podem ser registradas, corrigidas e anuladas por WhatsApp e web;
- pedidos podem ter cliente, entrega, entrada e um saldo com data opcional;
- recebimentos posteriores atualizam saldo sem overpayment;
- "vendido", "recebido" e "a receber" têm datas e totais distintos;
- cliente é opcional à vista e obrigatório com saldo ou entrega;
- produto é opcional e sua ausência não bloqueia o Financeiro;
- devolução é registrável sem intervenção manual no banco;
- toda escrita do WhatsApp é confirmada e idempotente;
- existe no máximo um rascunho vivo por prestador;
- vendas aparecem no Financeiro exatamente uma vez;
- contas sem vendas têm Financeiro e CSV comprovadamente idênticos ao anterior;
- isolamento, RLS, revokes e auditoria foram verificados;
- métricas do funil, de demanda reprimida e guardrails estão disponíveis;
- o piloto atingiu ou não seus gates com evidência para uma decisão explícita.

## Relação com documentos existentes

- [`plano-vertical-vendas-whatsapp.md`](./plano-vertical-vendas-whatsapp.md):
  versão anterior, com o escopo ampliado que esta substitui;
- [`plano-painel-financeiro-fiscal.md`](./plano-painel-financeiro-fiscal.md):
  conceitos de caixa, rastreabilidade e evolução financeira;
- [`api-financeiro-caixa.md`](./api-financeiro-caixa.md): contrato atual que
  receberá a nova origem de entrada;
- [`ADR-009-assistente-whatsapp-first.md`](./decisoes/ADR-009-assistente-whatsapp-first.md):
  mesmo cérebro e duas portas de entrada;
- [`ADR-010-memoria-de-preenchimento-de-cobranca.md`](./decisoes/ADR-010-memoria-de-preenchimento-de-cobranca.md):
  referência para rascunhos multi-turno, cuja tabela esta vertical generaliza;
- [`protocolo-confirmacao-acoes-assistente.md`](./protocolo-confirmacao-acoes-assistente.md):
  confirmação persistida de escritas;
- [`fluxo-cadastro-convite-autenticacao-whatsapp.md`](./fluxo-cadastro-convite-autenticacao-whatsapp.md):
  identidade canônica pelo número verificado.
