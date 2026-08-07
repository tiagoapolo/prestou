---
title: "Plano de produto e engenharia — Vertical Prestou Vendas"
created: 2026-07-28
updated: 2026-07-28
status: proposta-refinada-para-validacao-do-icp
tags:
  - prestou
  - produto
  - vendas
  - whatsapp
  - financeiro
---

# Plano de produto e engenharia — Vertical Prestou Vendas

## Resumo executivo

Criar uma vertical do Prestou para o **vendedor independente multicanal** que
trabalha sozinho, vende presencialmente e pelo WhatsApp, possui catálogo
pequeno e recebe tanto na hora quanto depois. O produto deve ajudá-lo a
registrar pedidos e vendas, acompanhar saldos a receber, registrar gastos e
entender o caixa do dia sem adotar um PDV completo.

Esse ICP pode incluir revendedores porta a porta, sacoleiros, vendedores de
catálogo, feirantes e ambulantes relacionais. O que define a aderência não é o
local da venda, mas a combinação de clientes recorrentes, WhatsApp, operação
individual e pagamentos imediatos e posteriores.

A vertical reutiliza o mesmo cadastro, número de WhatsApp, identidade do
prestador, infraestrutura financeira e Dashboard do Prestou. Cobranças e vendas
continuam sendo domínios separados:

- **Serviços:** cliente, cobrança, vencimento, link e inadimplência;
- **Vendas:** pedido, produto opcional, recebimento, saldo a cobrar, gasto e
  fechamento diário;
- **Híbrido:** o mesmo usuário pode usar os dois fluxos.

O MVP não será um PDV completo. Sua proposta é ser uma caderneta financeira
assistida pelo WhatsApp, muito mais simples do que um sistema de caixa.

> **Promessa inicial:** anote a venda pelo WhatsApp, saiba quem ainda precisa
> pagar e acompanhe quanto entrou no seu dia.

## Decisões recomendadas

1. Usar o **mesmo número de WhatsApp do Prestou** para Serviços e Vendas.
2. Identificar o usuário pelo número verificado já associado ao `provider`.
3. Perguntar no onboarding se ele trabalha com serviços, vendas ou ambos.
4. Manter vendas fora das tabelas de cobranças e pagamentos.
5. Integrar vendas ao Financeiro como nova origem, sem criar uma cópia em
   `manual_receipts`.
6. Começar por pedido, recebimento e saldo; fechamento é secundário e estoque
   completo fica condicionado à validação do MVP.
7. Mostrar **saldo do dia**, não “lucro”, enquanto custo e estoque não forem
   suficientemente confiáveis.
8. Toda escrita pelo WhatsApp deve produzir uma proposta explícita e ser
   confirmada antes da persistência.
9. Permitir registro agregado; o vendedor não deve precisar interromper cada
   atendimento para registrar uma venda individual.
10. No piloto, o WhatsApp bidirecional administrativo atende somente números de
    vendedores verificados. Respostas de clientes finais não entram no
    assistente administrativo.
11. Tratar **entrada + saldo a receber** como capacidade essencial da vertical,
    sem alterar a regra de pagamentos parciais das cobranças de Serviços.
12. Cliente é opcional para venda integralmente recebida e obrigatório quando
    houver entrega futura, saldo ou cobrança posterior.
13. Separar estado de entrega e estado de pagamento; “entregue” não significa
    “pago”.
14. O fechamento não é obrigatório: dias sem confirmação continuam nos totais
    com o estado `not_reviewed`.
15. Produto continua opcional; ausência de catálogo reduz a análise, mas nunca
    bloqueia o registro financeiro.

## Contexto e oportunidade

O Prestou atual resolve cobranças de serviços via Pix, acompanhamento de quem
deve, lembretes e confirmação de pagamento. Para o ICP recomendado, parte do
dinheiro entra na hora e parte entra após a encomenda ou entrega. O link deixa
de ser o centro da experiência, mas volta a ter valor como instrumento para
cobrar o saldo sem transformar o Prestou em intermediador financeiro.

O trabalho principal desse vendedor é diferente:

1. registrar rapidamente o que cada cliente pediu;
2. lembrar o que precisa entregar;
3. saber quem pagou, quem deu entrada e quem ainda deve;
4. cobrar o saldo sem procurar informações em várias conversas;
5. distinguir o que vendeu do dinheiro que realmente entrou;
6. separar Pix, dinheiro, cartão e outras formas;
7. registrar compras e gastos do negócio;
8. não misturar todo o caixa com dinheiro pessoal;
9. acompanhar se a semana está melhor ou pior;
10. futuramente, entender margem e necessidade de reposição.

A base já implementada reduz o custo de testar essa oportunidade:

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

A pesquisa mercadológica realizada em julho de 2026 indica três mercados
adjacentes:

| Segmento | Tamanho direcional | Aderência ao Prestou | Complexidade competitiva |
|---|---:|---|---|
| Ambulantes | 1,0–1,3 milhão | média | média |
| Venda direta / porta a porta | cerca de 3 milhões | muito alta | média |
| Empresas comerciais | até 1,5 milhão | baixa–média | muito alta |

A ABEVD informa que a venda direta movimentou cerca de R$ 50 bilhões em 2024,
reúne aproximadamente 3 milhões de empreendedores e tem cerca de 80% deles
usando WhatsApp para vendas e relacionamento. O IBGE registrou 1,3 milhão de
ambulantes no terceiro trimestre de 2017 e 1,5 milhão de empresas comerciais
formais em 2023. As categorias não são mutuamente exclusivas e os números não
devem ser somados.

Fontes:

- [ABEVD — força de vendas e uso de WhatsApp](https://www.abevd.org.br/como-a-humanizacao-move-r-50-bilhoes-na-venda-direta-brasileira/);
- [ABEVD — desempenho da venda direta em 2024](https://www.abevd.org.br/venda-direta-movimenta-r-50-bilhoes-em-2024-e-segue-em-expansao/);
- [IBGE — comércio ambulante](https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/20769-comercio-ambulante-como-alternativa-de-ganhar-a-vida);
- [IBGE — Pesquisa Anual de Comércio 2023](https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/44145-ocupacao-no-comercio-cresce-pelo-terceiro-ano-seguido-e-chega-a-10-5-milhoes-de-pessoas);
- [IBGE — Estatísticas dos MEIs 2022](https://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/41046-em-2022-brasil-tinha-14-6-milhoes-de-microempreendedores-individuais).

### Por que esse ICP primeiro

1. **Reutiliza o diferencial atual:** cliente, Pix, cobrança, vencimento,
   lembrete e confirmação de pagamento já existem.
2. **WhatsApp é canal de trabalho:** o usuário não precisa aprender uma rotina
   separada para começar.
3. **Há dois momentos de valor:** organizar a venda e recuperar o saldo.
4. **Cliente costuma ser identificável:** isso permite histórico, recorrência e
   cobrança responsável.
5. **A operação é simples:** um decisor, um número de WhatsApp e catálogo curto.
6. **A diferenciação é defensável:** não é apenas PDV, estoque ou catálogo; é a
   continuidade entre pedido, recebimento e cobrança.

### Por que não começar pelos adjacentes

- **Venda anônima e acelerada no sinal:** usa fechamento e caixa, mas pouco do
  diferencial de clientes e cobrança; tende a ter menor disposição de pagar.
- **Pequena loja:** pode pagar mais, mas exige venda rápida, estoque, fiscal,
  múltiplos usuários, periféricos e integração com maquininha. Compete com PDVs
  e ERPs já consolidados.
- **Ambulante relacional:** permanece dentro do ICP quando recebe encomendas,
  usa WhatsApp, possui clientes recorrentes ou vende com pagamento posterior.

## Público inicial

### Segmento recomendado para o piloto

Vendedores independentes multicanal que:

- vendem um catálogo pequeno e repetitivo;
- trabalham sozinhos;
- usam WhatsApp diariamente;
- atendem presencialmente e pelo WhatsApp;
- têm clientes recorrentes ou identificáveis;
- misturam pronta entrega, encomenda e pagamento posterior;
- recebem por Pix e dinheiro;
- hoje controlam o negócio de memória, em papel ou em mensagens para si mesmos;
- não usam ERP ou PDV completo;
- decidem sozinhos adotar e pagar pela ferramenta.

Exemplos prioritários: revendedores de cosméticos, roupas, acessórios, produtos
para casa, alimentos, doces e kits; sacoleiros; vendedores porta a porta;
feirantes e ambulantes que recebem pedidos pelo WhatsApp.

### Critérios operacionais do ICP

| Dimensão | Faixa ou comportamento recomendado |
|---|---|
| Estrutura | titular trabalhando sozinho ou com ajuda familiar informal |
| Catálogo | aproximadamente 1–50 produtos recorrentes; cadastro opcional |
| Volume | hipótese inicial de 20–100 vendas ou pedidos por mês |
| Clientes | parte recorrente e identificável por nome e WhatsApp |
| Canais | presencial + WhatsApp; redes sociais podem gerar demanda |
| Recebimento | Pix e dinheiro; parte à vista e parte depois |
| Controle atual | memória, caderno, planilha simples ou conversa consigo mesmo |
| Tecnologia | smartphone próprio e uso cotidiano do WhatsApp |
| Decisão | o próprio vendedor escolhe e usa a ferramenta |
| Fiscal | não depende de emissão fiscal integrada para operar o MVP |

As faixas são hipóteses de descoberta, não regras permanentes de elegibilidade.

### Score de aderência para entrevistas e piloto

Pontuar cada candidato de 0 a 2 em cada item:

1. usa WhatsApp para receber pedidos;
2. vende presencialmente;
3. possui clientes recorrentes;
4. recebe parte das vendas depois;
5. controla pedidos ou dívidas manualmente;
6. trabalha sozinho;
7. tem catálogo pequeno;
8. aceita Pix;
9. consegue decidir pela adoção;
10. sente perda de tempo, esquecimento ou atraso de pagamento.

Classificação:

- **16–20 — fit alto:** candidato principal para piloto;
- **11–15 — fit médio:** persona adjacente útil para comparação;
- **0–10 — fit baixo:** não orientar o MVP por suas necessidades.

### Personas dentro do ICP

#### Persona central — revendedor relacional

- vende cosméticos, roupas, acessórios ou produtos domésticos;
- conversa com clientes antes e depois da venda;
- recebe entrada e cobra saldo na entrega ou em outra data;
- hoje procura pedidos em diferentes conversas;
- valoriza saber “quem ainda precisa pagar”.

#### Persona adjacente — ambulante relacional

- circula, trabalha em feira, praia, escritórios ou eventos;
- possui fregueses recorrentes;
- recebe encomendas ou separa mercadoria pelo WhatsApp;
- faz muitas vendas à vista, mas algumas ficam para depois;
- também valoriza fechamento diário em lote.

#### Persona adjacente — pequena loja de uma pessoa

- tem ponto fixo e um único operador;
- pode usar o modo de venda rápida e fechamento;
- só entra no piloto se não exigir código de barras, fiscal ou múltiplos caixas.

#### Anti-persona — venda anônima de alta velocidade

- transações de poucos segundos e baixo valor;
- cliente não é identificado;
- todo pagamento acontece na hora;
- registrar cada venda custa mais que o benefício percebido;
- exemplo: vendedor exclusivamente no sinal sem encomendas ou fregueses.

### Fora do segmento inicial

- lojas com múltiplos caixas ou funcionários;
- restaurantes com comandas e mesas;
- negócios que precisam de emissão fiscal por venda no MVP;
- crediário com várias parcelas, juros, multa ou renegociação;
- cobrança de terceiros e concessão estruturada de crédito;
- catálogo com variações complexas;
- integração obrigatória com maquininha, banco ou marketplace;
- controle contábil ou tributário completo.

## Hipóteses a validar

### Hipótese de problema

O vendedor perde contexto entre conversas, pedidos, entregas e pagamentos. Ele
não sabe com confiança o que precisa entregar, quem ainda deve, quanto dinheiro
entrou nem quanto pode reservar para a operação.

### Hipótese de comportamento

O vendedor aceita registrar pedidos relevantes no momento em que negocia pelo
WhatsApp e vendas à vista em lote no fim do período. Ele não registra cada
transação presencial se isso exigir vários campos ou abrir o Dashboard.

### Hipótese de canal

O mesmo WhatsApp do Prestou reduz treinamento e recorrência porque funciona no
canal que o vendedor já usa. O Dashboard é útil para conferência e correção,
mas não deve ser obrigatório para o registro cotidiano.

### Hipótese de valor

O primeiro valor percebido é não esquecer pedidos e saldos a cobrar. O
fechamento diário reforça recorrência; estoque e lucro não são o wedge inicial.

### Riscos das hipóteses

- o vendedor pode considerar qualquer registro manual trabalhoso;
- “quanto sobrou” pode ser confundido com lucro;
- compras para vários dias distorcem o saldo diário;
- parte dos gastos pessoais pode ser lançada como gasto do negócio;
- vendas em dinheiro podem ser esquecidas com mais frequência que vendas Pix;
- vendedores podem preferir olhar diretamente o extrato bancário;
- aplicativos da marca podem já registrar parte dos pedidos, reduzindo valor;
- o vendedor pode evitar registrar clientes por considerar o processo invasivo;
- “entrada” pode ser confundida com quitação;
- cobrar saldos pode causar desconforto e o usuário pode não enviar lembretes.

## Jobs to be done

### Principal

> Quando combino uma venda presencialmente ou pelo WhatsApp, quero registrar o
> pedido, o que já recebi e o que falta receber para entregar corretamente,
> cobrar sem constrangimento e entender meu caixa.

### Secundários

- registrar pedido para entrega futura;
- registrar uma venda integralmente paga;
- registrar entrada e saldo com vencimento;
- encontrar rapidamente quem ainda deve;
- enviar cobrança do saldo com Pix;
- registrar várias vendas à vista de uma vez;
- corrigir um lançamento sem perder o histórico;
- conferir se o dinheiro físico e o Pix batem com o que foi informado;
- separar “vendido” de “recebido”;
- consultar o resultado de hoje, da semana ou do mês;
- lembrar os produtos e preços frequentes;
- compartilhar ou exportar um resumo;
- usar Serviços e Vendas no mesmo cadastro quando necessário.

## Princípios de produto

1. **Pendências antes de estoque:** validar pedido, entrega e saldo antes de
   criar um sistema de inventário.
2. **Lote antes de venda unitária:** aceitar “vendi R$ 180 hoje” e detalhamento
   opcional por produto.
3. **Pedido e recebimento são fatos diferentes:** vender R$ 100 e receber R$ 30
   cria R$ 70 a receber; não cria R$ 100 no caixa.
4. **Caixa antes de lucro:** mostrar entradas, saídas e saldo; margem e lucro
   exigem custo de mercadoria confiável.
5. **WhatsApp para registrar, Dashboard para conferir:** cada canal faz o que
   executa melhor.
6. **Uma fonte da verdade:** não duplicar a mesma venda em venda e receita
   avulsa.
7. **Números explicáveis:** todo total abre os lançamentos que o compõem.
8. **Correção auditável:** alterações e exclusões são lógicas e registradas.
9. **Cobrança como instrumento:** a venda é o fato comercial; a cobrança é um
   meio operacional de receber seu saldo.
10. **Confirmação proporcional ao risco:** toda escrita mostra cliente, data,
    total, recebido e saldo antes de executar.
11. **Sem crédito sofisticado:** um saldo e uma data de vencimento por venda no
    MVP; parcelas, juros e renegociação ficam fora.
12. **Linguagem cotidiana:** preferir “vendeu”, “recebeu”, “falta receber”,
    “gastou” e “sobrou” a termos contábeis sem explicação.

## Posicionamento das verticais

| Prestou Serviços | Prestou Vendas |
|---|---|
| “Cobre e acompanhe quem deve” | “Organize pedidos, recebimentos e saldos” |
| Recebimento pode acontecer depois | Pode acontecer na hora, em parte ou depois |
| Cliente é obrigatório | Cliente é opcional à vista e obrigatório com saldo |
| Vencimento e status são centrais | Pedido, entrega, recebido e saldo são centrais |
| Link e lembrete têm valor | Mensagem e Pix apoiam a cobrança do saldo |
| Principal pergunta: quem me deve? | Perguntas: o que entregar, quem deve e quanto entrou? |

O nome “Prestou” e a conta permanecem únicos. “Serviços” e “Vendas” aparecem
como modos ou áreas do produto, não como aplicativos ou números diferentes.

## Experiência proposta

### 1. Escolha de modo

No onboarding e nas Configurações:

> Como você trabalha?
>
> - Presto serviços
> - Vendo produtos
> - Faço os dois

Contas existentes são migradas como `services`. A mudança posterior não apaga
nem transforma dados. O modo apenas configura navegação, sugestões e intenções
prioritárias do assistente.

### 2. Primeira configuração de Vendas

Pedir somente:

- como vende: presencial, WhatsApp ou ambos;
- se costuma receber tudo na hora, entrada + saldo ou depois;
- um primeiro cliente ou produto somente durante o primeiro uso real;
- produtos mais frequentes, opcionalmente com preço;
- formas de pagamento usadas;
- horário aproximado em que costuma encerrar o dia, somente se aceitar
  lembretes futuros.

Não bloquear a primeira venda por falta de catálogo, custo ou estoque. A meta
de ativação é levar o usuário a uma proposta correta de venda em menos de cinco
minutos após confirmar o número.

### 3. Registro de venda pelo WhatsApp

Entradas aceitas no MVP:

> Vendi R$ 180 hoje, 120 no Pix e 60 em dinheiro.

> Vendi 12 águas a 5 reais no Pix.

> Vendi 8 águas e 5 doces, tudo deu 85 reais.

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

Exemplo com saldo:

> Registrar pedido da Maria?
>
> Total vendido: R$ 80,00<br>
> Recebido agora: R$ 30,00 no Pix<br>
> Falta receber: R$ 50,00 até 31/07<br>
> Entrega: pendente
>
> [Confirmar] [Corrigir] [Cancelar]

Regras:

- aceitar venda total sem produto;
- aceitar um ou vários produtos;
- permitir uma ou várias formas de pagamento;
- permitir soma recebida entre zero e o total da venda;
- exigir cliente e vencimento quando houver saldo a receber;
- impedir recebimento acima do total;
- diferenciar data da venda, data esperada de entrega e data de recebimento;
- quando preço ou quantidade forem ambíguos, perguntar em vez de inferir;
- usar `America/Sao_Paulo` para “hoje”, “ontem” e fechamento;
- deduplicar pelo ID da mensagem inbound e pela proposta confirmada.

### 4. Recebimento posterior e cobrança do saldo

Comandos:

> A Maria pagou os R$ 50 que faltavam no Pix.

> Quem ainda está me devendo?

> Preparar cobrança do saldo da Ana.

Regras:

- resolver cliente e venda no backend; o LLM nunca escolhe IDs;
- se houver mais de uma venda em aberto para o cliente, perguntar qual;
- registrar o recebimento somente após confirmação explícita;
- o recebimento usa sua data efetiva e forma de pagamento;
- o saldo é derivado do total menos recebimentos ativos;
- quando o saldo chegar a zero, o estado financeiro passa a `paid`;
- uma mensagem com Pix Copia e Cola pode ser preparada para o saldo atual;
- o vendedor confirma manualmente quando o dinheiro entrar;
- corrigir ou excluir um recebimento recalcula o saldo e mantém auditoria;
- no MVP existe um único vencimento corrente por saldo, sem parcelário.

### 5. Produto opcional

O usuário pode registrar:

> Vendi R$ 100 no Pix.

Nesse caso a venda recebe um item descritivo sem `product_id`, por exemplo
“Venda sem produto informado”. Ela compõe todos os totais financeiros. Sem
produto, o Prestou não oferece ranking por item, quantidade, custo ou estoque.

Depois de descrições recorrentes, o assistente pode sugerir:

> Você mencionou “kit de sabonetes” algumas vezes. Quer salvar como produto por
> R$ 35?

Nunca criar produto silenciosamente nem bloquear venda por catálogo vazio.

### 6. Registro de gasto

Entradas aceitas:

> Gastei R$ 60 em duas caixas de água.

> Paguei 12 reais de ônibus em dinheiro.

Categorias iniciais:

- mercadoria;
- transporte;
- taxa;
- alimentação de trabalho;
- outro.

O assistente confirma valor, data, categoria, forma de pagamento e descrição.
Não deve classificar gasto pessoal como gasto do negócio sem confirmação.

### 7. Fechamento diário

Comando principal:

> Fechar meu dia.

Resposta proposta:

> Fechamento de 28/07
>
> Vendido: R$ 236,00<br>
> Recebido: R$ 186,00<br>
> A receber dessas vendas: R$ 50,00<br>
> Pix: R$ 118,00<br>
> Dinheiro: R$ 68,00<br>
> Gastos registrados: R$ 74,00<br>
> Saldo do dia: R$ 112,00
>
> Esse saldo considera apenas o que você registrou e não representa
> necessariamente seu lucro.

O fechamento é uma conferência, não um bloqueio contábil. Se um lançamento do
dia for alterado depois, o fechamento fica “precisa revisar” e pode ser fechado
novamente.

Se o vendedor não fechar:

- os registros continuam válidos e aparecem nos totais;
- o dia fica `not_reviewed`, nunca com valor zero presumido;
- o usuário pode conferir retroativamente com “fechar ontem”;
- no próximo contato, o assistente pode oferecer a conferência sem bloquear a
  intenção atual;
- lembrete proativo continua opcional e sujeito às regras da Meta.

### 8. Consultas pelo WhatsApp

- “Quanto vendi hoje?”
- “Quanto eu realmente recebi hoje?”
- “Quem ainda precisa pagar?”
- “O que preciso entregar amanhã?”
- “Quanto a Maria ainda deve?”
- “Quanto entrou no Pix esta semana?”
- “Quanto gastei hoje?”
- “Como foi meu dia?”
- “Qual foi meu melhor dia desta semana?”
- “Quais vendas registrei hoje?”

“Quanto lucrei?” deve responder com transparência:

> Ainda não consigo calcular seu lucro com segurança. Pelos registros de caixa,
> entraram R$ X e saíram R$ Y, deixando saldo de R$ Z.

### 9. Área Vendas no Dashboard

Elementos do MVP:

- resumo de hoje: vendido, recebido, a receber, gastos e saldo de caixa;
- divisão por forma de pagamento;
- listas “Para entregar”, “Para receber”, vendas concluídas e gastos;
- detalhe por cliente com histórico de pedidos e recebimentos;
- ação de preparar cobrança do saldo;
- ações de adicionar, corrigir e excluir logicamente;
- fechamento do dia;
- navegação por dia;
- produtos frequentes;
- acesso ao Financeiro mensal;
- estado de dados incompletos;
- modo simples para quem não usa catálogo.

Para usuários híbridos, a navegação mostra “Cobranças”, “Vendas” e
“Financeiro”. Para usuários de uma única vertical, a área principal abre no
modo escolhido.

## Escopo do MVP

### Incluído

- modo `services`, `sales` ou `hybrid` no perfil;
- mesmo número de WhatsApp para as duas verticais;
- catálogo opcional e pequeno;
- registro agregado, venda à vista ou pedido detalhado;
- cliente opcional à vista e obrigatório para entrega ou saldo;
- entrada e um saldo a receber por venda;
- vencimento e cobrança Pix do saldo;
- registro de recebimento posterior;
- estados de entrega separados do pagamento;
- múltiplas formas de pagamento na mesma venda;
- registro de gastos do negócio;
- resumo e fechamento diário;
- consultas diárias, semanais e mensais;
- correção e exclusão lógica com auditoria;
- página Vendas no Dashboard;
- integração das entradas com o Financeiro;
- eventos de funil e métricas de qualidade do assistente.

### Explicitamente fora do MVP

- estoque em tempo real;
- alerta de reposição;
- cálculo de CMV, margem ou lucro contábil;
- parcelário, juros, multa, renegociação e limite de crédito;
- várias datas futuras de pagamento para a mesma venda;
- integração automática com banco, Open Finance ou maquininha;
- emissão de NFC-e, NFS-e ou cupom fiscal;
- múltiplos vendedores, caixas ou lojas;
- leitor de código de barras;
- impressão de recibo;
- programa de fidelidade;
- e-commerce ou link de compra;
- áudio, salvo se a descoberta provar que texto inviabiliza o uso;
- lembretes proativos de fechamento antes de validar consentimento e retenção.

## Modelo de domínio proposto

O modelo abaixo é uma direção para a implementação. Os nomes e constraints
devem ser fechados em uma spec de API antes da migração.

### Extensão de `providers`

Adicionar `business_mode`:

- `services`;
- `sales`;
- `hybrid`.

Usar `services` como padrão e backfill para todas as contas existentes. Essa
coluna configura experiência e roteamento; não é usada sozinha para autorizar
acesso a dados.

### `products`

- `id`;
- `provider_id`;
- `name`;
- `unit_label`, opcional;
- `default_price_cents`, opcional;
- `estimated_unit_cost_cents`, opcional e sem exibição como lucro no MVP;
- `active`;
- `created_at` e `updated_at`.

Regras:

- nome único, sem diferenciar maiúsculas, entre produtos ativos do vendedor;
- produto pode ser desativado, nunca apagado se já foi usado;
- preço e custo da venda são copiados para o item, preservando o histórico.

### `sales`

Representa um pedido, uma venda à vista ou um lote agregado. O mesmo registro
pode começar como pedido e depois ser marcado como entregue, sem misturar
entrega com pagamento.

- `id`;
- `provider_id`;
- `client_id`, opcional somente quando o saldo for zero e não houver entrega;
- `sold_date`;
- `payment_due_date`, obrigatório enquanto houver saldo no MVP;
- `expected_delivery_date`, opcional;
- `delivery_status`: `not_applicable`, `pending`, `delivered` ou `cancelled`;
- `sales_channel`: `presencial`, `whatsapp`, `misto` ou `outro`;
- `source`: `whatsapp` ou `web`;
- `note`, opcional;
- `voided_at`;
- `created_at` e `updated_at`.

O total vendido é a soma dos itens. O status financeiro (`unpaid`, `partial` ou
`paid`) e o saldo são derivados dos recebimentos ativos, não armazenados como
uma segunda fonte da verdade.

Regras:

- cliente é obrigatório se o saldo for maior que zero;
- cliente é obrigatório se `delivery_status = pending`;
- `cancelled` não apaga recebimentos existentes; exige tratamento explícito de
  devolução, fora do MVP, ou bloqueia cancelamento enquanto houver recebimento;
- uma venda agregada integralmente paga pode existir sem cliente e produto;
- venda não pode ser editada para um total inferior ao já recebido;
- estado de entrega não altera caixa nem status financeiro;
- cancelar pedido sem recebimento preserva o registro com `delivery_status =
  cancelled`;
- excluir uma venda lançada por engano aplica soft delete ao cabeçalho e aos
  recebimentos ativos na mesma transação, grava auditoria e invalida fechamento.

### `sale_items`

- `id`;
- `sale_id`;
- `product_id`, opcional;
- `description_snapshot`;
- `quantity`;
- `unit_price_cents`, opcional;
- `line_total_cents`;
- `estimated_unit_cost_cents`, opcional;
- `created_at`.

Um item sem produto representa um total agregado, por exemplo “Vendas da
manhã”. Quantidade pode começar como número inteiro no MVP; venda por peso só
deve ampliar o tipo após validação com o segmento.

### `sale_payments`

- `id`;
- `sale_id`;
- `provider_id`, redundante de forma intencional para índice e isolamento
  explícito das consultas financeiras;
- `received_date`;
- `payment_method`;
- `amount_cents`;
- `source`: `whatsapp`, `web` ou `customer_confirmation` no futuro;
- `note`, opcional;
- `voided_at`;
- `created_at` e `updated_at`.

Regras:

- a soma dos pagamentos ativos deve ficar entre zero e o total dos itens;
- a aplicação valida dentro da mesma transação;
- cada pagamento compõe o Financeiro como entrada rastreável;
- uma venda com Pix e dinheiro gera duas linhas financeiras vinculadas à mesma
  venda, evitando o método ambíguo “misto”;
- novos recebimentos adquirem lock da venda antes de validar o saldo;
- recebimento não pode exceder o saldo, inclusive sob concorrência;
- corrigir valor ou data recalcula Financeiro e fechamento;
- exclusão é lógica e pode fazer uma venda voltar de `paid` para `partial` ou
  `unpaid` sem apagar histórico.

### Invariantes e cálculos

```text
sold_total_cents     = soma de sale_items ativos
received_total_cents = soma de sale_payments ativos
outstanding_cents    = sold_total_cents - received_total_cents

unpaid  = received_total_cents = 0
partial = 0 < received_total_cents < sold_total_cents
paid    = received_total_cents = sold_total_cents
overdue = outstanding_cents > 0 e payment_due_date < hoje
```

As invariantes são verificadas no backend dentro da transação e reforçadas no
banco quando uma constraint declarativa for possível.

| Ação | Estado de entrega | Estado financeiro | Efeito no caixa |
|---|---|---|---|
| Criar pedido sem entrada | `pending` | `unpaid` | nenhum |
| Criar pedido com entrada | `pending` | `partial` | entrada na data efetiva |
| Marcar entregue | `delivered` | não muda | nenhum |
| Registrar saldo integral | não muda | `paid` | entrada na data efetiva |
| Corrigir recebimento | não muda | recalculado | move ou ajusta entrada |
| Excluir recebimento | não muda | recalculado | remove entrada dos totais |

Devolução, estorno, desconto após a venda e cancelamento com dinheiro já
recebido ficam fora do MVP. A interface bloqueia essas transições e orienta o
piloto a corrigi-las com suporte, preservando evidência para a próxima fase.

### Cobrança do saldo no MVP

O MVP não transforma uma venda em `charges` nem duplica o recebimento em
`payments`. Para cobrar o saldo:

1. calcular o saldo atual no backend;
2. gerar BR Code Pix com a chave do vendedor e o valor exato;
3. preparar mensagem e `wa.me` para o cliente;
4. o vendedor envia manualmente;
5. após receber, registra o pagamento da venda.

Essa escolha isola os domínios e preserva `sale_payments` como fonte única dos
recebimentos da venda. A página pública com confirmação do cliente pode ser
adicionada após validação, preferencialmente generalizando o conceito de
solicitação de pagamento em vez de acoplar a venda à tabela de cobranças.

### `business_expenses`

- `id`;
- `provider_id`;
- `expense_date`;
- `category`;
- `description`;
- `amount_cents`;
- `payment_method`;
- `source`: `whatsapp` ou `web`;
- `voided_at`;
- `created_at` e `updated_at`.

O nome deixa explícito que a tabela não deve receber gasto pessoal.

### `daily_closings`

- `id`;
- `provider_id`;
- `business_date`;
- `status`: `not_reviewed`, `closed` ou `needs_review`;
- totais de entrada, saída e saldo no momento do fechamento;
- total vendido e total a receber informativos, separados do caixa;
- `closed_at`;
- `updated_at`.

Pode existir no máximo um fechamento por vendedor e dia. Ausência de linha
equivale a `not_reviewed`; não é necessário criar linhas vazias para todos os
dias. Alterar ou excluir um lançamento do período marca o fechamento existente
como `needs_review`.

### Auditoria

Estender a trilha financeira para reconhecer `sale`, `sale_payment` e
`business_expense`, ou criar uma trilha de domínio equivalente se a alteração
da constraint existente ficar confusa. Em qualquer opção:

- registrar estado anterior e posterior;
- manter soft delete;
- não guardar texto bruto do WhatsApp na auditoria financeira;
- permitir rastrear cada centavo até a origem;
- nunca transformar exclusão financeira em mudança de outro domínio.

### Índices e isolamento

- índices por `provider_id` + data para vendas e gastos ativos;
- índices por `sale_id` para itens e pagamentos;
- índice de vendas ativas por `provider_id` + `payment_due_date`; o saldo é
  filtrado após agregar recebimentos, pois não é coluna persistida no MVP;
- unicidade do fechamento por `provider_id` + `business_date`;
- FKs compostas ou validação equivalente no banco impedem relacionar venda,
  cliente e recebimento de vendedores diferentes;
- RLS habilitada em todas as novas tabelas de `public` como defesa em
  profundidade;
- `anon` e `authenticated` sem acesso direto, mantendo o navegador atrás da API;
- nenhuma rota aceita `provider_id` do cliente; ele é derivado do JWT ou do
  número de WhatsApp verificado;
- tabelas filhas sempre são resolvidas por uma raiz pertencente ao vendedor;
- `service_role` e conexão do banco continuam exclusivos da API.

O Supabase passou a permitir que novas tabelas não sejam expostas
automaticamente à Data API. A implementação não deve depender dessa
configuração: além de RLS, deve revogar explicitamente o acesso direto como o
schema atual já faz.

## Integração com o Financeiro

### Fonte da verdade

Uma venda confirmada não cria `manual_receipt`. O Financeiro passa a unir:

1. pagamentos de cobranças;
2. receitas avulsas;
3. pagamentos de vendas.

Isso evita duplicidade, divergência em correções e exclusões inconsistentes.

No MVP, o Pix preparado para o saldo não cria uma linha em `charges` ou
`payments`. Quando o vendedor registra o recebimento, a única entrada financeira
é `sale_payments`.

### Semântica

- `Vendido no período` usa `sales.sold_date` e o total dos itens;
- `Recebido no mês` inclui `sale_payments` pela `received_date` efetiva;
- `A receber de vendas` usa total vendido menos recebimentos ativos;
- `Em atraso de vendas` exige saldo positivo e vencimento anterior a hoje;
- a lista informa origem `Venda` e dá acesso ao registro;
- vendas com pagamentos divididos aparecem separadas por forma de pagamento;
- a soma dos itens financeiros continua exatamente igual ao total recebido;
- gastos ficam em uma seção separada e não reduzem silenciosamente o card atual
  de “Recebido”;
- o Financeiro pode adicionar `Saiu no mês` e `Saldo de caixa`, com explicação;
- cards agregados de “A receber” e “Em atraso” podem somar cobranças e vendas,
  mas o detalhe sempre separa `Serviços` de `Vendas`;
- fechamento diário usa recebimentos pela data efetiva, não o valor integral
  das vendas do dia.

### Exportação

Evoluir o CSV para identificar a origem `venda` e, em uma exportação de fluxo
de caixa, incluir gastos em linhas separadas com tipo `entrada` ou `saida`.
Preservar proteção contra fórmulas e os totais conferíveis.

## WhatsApp: um número, dois domínios

### Roteamento

Após validar a assinatura da Meta e resolver o `provider` pelo número:

1. carregar `business_mode`;
2. verificar proposta ou rascunho pendente;
3. interpretar a intenção;
4. restringir as ferramentas às capacidades habilitadas;
5. executar consulta ou criar proposta de escrita;
6. renderizar texto e botões no mesmo canal.

Usuários `sales` recebem sugestões de vendas. Usuários `services` mantêm o
comportamento atual. Usuários `hybrid` podem usar ambos.

### Ambiguidade no modo híbrido

Mensagens como “recebi 100 da Maria” não devem ser classificadas à força. O
assistente pergunta:

> Foi o pagamento de um serviço ou de uma venda? Se foi venda, qual pedido da
> Maria?

Enquanto houver uma proposta pendente, a resposta do usuário é interpretada no
contexto daquela proposta, sem trocar de domínio silenciosamente.

### Novas intenções

| Intenção | Tipo | Confirmação |
|---|---|---|
| `registrar_venda` | escrita | obrigatória |
| `registrar_pedido` | escrita | obrigatória |
| `registrar_recebimento_venda` | escrita financeira | obrigatória |
| `marcar_entrega` | escrita | obrigatória |
| `preparar_cobranca_saldo` | leitura com geração Pix | não persiste no MVP |
| `corrigir_venda` | escrita | obrigatória |
| `excluir_venda` | escrita | obrigatória |
| `registrar_gasto` | escrita | obrigatória |
| `corrigir_gasto` | escrita | obrigatória |
| `excluir_gasto` | escrita | obrigatória |
| `fechar_dia` | escrita de conferência | obrigatória |
| `resumo_vendas` | leitura | não |
| `listar_vendas` | leitura | não |
| `listar_saldos_vendas` | leitura | não |
| `listar_entregas_pendentes` | leitura | não |
| `status_venda_cliente` | leitura | não |
| `listar_gastos` | leitura | não |
| `gerenciar_produto` | escrita | obrigatória |

O LLM interpreta intenção e extrai argumentos, mas não consulta o banco, não
calcula totais oficiais e não executa escrita. Produtos são resolvidos no
backend por nome normalizado; ambiguidade gera pergunta. Dados financeiros e o
catálogo completo não precisam ser enviados ao modelo.

Para `registrar_recebimento_venda`, a resolução segue:

1. localizar clientes candidatos do vendedor;
2. localizar vendas com saldo daquele cliente;
3. se houver exatamente uma compatível, montar proposta;
4. se houver várias, perguntar por produto, valor ou data;
5. adquirir lock da venda na confirmação;
6. recalcular o saldo dentro da transação antes de inserir.

### Estado e idempotência

- generalizar memória pendente por domínio ou criar memória específica de
  Vendas sem quebrar `whatsapp_pending_charges`;
- uma mensagem inbound aceita no máximo uma ação persistida;
- usar o ID da mensagem Meta como chave de deduplicação;
- confirmação referencia um `proposalId` específico;
- propostas expiram, têm uso único e são escopadas por vendedor e canal;
- transação grava cabeçalho, itens, recebimentos, evento e invalidação do
  fechamento de forma atômica;
- estado pendente contém `domain`, `intent` e referências já resolvidas para
  impedir que uma resposta curta troque de pedido;
- reprocessamento do webhook devolve o mesmo resultado sem duplicar a venda.

### Janela de atendimento

Mensagens iniciadas pelo vendedor usam a janela de atendimento de 24 horas da
Meta. Lembretes proativos de fechamento exigem opt-in, template aprovado,
limite de frequência e mecanismo de desligamento. Não são pré-requisito do
piloto.

## Contratos de API candidatos

Todos os endpoints são autenticados e derivam o vendedor do JWT.

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
- `DELETE /api/sales/:id` — soft delete
- `POST /api/sales/:id/payments`
- `PATCH /api/sales/:saleId/payments/:paymentId`
- `DELETE /api/sales/:saleId/payments/:paymentId` — soft delete
- `POST /api/sales/:id/mark-delivered`
- `POST /api/sales/:id/prepare-balance-pix`
- `GET /api/sales/receivables?status=open|overdue&clientId=`

Os clientes existentes são reutilizados. Uma criação de venda pode selecionar
`clientId` ou fornecer nome + WhatsApp para o serviço de domínio resolver ou
criar cliente com as mesmas garantias de isolamento das cobranças.

### Gastos

- `GET /api/business-expenses?date=AAAA-MM-DD`
- `POST /api/business-expenses`
- `PATCH /api/business-expenses/:id`
- `DELETE /api/business-expenses/:id` — soft delete

### Resumo e fechamento

- `GET /api/sales/daily-summary?date=AAAA-MM-DD`
- `POST /api/sales/daily-closings`
- `GET /api/sales/daily-closings/:date`

### Regras de contrato

- valores inteiros em centavos;
- datas civis `AAAA-MM-DD` no fuso `America/Sao_Paulo`;
- validação Zod na borda;
- limite de quantidade de itens e pagamentos por request;
- transações atômicas para vendas;
- soma recebida maior que o total retorna conflito sem persistir;
- venda com saldo sem cliente ou vencimento é rejeitada;
- `paymentStatus` é calculado e não aceito em escrita;
- filtros de vencimento usam `America/Sao_Paulo`;
- respostas nunca expõem IDs ou dados de outro vendedor;
- escrita originada no WhatsApp chama o mesmo serviço de domínio das rotas;
- endpoints de criação aceitam uma chave de idempotência;
- erros de ambiguidade são recuperáveis e não persistem dados parciais.

Antes de implementar, criar uma spec própria com exemplos completos de request,
response, erros e invariantes, seguindo o padrão de
[`api-financeiro-caixa.md`](./api-financeiro-caixa.md).

## Arquitetura e pontos de mudança

### Banco e migrações

- criar cada migração com `supabase migration new`, sem inventar timestamp;
- separar fundação da vertical e integração financeira quando isso facilitar
  rollback e revisão;
- aplicar RLS, revokes, constraints e índices na mesma migração das tabelas;
- testar backfill de `business_mode` com contas existentes;
- rodar advisors e revisar segurança antes de promover;
- não usar extensões novas para este escopo.

### API

Arquivos ou módulos candidatos:

- `apps/api/src/routes/sales.ts`;
- `apps/api/src/routes/business-expenses.ts`;
- `apps/api/src/sales.ts` para regras e transações;
- `apps/api/src/sale-payments.ts` para recebimentos e concorrência;
- `apps/api/src/sales-receivables.ts` para saldos e Pix;
- `apps/api/src/sales-summary.ts` para cálculos puros;
- extensão de `apps/api/src/orchestrator.ts`;
- extensão de `apps/api/src/llm.ts`;
- extensão de `apps/api/src/assistant-data.ts`;
- integração em `apps/api/src/routes/financial.ts`;
- tipos compartilhados em `apps/api/src/types.ts`;
- registro das rotas em `apps/api/src/server.ts`.

Separar interpretação, regra de domínio e persistência. O orquestrador não deve
construir SQL nem recalcular totais que pertencem ao serviço de vendas.

### Web

Arquivos ou módulos candidatos:

- `apps/web/src/pages/Sales.tsx`;
- formulários de venda, gasto e produto;
- listas de entregas e saldos pendentes;
- detalhe da venda com linha do tempo de recebimentos;
- tipos e cliente HTTP em `apps/web/src/types.ts` e `apps/web/src/api.ts`;
- rotas e navegação em `apps/web/src/App.tsx`;
- extensão do Financeiro para as novas origens.

A primeira tela deve priorizar ações: “Para entregar”, “Para receber” e
“Registrar venda”. O resumo do dia vem depois dessas pendências. Relatórios
mensais continuam no Financeiro.

## Estratégia de aquisição e monetização

### Posicionamento

Evitar “sistema de vendas” ou “PDV”, que criam expectativa de estoque, fiscal e
maquininha. Mensagem recomendada:

> Seus pedidos, recebimentos e clientes no WhatsApp. Saiba quem pagou e cobre o
> que falta sem procurar em conversas.

Variação para ambulante relacional:

> Registre vendas e encomendas, acompanhe quem ainda paga depois e confira seu
> dia pelo WhatsApp.

### Canais de aquisição a testar

1. grupos de revendedores e empreendedores no WhatsApp;
2. comunidades locais de cosméticos, roupas, alimentos e artesanato;
3. indicação entre vendedores com benefício não financeiro simples;
4. contadores e agentes locais que atendem MEIs, sem posicionar o Prestou como
   solução fiscal;
5. distribuidores ou marcas menores em modelo B2B2C, somente após validar uso
   direto e preservar portabilidade dos dados do vendedor;
6. feiras e associações de ambulantes para a persona adjacente.

Não começar com mídia paga ampla. A mensagem “controle de vendas” é genérica e
tende a atrair lojas, restaurantes e operações fora do escopo.

### Oferta e preço a validar

Hipóteses:

- teste gratuito ou piloto assistido até o primeiro valor percebido;
- plano individual entre R$ 14,90 e R$ 29,90 por mês;
- sem taxa por venda e sem dinheiro passar pelo Prestou;
- limite por volume de mensagens ou clientes somente se custo real exigir;
- plano gratuito permanente não deve ser decidido antes de medir retenção e
  custo de WhatsApp.

O teste de preço deve exigir compromisso observável: reserva, pré-cadastro com
preço exposto ou pagamento reembolsável. Perguntar apenas “você pagaria?” gera
falso positivo.

### Momento de ativação

Usuário ativado é aquele que, em até 24 horas:

1. registra uma venda ou pedido real;
2. confirma total e recebido;
3. quando houver saldo, vê a venda em “Para receber”;
4. consulta o registro pelo WhatsApp ou Dashboard.

Cadastrar perfil, produto ou abrir o Dashboard não conta como ativação.

### Loop de retenção

```text
novo pedido
  → registra e confirma
  → entrega ou recebe depois
  → Prestou lembra o saldo no contexto certo
  → vendedor registra o recebimento
  → consulta caixa e pendências
  → registra o próximo pedido
```

A retenção deve vir do ciclo de pedidos e saldos. Fechamento diário é um loop
secundário e não deve ser obrigatório.

## Plano do piloto

### Amostra

- 12–15 participantes;
- ao menos 8 com score de ICP alto;
- categorias variadas, mas no máximo quatro para não fragmentar aprendizado;
- ao menos 5 que recebam entrada + saldo toda semana;
- ao menos 3 ambulantes relacionais;
- excluir usuários que dependam de fiscal, vários funcionários ou parcelário.

### Duração e suporte

- uma semana de baseline observando o método atual;
- duas semanas usando a experiência concierge ou produto;
- entrevista curta no início, no terceiro dia, no sétimo e no encerramento;
- suporte disponível, mas toda intervenção manual é registrada como fricção;
- nenhum lembrete humano silencioso: medir separadamente uso espontâneo e uso
  provocado.

### Dados de baseline

- pedidos por semana;
- proporção à vista, parcial e posterior;
- quantidade de clientes recorrentes;
- tempo para localizar um pedido;
- saldos esquecidos ou cobrados com atraso;
- ferramentas atuais;
- frequência de fechamento;
- valor médio das vendas;
- aplicativos fornecidos por marcas;
- preço percebido de uma venda recuperada.

### Diário de evidências

Para cada participante, registrar:

- mensagem original anonimizada;
- intenção esperada e resultado;
- campos que precisaram de pergunta;
- proposta confirmada, corrigida ou abandonada;
- resultado de negócio, como pagamento recuperado ou entrega lembrada;
- intervenção do time;
- motivo de não uso em cada dia;
- objeção de preço;
- pedido de funcionalidade, sem converter automaticamente em roadmap.

### Critérios de decisão

**Avançar:** gates de comportamento e valor atingidos, sem falha crítica de
confiança.

**Iterar:** dor confirmada, mas linguagem, registro ou canal impedem hábito.

**Reposicionar:** fechamento é usado, mas pedido e saldo não geram valor; testar
ambulante de caixa antes de construir contas a receber completas.

**Encerrar o beachhead:** problema raro, aplicativo de marca já resolve ou
disposição de pagamento não cobre aquisição e operação.

## Roadmap por gates

### Fase 0 — Descoberta e concierge

Objetivo: provar que pedido + saldo a receber é mais valioso que apenas
fechamento, antes de modelar estoque.

- recrutar de 12 a 15 vendedores, priorizando score de ICP acima de 15;
- incluir ao menos 6 revendedores relacionais, 3 ambulantes relacionais e 3
  candidatos de fit médio para contraste;
- acompanhar pelo menos cinco jornadas reais de pedido até recebimento;
- observar como identificam cliente, produto, entrega, entrada e saldo;
- medir quantas vendas ficam parcial ou integralmente pendentes;
- mapear como cobram sem constrangimento;
- verificar se aplicativos de marcas já resolvem pedidos ou apenas reposição;
- mapear como separam dinheiro pessoal e mercadoria;
- testar as palavras “pedido”, “venda”, “entrada”, “falta receber”, “gasto”,
  “sobrou”, “saldo” e “lucro”;
- simular o assistente manualmente com mensagens reais;
- comparar registro por pedido, venda individual e lote;
- medir se o usuário volta sem lembrete humano;
- testar disposição de pagamento em R$ 14,90, R$ 19,90 e R$ 29,90;
- registrar pedidos de áudio, estoque, Pix e meta sem prometer entrega.

Gate para avançar:

- pelo menos 60% têm duas ou mais vendas posteriores por semana;
- pelo menos 5 participantes registram três dias em sete;
- ao menos metade usa a lista de saldos ou entregas sem intervenção do time;
- a maioria distingue vendido, recebido e a receber;
- pelo menos 40% aceitam pagar R$ 19,90 em um teste de compromisso real;
- há evidência de valor: cobrança recuperada, entrega não esquecida ou redução
  de tempo procurando pedidos.

### Fase 1 — Fundação técnica atrás de feature flag

Objetivo: criar o domínio sem alterar a experiência de Serviços.

- adicionar `business_mode` com backfill seguro;
- criar tabelas, constraints, índices, RLS e revokes;
- implementar serviços de domínio e cálculos puros;
- implementar APIs de produtos, clientes, vendas, recebimentos, saldos, gastos
  e resumo;
- suportar entrada + saldo com lock transacional e sem overpayment;
- gerar Pix do saldo sem acoplar venda a `charges`;
- adicionar idempotência, soft delete e auditoria;
- integrar vendas como origem do Financeiro;
- proteger tudo com feature flag por vendedor;
- instrumentar eventos antes de abrir o piloto.

Gate para avançar:

- testes de isolamento e somas passam;
- zero regressão nos fluxos de cobrança e Financeiro existentes;
- cada centavo de venda é rastreável;
- vendido, recebido e a receber fecham matematicamente;
- concorrência não permite recebimento acima do saldo;
- reprocessar a mesma criação não duplica dados.

### Fase 2 — WhatsApp Vendas

Objetivo: completar o ciclo diário sem exigir o Dashboard.

- adicionar intenções de pedido, venda, recebimento, saldo, entrega, gasto,
  resumo e fechamento;
- implementar rascunho multi-turno e resolução de produto;
- criar propostas confirmáveis por botão;
- tratar ambiguidade no modo híbrido;
- manter limites de custo e abuso existentes;
- testar mensagens incompletas, contraditórias e duplicadas;
- manter o mesmo número e adaptador WhatsApp.

Gate para avançar:

- mediana de até duas mensagens do pedido à proposta correta;
- pelo menos 90% dos casos do conjunto piloto geram proposta correta ou uma
  pergunta segura;
- nenhuma escrita acontece sem confirmação;
- nenhum evento duplicado em retry de webhook.

### Fase 3 — Dashboard e piloto fechado

Objetivo: permitir conferência, correção e acompanhamento.

- lançar `/vendas` para usuários habilitados;
- oferecer modo agregado sem catálogo;
- exibir listas “Para entregar” e “Para receber” antes do resumo;
- exibir fechamento diário e dados incompletos;
- permitir correções auditáveis;
- conduzir piloto com 10 a 20 vendedores por duas semanas;
- fazer suporte assistido e entrevistas ao fim de cada semana;
- revisar preço, posicionamento e frequência de uso.

Gate de product-market signal:

- pelo menos 60% dos ativados registram movimentação em três ou mais dias na
  segunda semana, com ou sem fechamento;
- pelo menos 70% dos pedidos e recebimentos não exigem correção posterior;
- pelo menos metade usa a lista de saldos ou entregas na segunda semana;
- pelo menos metade relata cobrança recuperada, entrega lembrada ou decisão
  prática tomada com o resumo;
- suporte manual fica abaixo de 20% dos dias registrados;
- retenção é motivada pelo fechamento, não apenas por incentivo do piloto.

### Fase 4 — Estoque e margem, condicionada aos dados

Só avançar se falta de estoque ou margem aparecer entre os principais motivos
de uso ou abandono.

Possibilidades:

- movimentos de entrada, venda, perda e ajuste;
- contagem inicial e final do dia;
- sugestão de reposição;
- custo médio ou custo por lote;
- margem bruta estimada;
- metas e reserva para compra;
- registro por áudio;
- cartaz ou QR Pix para impressão;
- conciliação assistida com extrato, após estudo de privacidade e integração.

Antes de usar a palavra “lucro”, validar CMV, compras para múltiplos dias,
perdas, retiradas pessoais e despesas operacionais.

## Métricas

### North star do piloto

**Vendedores com movimentação útil em pelo menos três dias da semana e que
revisitam ao menos uma entrega ou saldo pendente.**

“Movimentação útil” significa pedido, venda, recebimento, entrega, cobrança ou
consulta de pendência real. Fechamento conta, mas não é obrigatório.

### Funil

1. vertical Vendas ativada;
2. primeira venda ou pedido registrado;
3. primeiro cliente associado;
4. primeiro saldo a receber criado;
5. lista “Para receber” consultada;
6. primeiro recebimento posterior registrado;
7. primeiro ciclo pedido → pagamento concluído;
8. movimentação em três dias da mesma semana;
9. retorno na segunda semana;
10. conversão para plano pago.

### Qualidade do produto

- tempo até o primeiro registro;
- mensagens até uma proposta confirmável;
- taxa de correção e exclusão;
- violações da identidade `vendido = recebido + saldo`;
- distribuição de vendas `paid`, `partial` e `unpaid`;
- tempo entre venda e recebimento;
- saldos vencidos e recuperados;
- entregas pendentes resolvidas;
- uso do Pix preparado para o saldo;
- vendas sem produto e sem cliente;
- fechamentos marcados como `needs_review`;
- proporção de registros agregados versus por produto;
- proporção Pix, dinheiro e outras formas;
- usuários que abrem o Dashboard após registrar pelo WhatsApp;
- perguntas sobre “lucro” e estoque.

### Métricas de ICP e negócio

- score de aderência na entrada;
- retenção por faixa de score;
- retenção por categoria de produto;
- proporção de usuários com pagamento posterior semanal;
- valor financeiro recuperado após consulta ou cobrança;
- disposição e conversão por preço testado;
- custo de suporte por vendedor ativo;
- custo de WhatsApp e LLM por ciclo concluído;
- origem da aquisição e taxa de indicação;
- razões de churn: pouco volume, app da marca, preço, hábito ou produto faltante.

### Qualidade do assistente

- intenção reconhecida;
- intenção ambígua;
- proposta confirmada, corrigida, cancelada ou expirada;
- mensagens não suportadas;
- latência e custo por fluxo;
- duplicidades impedidas;
- falhas por janela de atendimento;
- respostas incorretas encontradas no conjunto de avaliação.

### Guardrails

- zero acesso entre vendedores;
- zero venda ou gasto persistido sem confirmação;
- zero recebimento acima do saldo;
- zero venda com saldo sem cliente e vencimento;
- zero duplicidade por retry conhecido;
- totais do WhatsApp, API, Dashboard e exportação idênticos;
- nenhuma queda relevante na conclusão de cobranças da vertical Serviços;
- nenhuma mensagem proativa sem consentimento e template adequados.

## Plano de testes

### Unidade

- soma de itens, recebimentos e saldo;
- estados derivados `unpaid`, `partial` e `paid`;
- bloqueio de overpayment;
- vendido por data da venda e recebido por data efetiva;
- divisão por forma de pagamento;
- entrada, saída e saldo;
- interpretação de datas no fuso de São Paulo;
- fechamento e invalidação após alteração;
- formatação monetária;
- resolução determinística de produto;
- transições de proposta.

### Integração da API e banco

- isolamento por `provider_id` em todas as rotas;
- transação completa de venda;
- rollback se item ou pagamento falhar;
- lock concorrente ao registrar recebimento;
- duas confirmações simultâneas não ultrapassam o saldo;
- idempotência de criação;
- soft delete e auditoria;
- backfill de contas de Serviços;
- venda com várias formas de pagamento;
- venda sem produto integralmente paga;
- venda com saldo exige cliente e vencimento;
- venda com entrada e saldo;
- recebimento posterior move `partial` para `paid`;
- correção de recebimento pode reabrir saldo;
- vínculo entre venda, cliente e recebimento não cruza `provider_id`;
- BR Code é gerado para o saldo atual, não para o total original;
- integração sem duplicidade com Financeiro e CSV;
- fechamento reaberto por edição;
- constraints e índices esperados;
- RLS habilitada e ausência de grants diretos.

### Orquestrador e WhatsApp

- vendedor de Serviços não recebe ferramentas de Vendas por engano;
- vendedor de Vendas não entra no fluxo de cobrança por engano;
- vendedor híbrido recebe desambiguação;
- rascunho incompleto continua na mensagem seguinte;
- botão confirma somente a proposta daquele vendedor e canal;
- proposta expirada ou já usada não executa;
- webhook repetido não duplica;
- mensagens desconhecidas não criam conta nem acessam dados;
- nenhum dado financeiro é enviado ao LLM.

### Web

- estados vazio, carregando e erro;
- criação agregada e por produto;
- divisão de pagamento;
- criação de pedido com entrada e saldo;
- listas de entrega e recebimento;
- linha do tempo de recebimentos;
- correção e exclusão com modal;
- fechamento e estado `needs_review`;
- navegação correta por modo de negócio;
- acessibilidade e uso em tela pequena.

### Casos de aceite do MVP

1. “Vendi 180, 120 Pix e 60 dinheiro” cria uma venda de R$ 180 após
   confirmação e aparece igual no dia e no Financeiro.
2. “Maria pediu dois kits de 40, pagou 30 e paga 50 sexta” cria venda de R$ 80,
   recebimento de R$ 30 e saldo de R$ 50 com cliente e vencimento.
3. Soma recebida menor que o total é permitida; maior que o total é rejeitada.
4. Venda integralmente paga pode ser registrada sem produto e sem cliente.
5. Venda com saldo sem cliente ou vencimento é rejeitada.
6. “A Maria pagou os 50 que faltavam” registra após confirmação e quita somente
   a venda correta.
7. Duas confirmações concorrentes do último saldo produzem um recebimento.
8. Pix preparado usa o saldo atual e não cria entrada financeira.
9. “Gastei 60 com mercadoria” reduz o saldo do dia, mas não o total Recebido.
10. Excluir uma venda não a apaga e remove seus recebimentos dos totais.
11. Editar o dia de uma venda a move entre períodos e invalida o fechamento
   anterior.
12. Não fechar o dia mantém dados e marca o período como não conferido.
13. Uma conta híbrida pode criar cobrança e venda no mesmo número.
14. “Recebi 100 da Maria” em modo híbrido pede esclarecimento.
15. Retry do mesmo webhook produz uma única venda.
16. Um vendedor não consegue consultar, editar ou confirmar dados de outro.
17. Contas existentes continuam em Serviços sem mudança visível.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Escopo virar um PDV completo | manter gates e lista explícita de fora do MVP |
| Usuário não registrar todo dia | lote, poucos campos e teste concierge antes do build completo |
| Saldo ser entendido como lucro | linguagem e explicação fixa; não prometer lucro no MVP |
| Mistura entre Serviços e Vendas | domínios, tabelas e intenções separados |
| Duplicidade no Financeiro | venda como fonte direta, sem `manual_receipt` espelho |
| Vendido ser confundido com recebido | cards, datas e linguagem separados em todas as superfícies |
| Entrada ser interpretada como quitação | proposta sempre mostra total, recebido e falta receber |
| Corrida gerar recebimento acima do saldo | lock transacional, constraint e idempotência |
| Cobrança de saldo duplicar `charges` | Pix preparado sem persistência no MVP; generalização posterior |
| App da marca já resolver pedidos | recrutar multimarcas e medir lacuna de recebimento/cobrança |
| Cadastro de cliente gerar atrito | exigir apenas com saldo/entrega e reaproveitar clientes recorrentes |
| Cliente se sentir constrangido | mensagem editável, envio manual e nenhum disparo automático no piloto |
| Ambiguidade no WhatsApp híbrido | pergunta de desambiguação e contexto pendente por domínio |
| Erro do LLM criar dado financeiro | confirmação, cálculo determinístico e escrita exclusiva no backend |
| Cliente final acessar assistente | aceitar somente número de vendedor verificado no piloto |
| Estoque incorreto destruir confiança | não lançar estoque antes de validar rotina e modelo de custo |
| Aumento de custo de mensagens | respostas compactas, limites existentes e sem lembrete proativo inicial |
| Regressão em Serviços | feature flag, backfill conservador e suíte de regressão |

## Perguntas abertas para descoberta

1. O vendedor prefere registrar ao longo do dia, por turno ou apenas no fim?
2. Ele pensa em quantidade de produtos ou apenas no total vendido?
3. Como confere vendas em dinheiro?
4. Compra mercadoria diariamente ou para vários dias?
5. Quais gastos considera parte do negócio?
6. O termo “saldo do dia” é compreendido sem ser confundido com lucro?
7. Catálogo inicial ajuda ou atrasa a ativação?
8. Áudio é necessidade real no ambiente de trabalho?
9. Um lembrete de fechamento seria útil ou invasivo?
10. A separação Pix/dinheiro muda alguma decisão concreta?
11. Vendedores usam a mesma chave Pix para vida pessoal e negócio?
12. Quantos participantes também prestam serviços e precisam do modo híbrido?
13. Quantas vendas por semana são pagas depois ou parcialmente?
14. Entrada e saldo costumam ter uma ou várias datas de pagamento?
15. Em que momento o pedido vira venda para o usuário: combinação, entrega ou
    pagamento?
16. O cliente paga antes, na entrega ou depois dela?
17. Como o vendedor identifica pedidos com nomes repetidos?
18. O aplicativo de uma marca registra o recebimento ou somente o pedido?
19. Qual foi o último pagamento esquecido ou cobrado atrasado?
20. Uma mensagem com Pix é suficiente ou a confirmação do cliente é essencial?
21. O que faria o vendedor registrar um pedido no Prestou em vez de deixá-lo na
    conversa original?
22. Qual compromisso real aceita assumir em R$ 14,90, R$ 19,90 e R$ 29,90?

## Sequência recomendada de entrega

1. Executar a descoberta e registrar evidências.
2. Validar frequência de pagamento posterior e apps de marca no ICP.
3. Fechar linguagem de pedido, vendido, recebido, saldo e entrega.
4. Especificar API, concorrência e invariantes do domínio.
5. Criar fundação de dados atrás de feature flag.
6. Entregar pedido, venda e recebimento parcial com testes.
7. Integrar Financeiro e carteira a receber sem duplicidade.
8. Entregar intenções e confirmações no mesmo WhatsApp.
9. Entregar as listas “Para entregar” e “Para receber”.
10. Entregar fechamento não obrigatório e gastos.
11. Rodar piloto fechado e decidir continuar, ajustar ou encerrar.
12. Só então avaliar página pública, estoque, margem, voz e QR impresso.

## Definição de pronto do MVP

- um vendedor pode ativar Vendas sem perder Serviços;
- o mesmo número do Prestou atende os modos configurados;
- vendas e gastos podem ser registrados e corrigidos por WhatsApp e web;
- pedidos podem ter cliente, entrega, entrada e um saldo com vencimento;
- recebimentos posteriores atualizam saldo sem overpayment;
- “vendido”, “recebido” e “a receber” têm datas e totais distintos;
- cliente é opcional à vista e obrigatório com saldo ou entrega;
- produto é opcional e sua ausência não bloqueia o Financeiro;
- toda escrita do WhatsApp é confirmada e idempotente;
- o fechamento é opcional e mostra vendido, entrada, saída e saldo explicáveis;
- vendas aparecem no Financeiro exatamente uma vez;
- contas existentes não sofrem regressão;
- isolamento, RLS, revokes e auditoria foram verificados;
- métricas do funil e guardrails estão disponíveis;
- o piloto atingiu ou não atingiu seus gates com evidência suficiente para uma
  decisão explícita de produto.

## Relação com documentos existentes

- [`plano-painel-financeiro-fiscal.md`](./plano-painel-financeiro-fiscal.md):
  conceitos de caixa, rastreabilidade e evolução financeira;
- [`api-financeiro-caixa.md`](./api-financeiro-caixa.md): contrato atual que
  deverá receber a nova origem de entrada;
- [`ADR-009-assistente-whatsapp-first.md`](./decisoes/ADR-009-assistente-whatsapp-first.md):
  mesmo cérebro e duas portas de entrada;
- [`ADR-010-memoria-de-preenchimento-de-cobranca.md`](./decisoes/ADR-010-memoria-de-preenchimento-de-cobranca.md):
  referência para rascunhos multi-turno;
- [`protocolo-confirmacao-acoes-assistente.md`](./protocolo-confirmacao-acoes-assistente.md):
  confirmação persistida de escritas;
- [`fluxo-cadastro-convite-autenticacao-whatsapp.md`](./fluxo-cadastro-convite-autenticacao-whatsapp.md):
  identidade canônica e segura pelo número verificado.
