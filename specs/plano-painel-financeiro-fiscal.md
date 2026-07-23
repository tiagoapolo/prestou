---
title: "Plano de produto — Painel financeiro, notas fiscais e preparação tributária"
created: 2026-07-23
status: fase-1-implementada
tags:
  - prestou
  - produto
  - financeiro
  - notas-fiscais
  - impostos
---

# Plano de produto — Painel financeiro, notas fiscais e preparação tributária

## Contexto

O Prestou já ajuda prestadores de serviço a criar cobranças via Pix, acompanhar
quem deve e confirmar pagamentos. A próxima oportunidade é transformar esses
registros em uma visão financeira mensal simples e confiável.

O produto deve ajudar o prestador a responder, progressivamente:

1. Quanto dinheiro entrou neste mês?
2. Quanto ainda tenho a receber?
3. Quais serviços precisam de nota fiscal?
4. Quais informações preciso guardar ou entregar ao contador?
5. Como me preparo para minhas obrigações tributárias?

Esta spec registra hipóteses e um plano inicial. As partes marcadas como
pendentes dependem de entrevistas com prestadores e de definição do público
prioritário.

## Decisões confirmadas para a Fase 1

Decisões registradas em 2026-07-23:

- “Recebido no mês” usa a data efetiva em que o dinheiro entrou;
- receitas recebidas fora de uma cobrança podem ser adicionadas manualmente;
- formas de pagamento: Pix, dinheiro, cartão, transferência e outro;
- pagamentos parciais ficam fora da Fase 1;
- data, valor, forma de pagamento e observação podem ser corrigidos com auditoria;
- um recebimento pode ser removido por soft delete financeiro, sem reabrir ou
  alterar o status da cobrança e sem apagar o histórico;
- despesas ficam fora da Fase 1;
- os números principais são recebido no mês, comparação com mês anterior, a
  receber e em atraso;
- Financeiro é uma opção fixa na navegação;
- qualquer mês com registros pode ser consultado;
- cliente é opcional em uma receita avulsa;
- comandos financeiros de escrita pelo WhatsApp ficam para depois da validação
  da experiência web;
- a primeira exportação é CSV, com data do recebimento, cliente, serviço, valor,
  forma de pagamento, origem, situação e observação.

A especificação do contrato entregue está em
[`api-financeiro-caixa.md`](./api-financeiro-caixa.md).

## Promessa do produto

> Feche seu mês em poucos minutos: veja quanto recebeu, cobre o que falta e
> organize notas e declaração.

O primeiro valor entregue não é fazer contabilidade completa, mas oferecer uma
fonte confiável e compreensível sobre os recebimentos do prestador.

## Estado atual

O Prestou já possui:

- cobranças associadas a clientes;
- valor e vencimento da cobrança;
- estados `em_aberto`, `cliente_confirmou` e `paga`;
- data real de confirmação do pagamento em `paid_at`;
- indicação de pagamento confirmado pelo cliente ou marcado manualmente;
- comprovante opcional;
- endpoint `GET /api/financial-summary`;
- cards de “A receber” e “Recebido” no painel principal;
- consultas financeiras pelo assistente.

A especificação atual do resumo financeiro está em
[`api-cobrancas-clientes-financeiro.md`](./api-cobrancas-clientes-financeiro.md).

### Limitação semântica atual

Atualmente, “Recebido no mês” e o resumo financeiro selecionam cobranças pela
data de vencimento (`due_date`). Uma cobrança vencida em junho e paga em julho,
por exemplo, é contabilizada em junho.

Esse comportamento é útil para analisar a carteira de cobranças, mas não
responde corretamente quanto dinheiro entrou no caixa durante o mês. Antes de
usar esses números para notas, relatórios ou preparação tributária, é necessário
separar explicitamente as visões de competência e caixa.

## Definições financeiras propostas

| Conceito | Pergunta respondida | Data de referência sugerida |
|---|---|---|
| Recebido | Quanto dinheiro entrou? | Data efetiva do pagamento (`paid_at`) |
| Faturado | Quanto foi cobrado por serviços? | Data da prestação ou, provisoriamente, criação da cobrança |
| A receber | Quanto ainda falta entrar? | Cobranças não pagas |
| Em atraso | Quanto está vencido e não foi pago? | Vencimento (`due_date`) |
| Resultado | Quanto sobrou após despesas? | Receitas menos despesas, apenas em fase futura |

O produto deve sempre mostrar o nome do conceito e evitar um único total
ambíguo chamado apenas de “total do mês”.

## Princípios de produto

1. **Caixa antes de contabilidade:** começar pelo dinheiro que efetivamente
   entrou, pois é o conceito mais útil e compreensível para o público inicial.
2. **Números explicáveis:** todo total deve permitir abrir a lista de registros
   que o compõem.
3. **Correção sem perda de histórico:** datas e valores podem ser corrigidos,
   mas mudanças relevantes devem ficar registradas.
4. **Baixo esforço de manutenção:** reaproveitar dados das cobranças e pedir
   somente informações que tenham uso imediato.
5. **Separar gestão, fiscal e tributário:** um painel financeiro, emissão de
   NFS-e e declaração de imposto são problemas relacionados, mas possuem regras
   e níveis de risco diferentes.
6. **Sem promessas regulatórias prematuras:** inicialmente, organizar e exportar
   informações; calcular ou transmitir obrigações somente quando houver
   cobertura e validação suficientes.
7. **Mobile e linguagem simples:** usar termos que o prestador reconheça, com
   explicações curtas para conceitos como “recebido” e “faturado”.

## Experiência proposta

### Área “Financeiro”

Criar uma área própria, separada da visão operacional “Quem me deve”. O painel
principal continua focado em cobrar e receber; o Financeiro passa a concentrar
histórico e fechamento.

Elementos iniciais:

- seletor de mês;
- “Recebido no mês” como número principal;
- comparação com o mês anterior, quando houver base suficiente;
- “A receber” e “Em atraso”;
- lista cronológica de recebimentos;
- busca e filtro por cliente, serviço, situação e origem do pagamento;
- identificação de pagamento confirmado pelo cliente ou marcado manualmente;
- acesso à cobrança e ao comprovante;
- possibilidade de corrigir a data efetiva do pagamento;
- exportação do período.

### Fechamento mensal guiado

O fechamento não precisa bloquear alterações nem imitar um sistema contábil.
Ele pode funcionar como uma lista de conferência:

1. Conferir os pagamentos registrados.
2. Identificar cobranças sem confirmação.
3. Adicionar recebimentos que ocorreram fora do Prestou.
4. Corrigir datas e valores quando necessário.
5. Marcar quais serviços tiveram nota emitida.
6. Baixar ou compartilhar o resumo do mês.

### Estados vazios e confiança

O painel deve explicar quando os dados podem estar incompletos. Exemplo:

> Este valor considera os pagamentos registrados no Prestou. Recebeu por fora?
> Adicione para completar seu mês.

Isso evita apresentar uma falsa sensação de exatidão enquanto nem toda a receita
passar pelo produto.

## Roadmap proposto

### Fase 0 — Descoberta e validação

Objetivo: validar linguagem, necessidade e completude dos dados antes de ampliar
o modelo financeiro.

- entrevistar prestadores de diferentes profissões;
- entender como recebem, anotam, emitem notas e prestam contas hoje;
- descobrir o significado espontâneo de “quanto fiz no mês”;
- testar um protótipo do painel e do fechamento mensal;
- definir o segmento fiscal prioritário: informal, MEI, autônomo PF ou PJ;
- selecionar um município ou cobertura fiscal inicial, se emissão fizer parte
  do escopo.

Critério de avanço: os usuários conseguem explicar corretamente os totais e
consideram o fechamento mensal mais simples que o método atual.

### Fase 1 — Quanto recebi — implementada em 2026-07-23

Objetivo: entregar uma visão mensal de caixa confiável.

- calcular recebido por `paid_at`;
- navegar entre meses;
- exibir histórico de recebimentos do período;
- detalhar os registros que compõem cada total;
- permitir corrigir a data de pagamento;
- registrar recebimento sem cobrança prévia;
- exportar CSV e/ou resumo compartilhável;
- manter a visão operacional de vencimento separada;
- disponibilizar consulta equivalente pelo assistente, com linguagem explícita.

Implementação entregue:

- nova página `/financeiro` e acesso fixo no cabeçalho autenticado;
- visão mensal de caixa baseada em `paid_at` no fuso `America/Sao_Paulo`;
- meses disponíveis derivados dos pagamentos e receitas avulsas existentes;
- comparação com o mês anterior;
- lista rastreável de todos os registros que compõem o total;
- cadastro, edição e exclusão lógica de receita avulsa com cliente opcional;
- correção de valor recebido, data, forma de pagamento e observação;
- soft delete de recebimento sem alterar a cobrança paga;
- trilha de auditoria para criação, correção e exclusão;
- CSV autenticado com as colunas acordadas e proteção contra fórmulas em células;
- totais “Recebido” do Dashboard e do assistente corrigidos para caixa e
  complementados por receitas avulsas;
- migrações `20260723190849_financial_phase_one.sql` e
  `20260723193113_payment_financial_soft_delete.sql`.

Não implementado nesta fase:

- pagamento parcial;
- despesas ou cálculo de lucro;
- notas fiscais;
- novos comandos de escrita no WhatsApp;
- conciliação bancária.

Critérios de aceite iniciais:

- pagamento vencido em junho e recebido em julho aparece no caixa de julho;
- cada centavo do total recebido pode ser rastreado até um registro;
- alteração de data move o recebimento entre meses de forma previsível;
- registros externos ao Prestou são claramente identificados;
- os cálculos respeitam o fuso `America/Sao_Paulo`;
- totais não dependem da paginação da lista;
- exportação e interface apresentam os mesmos valores.

### Fase 2 — Organização de notas fiscais

Objetivo: mostrar o que precisa de nota e guardar o resultado da emissão.

- estado da nota por receita: `nao_informado`, `nao_necessaria`, `pendente` ou
  `emitida`;
- data da prestação do serviço;
- CPF/CNPJ opcional do cliente;
- dados fiscais do prestador;
- descrição fiscal do serviço;
- número, data e arquivo da nota emitida;
- relatório “Notas pendentes do mês”;
- pacote de informações pronto para copiar para o emissor ou enviar ao contador.

Nesta fase, o Prestou organiza dados e registra notas emitidas fora da
plataforma. Não há promessa de emissão universal.

### Fase 3 — Facilitação ou emissão de NFS-e

Objetivo: reduzir o retrabalho entre a cobrança e o emissor fiscal.

- gerar rascunho da nota a partir da cobrança;
- sugerir dados previamente usados, sem assumir classificação fiscal;
- integrar com o padrão nacional ou provedores municipais compatíveis;
- emitir somente para municípios e regimes explicitamente suportados;
- acompanhar sucesso, falha, cancelamento e substituição;
- armazenar documento e identificadores retornados pelo emissor.

A cobertura depende de município, regime tributário, código do serviço,
retenções e disponibilidade de integração. É necessário estudo específico antes
de definir arquitetura ou promessa comercial.

### Fase 4 — Preparação tributária

Objetivo: organizar informações para obrigações, sem substituir um contador.

O produto deve criar experiências diferentes conforme o perfil:

- **MEI:** faturamento mensal e anual, alertas de limite e apoio à organização
  para DASN-SIMEI;
- **autônomo pessoa física:** receitas, identificação do pagador, possíveis
  despesas e exportação para apoiar Carnê-Leão/IRPF;
- **empresa fora do MEI:** relatórios e arquivos para o contador.

Qualquer cálculo tributário, recomendação de dedutibilidade ou transmissão de
declaração exige validação jurídica/contábil e atualização contínua das regras.

## Dados necessários

### Curto prazo

- data efetiva do recebimento;
- origem do registro: cobrança Prestou ou receita adicionada manualmente;
- forma de pagamento;
- observação opcional;
- autor e data de alterações financeiras;
- motivo opcional para correção ou estorno.

### Para notas fiscais

- data da prestação do serviço;
- situação da nota;
- CPF/CNPJ e dados fiscais do prestador;
- CPF/CNPJ opcional do cliente;
- descrição e classificação do serviço;
- município de incidência, quando aplicável;
- número, data, arquivo e identificadores externos da nota;
- histórico de cancelamento ou substituição.

### Para preparação tributária futura

- perfil fiscal do prestador;
- receitas que não nasceram em cobranças;
- estornos e descontos;
- categorias de receita;
- despesas e documentos, caso o escopo inclua resultado ou deduções;
- exportações anuais imutáveis ou reproduzíveis.

O modelo de dados definitivo deve ser desenhado apenas depois de decidir o
segmento fiscal inicial. Campos específicos de MEI, autônomo PF e demais
empresas não devem ser misturados em um cadastro genérico sem necessidade.

## Mudanças técnicas prováveis

- redefinir ou versionar `GET /api/financial-summary` para separar caixa e
  carteira por vencimento;
- criar uma consulta mensal baseada em `paid_at`;
- permitir edição controlada da data efetiva do recebimento;
- criar entidade de receita que possa existir sem uma cobrança, ou definir uma
  forma explícita de cobrança avulsa já paga;
- modelar ajustes e estornos sem apagar o histórico original;
- adicionar trilha de auditoria para mudanças financeiras;
- criar exportação no backend para garantir consistência dos cálculos;
- atualizar as ferramentas do assistente para distinguir “recebido”, “cobrado”
  e “a receber”;
- revisar política de retenção e LGPD para documentos fiscais e dados de CPF/CNPJ.

### Decisão arquitetural pendente: receita versus pagamento

Existem pelo menos duas alternativas:

1. Manter `payments` como fonte de receitas e criar pagamentos manuais ligados a
   uma cobrança mínima.
2. Criar uma entidade financeira própria, capaz de representar receita,
   pagamento, ajuste e estorno independentemente da cobrança.

A alternativa 1 reduz o escopo do MVP. A alternativa 2 oferece uma base mais
correta para notas, despesas e contabilidade futura, mas aumenta sensivelmente a
complexidade. A decisão deve ser tomada após validar se recebimentos “por fora”
são frequentes e essenciais.

## Métricas de produto

### Adoção

- percentual de prestadores que abrem o Financeiro mensalmente;
- percentual que consulta um mês anterior;
- percentual que conclui a conferência mensal;
- quantidade de receitas externas adicionadas.

### Valor e confiança

- percentual de usuários que consegue responder corretamente quanto recebeu;
- divergência relatada entre o Prestou e o controle pessoal do usuário;
- percentual de registros corrigidos;
- exportações ou compartilhamentos por fechamento;
- notas pendentes resolvidas após entrar no painel.

### Retenção

- retenção mensal de quem usa o Financeiro versus quem usa apenas cobranças;
- frequência de criação de cobranças após adoção do painel;
- retorno ao produto no início e no fim do mês.

## Riscos

### Produto

- o painel ficar incompleto porque parte dos recebimentos acontece fora do
  Prestou;
- usuários confundirem faturado, recebido e lucro;
- exigir tantos dados que criar uma cobrança deixe de ser simples;
- tentar atender simultaneamente informal, MEI, autônomo PF e PJ.

### Confiança e dados

- pagamentos marcados no mês errado;
- correções sem trilha de auditoria;
- divergência entre painel, exportação e assistente;
- duplicidade ao registrar manualmente um recebimento que já tinha cobrança.

### Fiscal e regulatório

- regras distintas entre municípios e regimes;
- mudanças regulatórias;
- tratamento de CPF/CNPJ e documentos fiscais ampliar o risco de privacidade;
- linguagem do produto ser interpretada como aconselhamento contábil;
- apresentar estimativas tributárias como valores definitivos.

## Perguntas em aberto

### Público e problema

1. Quem é o público prioritário: informal sem CNPJ, MEI, autônomo pessoa física,
   pequena empresa ou uma mistura?
2. Quais profissões formam o primeiro grupo de validação?
3. O que esses prestadores entendem espontaneamente por “quanto fiz no mês”:
   recebido, cobrado, lucro ou os três?
4. Como eles controlam receitas hoje e qual parte desse processo mais incomoda?

### Completude financeira

5. Os prestadores recebem apenas por cobranças criadas no Prestou?
6. Com que frequência recebem por Pix, dinheiro ou cartão sem registrar uma
   cobrança?
7. Precisam registrar pagamentos parciais, descontos, gorjetas, estornos ou
   parcelamentos?
8. O prestador deve poder alterar valor e data depois da confirmação?
9. Despesas fazem parte da proposta futura ou o Prestou permanecerá focado em
   receitas?

### Notas fiscais

10. O objetivo inicial é organizar dados, anexar notas já emitidas ou emitir a
    NFS-e dentro do Prestou?
11. Os clientes são principalmente pessoas físicas ou empresas?
12. Em quais situações os clientes exigem nota?
13. Os primeiros usuários estão concentrados em um município? Qual?
14. Eles já usam algum emissor e onde encontram maior dificuldade?

### Tributário

15. O primeiro caso tributário será MEI, autônomo PF ou relatório para contador?
16. O valor percebido está no acompanhamento durante o ano ou apenas na época da
    declaração?
17. Existe contador ou especialista fiscal para validar linguagem e regras?

### Canal e negócio

18. O Financeiro será usado principalmente no site ou também pelo WhatsApp?
19. Consultas como “quanto recebi em julho?” devem fazer parte do primeiro MVP?
20. O módulo será gratuito, parte de uma assinatura ou um mecanismo de retenção
    antes da monetização?
21. Quantos prestadores reais estão disponíveis para entrevistas e teste do
    protótipo?

## Próximos passos quando o tema for retomado

1. Responder às perguntas de público, completude financeira e objetivo fiscal.
2. Realizar entrevistas com prestadores do piloto.
3. Escrever as definições validadas de “recebido”, “faturado” e “a receber”.
4. Prototipar o painel mensal e o fechamento guiado.
5. Testar compreensão e confiança antes de implementar.
6. Produzir uma spec técnica apenas para a Fase 1.
7. Tratar notas fiscais e preparação tributária em specs próprias após definir o
   segmento e a cobertura inicial.

## Fora do escopo desta spec

- cálculo definitivo de imposto;
- transmissão de declaração de IR;
- contabilidade completa;
- emissão universal de NFS-e;
- conciliação bancária automática;
- definição legal sobre obrigatoriedade de nota ou dedutibilidade de despesas.
