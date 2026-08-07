---
title: "Teste de disposição de pagamento — gate zero do Prestou"
created: 2026-08-05
updated: 2026-08-05
status: proposta-para-execucao-imediata
tags:
  - prestou
  - produto
  - monetizacao
  - descoberta
---

# Teste de disposição de pagamento — gate zero do Prestou

## Por que este documento existe

O Prestou nunca cobrou de ninguém. Não há provedor de pagamento, tabela de
assinatura, plano nem trial no código, e `providers` não tem coluna de status
de pagamento. A disposição de pagar nunca foi testada — nem na vertical de
Serviços, que já existe e funciona.

O [plano da vertical de Vendas](./plano-vertical-vendas-whatsapp-v2.md) assume
um plano individual entre R$ 14,90 e R$ 29,90 e trata a validação de preço como
um item dentro da Fase 0 de descoberta. Isso inverte a ordem: é a pergunta que
decide se as outras importam, e ela pode ser respondida em três semanas sem
escrever uma linha da vertical.

> **A pergunta:** algum usuário do Prestou paga pelo Prestou, e por qual meio o
> dinheiro consegue chegar até nós?

São duas perguntas de propósito. Disposição sem mecanismo viável de cobrança não
vira receita neste público.

## Escopo

**Dentro:** cobrar usuários reais de Serviços, com dinheiro real, e medir quem
paga e como.

**Fora:** construir qualquer coisa da vertical de Vendas; definir plano
definitivo, tabela de preços ou política de gratuidade; migrar todos os usuários
para pago; qualquer mudança na experiência de quem não aceitar.

## O que já dá para segmentar hoje

Não é preciso instrumentar nada novo para escolher a amostra. A tabela `events`
já registra `cobranca_criada`, `mensagem_enviada`, `link_aberto`,
`codigo_copiado`, `cliente_confirmou`, `prestador_confirmou` e
`marcado_pago_manual` por prestador.

Antes de qualquer outra coisa, extrair:

- total de providers cadastrados;
- quantos criaram ao menos uma cobrança nos últimos 60 dias;
- quantos tiveram ao menos uma cobrança concluída nos últimos 60 dias;
- distribuição de cobranças concluídas por prestador no período;
- `vazamentoPct` atual da função `funnel()`.

Esse retrato define o tamanho da amostra e decide se o teste produz número ou
apenas evidência qualitativa. Ele também é insumo do ramo alternativo de
monetização, se a assinatura não funcionar.

## Amostra

**Elegíveis:** providers com **ao menos uma cobrança concluída nos últimos 60
dias**. Não "cadastrados", não "ativos no login". Quem nunca fechou um ciclo de
cobrança não recebeu valor e não informa nada sobre disposição de pagar.

Oferecer a **todos** os elegíveis. Não sortear, não segmentar por perfil, não
começar pelos mais simpáticos — isso enviesa exatamente na direção do falso
positivo.

Registrar à parte, sem oferta, dois grupos de controle observacional:

- **cadastrados sem ciclo concluído:** medir se algum procura o plano
  espontaneamente;
- **inativos há mais de 60 dias:** medir se a comunicação os traz de volta.

### Se houver menos de 25 elegíveis

O teste continua valendo, mas **muda de natureza**: o resultado é o número
absoluto de pagantes mais o conteúdo das entrevistas, nunca um percentual.
Relatar "4 de 11 pagaram" — jamais "36% de conversão". Com essa base, um
percentual é ruído com aparência de dado.

## A oferta

### Formato

Anunciar que o Prestou terá planos pagos e abrir uma condição de fundador:
preço travado enquanto a assinatura estiver ativa, para quem aderir agora.

**Ninguém perde acesso por não aderir durante o teste.** Isso subestima a
disposição real — quem não é obrigado paga menos que quem é. É deliberado: o
erro fica do lado conservador, e um "sim" nessas condições é um sinal forte, não
inflado. Paywall obrigatório contamina a medição com pânico em vez de valor, e
arrisca a base inteira num momento em que ela é pequena.

### Preço

**Um preço só: R$ 19,90/mês.** Não testar três faixas.

Com a amostra provável, três células de preço produzem grupos pequenos demais
para distinguir qualquer coisa. A elasticidade se investiga de outro jeito, sem
gastar amostra: **quantitativo em quem converte, qualitativo em quem não
converte.** Na entrevista com quem recusou, perguntar o preço de reserva e a que
preço mudaria de ideia. Isso dá a curva sem precisar de células.

### Empacotamento

Duas opções de compra, e a escolha entre elas é metade do aprendizado:

| Opção | Preço | O que testa |
|---|---|---|
| Mensal no cartão | R$ 19,90/mês | assinatura clássica e penetração de cartão |
| Anual no Pix, à vista | R$ 179 (≈ R$ 14,90/mês) | se o desembolso único resolve a cobrança recorrente |

A hipótese por trás da segunda linha: neste público, cartão de crédito é menos
comum e cobrança recorrente falha muito. Um Pix único de R$ 179 pode converter
melhor do que R$ 19,90 recorrentes, e resolve o problema de cobrança de uma vez
— ao custo de um pedido inicial maior. **Se a maioria escolher o anual em Pix,
isso reorienta toda a estratégia de monetização**, e é uma descoberta que nenhum
questionário produziria.

### Garantia

Reembolso integral em até 30 dias, sem justificativa e sem negociação. O
reembolso é barato e é o que torna o compromisso honesto: quem paga sabendo que
pode desistir está sinalizando valor, não sendo capturado.

## Meio de cobrança — a metade esquecida do teste

Disposição sem trilho é receita imaginária. O teste precisa exercitar o
mecanismo real, não simulá-lo.

Requisitos mínimos:

- um PSP que aceite cartão recorrente e Pix avulso, com o menor esforço de
  integração possível (a integração aqui é descartável — não é arquitetura, é
  instrumento de teste);
- cobrança só após confirmação explícita, com valor e recorrência na tela;
- registro de cada tentativa de pagamento, inclusive as que falham;
- caminho de cancelamento em uma mensagem, sem retenção forçada.

**Métrica de viabilidade do trilho** — tão importante quanto a conversão:

- quantos escolheram cartão e quantos escolheram Pix anual;
- taxa de recusa do cartão na primeira cobrança;
- quantos declararam não ter cartão de crédito;
- quantos abandonaram no formulário de pagamento.

Uma conversão boa com 40% de recusa de cartão não é uma conversão boa. É um
problema de trilho disfarçado de sucesso.

> **Verificar antes de fechar o desenho:** o estado atual de Pix Automático como
> mecanismo de recorrência. Se estiver disponível e com adoção razoável nos
> bancos do público, ele muda o quadro — recorrência sem cartão é exatamente o
> que falta aqui. Não assumir sem confirmar.

## O que conta como conversão

**Conversão = método de pagamento cadastrado E primeira cobrança compensada.**
Dinheiro que efetivamente entrou.

Não contam, em nenhuma hipótese:

- clicar em "tenho interesse";
- responder que pagaria, na entrevista ou por mensagem;
- preencher formulário sem concluir pagamento;
- prometer pagar depois.

Reembolsos pedidos dentro da janela são **subtraídos** do total. O número que
importa é o de pagantes que continuaram pagantes ao fim de 30 dias.

## Instrumentação

Estender o union `EventType` em [analytics.ts:5](apps/api/src/analytics.ts:5)
com os eventos do funil de cobrança. É aditivo e não mexe em nada existente:

- `plano_exibido`;
- `plano_selecionado` (metadata: `mensal` ou `anual`);
- `pagamento_iniciado`;
- `pagamento_confirmado`;
- `pagamento_falhou` (metadata: motivo);
- `assinatura_cancelada`;
- `reembolso_solicitado`.

Isso reaproveita a tabela `events` e a função `funnel()` que já existem, e deixa
o resultado do teste consultável pelo mesmo caminho das outras métricas.

## Comunicação

Uma mensagem no WhatsApp, do número que o usuário já conhece, sem template de
marketing e dentro da janela de atendimento quando possível. Conteúdo:

1. o Prestou vai passar a ter plano pago;
2. quanto custa e o que está incluído;
3. condição de fundador, com preço travado;
4. quem não quiser agora continua usando normalmente durante o teste;
5. reembolso em 30 dias, sem pergunta;
6. um link para escolher mensal no cartão ou anual no Pix.

Proibido no texto: contagem regressiva falsa, escassez inventada, sugestão de
que o acesso será cortado em data que não está decidida, e qualquer redação que
faça a recusa parecer perda. Se a oferta só converte com pressão, ela não
converteu — e você levaria essa ilusão para dentro de um trimestre de
engenharia.

## Entrevistas

Com **todos** que recusarem, e com todos que pagarem. São dois roteiros curtos.

**Quem pagou** — o que te fez pagar; que problema você teria de volta se o
Prestou sumisse amanhã; você lembra de um caso concreto em que ele te fez ganhar
ou recuperar dinheiro; por que escolheu mensal ou anual.

**Quem não pagou** — o que te faria pagar; qual preço você acharia justo; se
fosse metade do preço, você pagaria; o problema que ele resolve é seu problema
ou é problema de outra pessoa; como você resolveria isso hoje se o Prestou não
existisse; o que você paga hoje que é parecido.

A pergunta de preço de reserva vem **depois** da recusa, nunca antes — perguntar
preço antes ancora a decisão e estraga a medição.

## Gates de decisão

Com base conhecida e ao menos 25 elegíveis, ler assim (bandas aproximadas, para
calibração — não são limiares exatos):

| Pagantes ao fim de 30 dias | Leitura |
|---|---|
| ~30% ou mais dos elegíveis | assinatura funciona; seguir |
| ~10% a 30% | ambíguo; a pergunta vira *quem* pagou |
| menos de ~10% | assinatura não é o modelo |

Com menos de 25 elegíveis, ignorar a tabela e decidir pelo conjunto: número
absoluto de pagantes, o que eles têm em comum, e o que os recusantes disseram.

### Ramo A — converte bem

A monetização está validada no público mais fácil. A vertical de Vendas passa a
ser jogada de crescimento sobre um modelo que funciona, e o
[plano v2](./plano-vertical-vendas-whatsapp-v2.md) segue como está — com o gate
de preço da Fase 0 rebaixado de risco principal a conferência.

### Ramo B — converte mal, e o motivo é o produto

Os recusantes descrevem o Prestou como útil-mas-dispensável, ou não conseguem
nomear um caso concreto de valor. Vendas não conserta isso: seria adicionar
superfície a algo que ainda não se paga. O caminho é aprofundar Serviços ou subir
o ICP para quem já tem hábito de comprar software — a "pequena loja de uma
pessoa" que o plano v2 hoje classifica como persona adjacente.

### Ramo C — converte mal, mas o valor é claro

Os recusantes descrevem valor real e mesmo assim não assinam. Aí o problema é o
modelo, não o produto — e **a vertical de Vendas fica mais importante, não
menos**, porque monetizar o fluxo financeiro exige volume transacionado, e
pedido + saldo + recebimento recorrente geram muito mais fluxo do que cobrança
de serviço avulsa.

Mas nesse ramo a v2 precisa ser redesenhada antes de ser construída: o princípio
*"sem taxa por venda e sem dinheiro passando pelo Prestou"* deixa de ser uma
salvaguarda e passa a ser a restrição que impede a receita. Insumos que já
existem para essa decisão: o `vazamentoPct` da função `funnel()`, que foi escrito
justamente como argumento para adotar um PSP.

Este ramo não deve ser decidido no calor do resultado. Ele abre um estudo
próprio — regulatório, de produto e de custo — não um pivô imediato.

## Cronograma

| Semana | Trabalho |
|---|---|
| 0 | extrair o retrato da base; escolher PSP; integrar cobrança mínima; adicionar eventos; escrever a mensagem e os dois roteiros |
| 1 | enviar a oferta a todos os elegíveis; acompanhar tentativas e falhas de pagamento; entrevistar recusas conforme chegam |
| 2–3 | concluir entrevistas; observar cancelamentos e reembolsos; fechar o número de pagantes sustentados em 30 dias |

Três semanas, com esforço de engenharia concentrado numa integração de cobrança
descartável. Compare com o trimestre que a Fase 1 da vertical de Vendas exige.

## Riscos do próprio teste

| Risco | Mitigação |
|---|---|
| Base pequena demais para número | decidir por evidência qualitativa e reportar valores absolutos |
| Anúncio de plano pago afastar usuários | ninguém perde acesso no teste; mensagem sem pressão |
| Medir pânico em vez de valor | sem paywall obrigatório, sem prazo falso |
| Conversão boa com trilho ruim | medir recusa de cartão e ausência de cartão como métrica de primeira classe |
| Ancoragem estragar o preço de reserva | perguntar preço só depois da recusa |
| Amostra enviesada pelos mais próximos | oferecer a todos os elegíveis, sem seleção |
| Confundir intenção com pagamento | conversão exige dinheiro compensado |
| Resultado ambíguo virar decisão por vontade | gates e ramos escritos antes de ver o resultado |

O último é o mais provável e o mais caro. Estes critérios devem ser aceitos
**antes** do envio da primeira mensagem.

## Definição de pronto

- retrato da base extraído e registrado;
- oferta enviada a 100% dos elegíveis;
- cada tentativa de pagamento registrada, inclusive falhas;
- número de pagantes sustentados em 30 dias, líquido de reembolsos;
- split entre mensal no cartão e anual no Pix;
- taxa de recusa de cartão e de ausência de cartão;
- entrevistas concluídas com pagantes e recusantes;
- preço de reserva coletado entre os recusantes;
- ramo A, B ou C declarado por escrito, com a evidência que o sustenta;
- decisão explícita sobre a vertical de Vendas registrada no plano v2.

## Relação com documentos existentes

- [`plano-vertical-vendas-whatsapp-v2.md`](./plano-vertical-vendas-whatsapp-v2.md):
  plano cuja Fase 1 fica bloqueada até este teste ter resultado;
- [`plano-painel-financeiro-fiscal.md`](./plano-painel-financeiro-fiscal.md):
  contexto de caixa e rastreabilidade;
- `apps/api/src/analytics.ts`: funil e `vazamentoPct`, insumo do ramo C.
</content>
