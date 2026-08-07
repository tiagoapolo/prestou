---
title: "Estratégia de GTM — ICP de Serviços do Prestou"
created: 2026-08-06
updated: 2026-08-06
status: proposta
tags:
  - prestou
  - gtm
  - icp
  - aquisicao
  - monetizacao
---

# Estratégia de GTM — ICP de Serviços do Prestou

## Por que este documento existe

O repositório define ICP com rigor em um único lugar: a
[vertical de Vendas](./plano-vertical-vendas-whatsapp-v2.md) — que não existe em
código e está bloqueada pelo
[gate zero](./teste-disposicao-de-pagamento.md). O produto que roda hoje,
Serviços, **nunca teve ICP escrito**. Ele foi construído para "prestador de
serviço" em geral, e "em geral" não é um segmento que se possa procurar, nomear
ou convidar.

Este documento faz três coisas:

1. define o ICP de Serviços em critérios verificáveis antes do convite;
2. desenha o motor de aquisição possível **dentro das restrições reais** de
   hoje;
3. mostra a aritmética que decide se esse motor pode virar negócio, e o que
   precisa mudar se não puder.

> **A tese:** o Prestou não vende "gestão de cobranças". Ele vende o fim do
> constrangimento de cobrar quem já recebeu o serviço e ainda não pagou. Todo o
> GTM sai daí.

## O que restringe o GTM hoje

Estas não são opiniões, são o estado do código. Qualquer plano que as ignore é
ficção.

| Restrição | Consequência para o GTM |
|---|---|
| Cadastro é **invite-only**: `Onboarding.tsx` exige `token` vindo do convite por WhatsApp, emitido por administrador | Não existe funil self-serve. Nenhum canal de topo funciona — não há para onde mandar tráfego |
| A Fase 2 do [onboarding por WhatsApp](./plano-cadastro-prestador-whatsapp.md) (auto-atendimento) não foi construída | Escala de aquisição está bloqueada por engenharia, não por marketing |
| Não há PSP, plano, trial nem coluna de status de pagamento | Não existe conversão para vender. O GTM não pode ser medido em receita ainda |
| Cobrança é **única**; não há recorrência nativa | O sub-segmento de maior dor (mensalidade) é servido por repetição manual, mitigada pela [memória de preenchimento](./decisoes/ADR-010-memoria-de-preenchimento-de-cobranca.md) |
| Cada conversa no WhatsApp tem custo de Meta Cloud API | Aquisição e ativação por WhatsApp têm custo marginal real, não zero |

**Leitura honesta:** o Prestou está numa fase em que aquisição é *pesquisa*, não
crescimento. O objetivo dos próximos 60 dias não é volume de cadastros — é
descobrir qual sub-segmento ativa, retém e paga, com amostra pequena e
convite manual. Tratar isso como funil de crescimento produz números bonitos e
nenhuma decisão.

## O ICP de Serviços

### Definição

Prestador de serviço **autônomo, solo**, que combina o trabalho pelo WhatsApp,
executa antes de receber, recebe por Pix na chave pessoal, e tem uma carteira de
clientes recorrentes identificáveis por nome e telefone.

O eixo que separa ICP de não-ICP é um só: **existe uma janela entre entregar e
receber.** Sem essa janela, o Prestou não tem o que fazer — não há "quem me
deve", não há lembrete, não há confirmação pendente. Com ela, o produto inteiro
faz sentido sem nenhuma explicação.

### Critérios operacionais

| Dimensão | Faixa ou comportamento |
|---|---|
| Estrutura | trabalha sozinho; sem secretária, recepção ou sócio que cobre |
| Combinação | serviço é combinado por WhatsApp, não por app de marketplace |
| Momento do pagamento | executa primeiro, recebe depois — sempre ou às vezes |
| Recorrência | tem clientes que voltam (semanal, quinzenal ou mensal) |
| Ticket | R$ 60 a R$ 1.500 por cobrança |
| Volume | 10 a 60 cobranças por mês |
| Recebimento | Pix na chave pessoal; dinheiro eventual; sem maquininha na maioria |
| Controle atual | memória, caderno, print de conversa, anotação no próprio WhatsApp |
| Fiscal | não depende de nota fiscal para receber |
| Decisão | ele mesmo escolhe, instala e pagaria |

Faixas são hipóteses de recrutamento, não regra de elegibilidade.

### O qualificador único

Antes de gastar um convite, uma pergunta decide:

> **"Nos últimos 30 dias, teve algum cliente que ficou de te pagar e você teve
> que lembrar — ou desistiu de lembrar?"**

Se a resposta é um caso concreto, com nome e data, é ICP. Se é "às vezes
acontece" ou "todo mundo me paga direitinho", **não convide**. A dor precisa ser
lembrada espontaneamente; dor que só aparece depois de explicada não sustenta
assinatura.

A segunda pergunta, e ela é diagnóstica de preço:

> **"Quanto você acha que deixou de receber no último ano por esquecimento —
> seu ou do cliente?"**

Quem responde um número maior que R$ 500 tem, sozinho, o argumento de ROI. Quem
não consegue estimar tende a ver o Prestou como conveniência — e conveniência a
R$ 19,90/mês converte mal.

### Score de aderência

Pontuar 0 a 2 em cada: combina serviço pelo WhatsApp; executa antes de receber;
tem clientes recorrentes; já perdeu ou atrasou recebimento nos últimos 30 dias;
recebe por Pix; trabalha sozinho; controla manualmente; sente desconforto ao
cobrar; decide sozinho a adoção; ticket acima de R$ 60.

- **16–20 — fit alto:** convidar primeiro e acompanhar de perto;
- **11–15 — fit médio:** convidar como contraste, no máximo 1 a cada 3;
- **0–10 — fit baixo:** não convidar e não orientar produto por sua opinião.

### Sub-segmentos, do mais afiado ao mais fraco

**Camada 1 — mensalidade recorrente.** A mesma carteira cobrada todo mês, sempre
com um ou dois atrasados. Aqui a dor se repete por calendário, não por acaso, e
o valor aparece no primeiro ciclo.

Personal trainer e professor particular; professor de música e reforço escolar;
nutricionista, psicólogo e fisioterapeuta autônomos sem convênio; jardinagem e
manutenção de piscina; social media e freelancer digital com contrato mensal;
diarista e faxina com escala fixa.

**Camada 2 — serviço executado com pagamento posterior.** Dor episódica, mas
aguda quando acontece; ticket maior.

Técnico de informática, eletricista, encanador, montador, chaveiro, refrigeração,
pintor; pequenas obras e reformas; fotógrafo de evento com saldo na entrega.

**Camada 3 — pacote pré-vendido.** Cliente compra 4 ou 10 sessões e vai
consumindo; o saldo fica em aberto.

Manicure, cabeleireira e estética a domicílio; pet groomer e passeador; aulas em
pacote.

**Anti-ICP — não convidar.** Quem recebe 100% na hora, sempre (comércio de
balcão, serviço à vista); quem já usa maquininha com link de pagamento para a
maioria das cobranças; quem tem alguém que cobra por ele; quem atende PJ com
prazo formal e exige nota fiscal; quem precisa de parcelamento com juros,
crediário ou renegociação; clínica ou salão com mais de um profissional e agenda
compartilhada.

O anti-ICP não é uma lista de quem não gostamos. É uma lista de quem **vai
ativar, reclamar do que falta e distorcer o roadmap** — o custo mais caro de um
piloto pequeno.

## Posicionamento e mensagem

O que **não** dizer, em nenhuma peça: gestão, plataforma, controle financeiro,
ERP, automatize sua cobrança, organize seu negócio. Todas atraem quem quer
sistema — e quem quer sistema não é o ICP, é quem já usa concorrente.

O que dizer, na linguagem do problema:

> **"Você já fez o serviço. Cobrar não deveria ser a parte chata."**
> O Prestou manda o Pix pronto, avisa quem esqueceu e te mostra quem ainda deve
> — sem você precisar mandar mensagem de cobrança.

Variação para a Camada 1 (mensalidade):

> **"Cobrar os mesmos alunos todo mês, sem abrir conversa por conversa."**

Variação para a Camada 2 (serviço executado):

> **"Terminou o serviço, manda o Pix pronto. Se não pagar, o Prestou lembra por
> você."**

Três provas que sustentam a mensagem e já existem no produto: o Pix Copia e Cola
é gerado sem intermediário e **o dinheiro cai direto na conta do prestador**; o
cliente **não cria conta** para pagar; os lembretes D+0/D+2/D+5 são automáticos e
despersonalizam a cobrança. Esse terceiro item é o que vende — é ele que resolve
o constrangimento, não a geração do QR Code.

## Canais, em ordem de custo de aprendizado

### 1. Loop embutido na página pública — o ativo mais subutilizado

Toda cobrança expõe a marca a um pagador que **não** é usuário. É o único canal
com custo marginal zero e distribuição proporcional ao uso. Uma fração desses
pagadores é, ela mesma, prestadora de serviço.

Recomendação concreta: rodapé discreto em `PublicPayment.tsx` — *"Você também
recebe por Pix? Veja como o Prestou cobra por você"* — apontando para uma página
de lista de espera com o qualificador único como primeira pergunta. Instrumentar
com um evento novo no `EventType`, no mesmo padrão aditivo do gate zero.

Isso não escala hoje (o cadastro é invite-only), mas **constrói a fila
qualificada** que a Fase 2 do onboarding vai consumir no dia em que existir. É a
coisa mais barata deste documento e a única que rende juros.

### 2. Indicação entre prestadores da mesma profissão

Este público vive em grupos de WhatsApp por profissão e por bairro. A indicação
não é um canal complementar aqui — é provavelmente o principal, porque a prova
social resolve a desconfiança de "isso mexe com meu dinheiro?", que é a objeção
número um.

Pedir indicação **só depois do primeiro ciclo concluído** (cliente confirmou
pagamento), nunca no cadastro. Benefício não financeiro: acesso antecipado a
recursos, ou meses de plano quando houver plano. Dinheiro por indicação, neste
segmento e nesta fase, compra ruído.

### 3. Outbound artesanal nominal — o motor da fase atual

Enquanto o cadastro for por convite, aquisição é uma lista nominal trabalhada à
mão. Fontes, em ordem de densidade de ICP:

- **Instagram por geolocalização e hashtag de profissão** — perfis de personal,
  professor particular, esteticista a domicílio com WhatsApp no perfil;
- **grupos de bairro e de condomínio** onde prestadores se anunciam;
- **marketplaces de serviço** com perfis públicos — fonte de nome, profissão e
  região, não de contato automatizado;
- **administradoras e síndicos**, que mantêm listas de prestadores de confiança;
- **âncoras de categoria**: academias que alugam espaço para personal, pet shops,
  escolas de música, distribuidoras de material elétrico e hidráulico.

Regra inegociável: **a mensagem inicial é 1:1, escrita à mão, referenciando algo
específico do prestador.** Template de massa nesta fase queima número, viola o
espírito da política de mensagens da Meta e envenena a métrica — porque a
resposta passa a medir tolerância a spam, não interesse.

### 4. Mídia paga — não agora

Não existe destino self-serve para o clique, e "cobrança" como palavra-chave
atrai cobrança de dívida de terceiros, crediário e escritórios — tudo
anti-ICP. Reavaliar apenas depois da Fase 2 do onboarding e de um número de
conversão conhecido.

## Funil, ativação e métricas

O funil desta fase, com o vocabulário que o código já usa:

```text
lista nominal qualificada (score ≥ 16)
  → convite enviado (convite_prestador)
  → número confirmado
  → onboarding concluído (provider criado)
  → 1ª cobrança criada           [cobranca_criada]
  → 1ª mensagem enviada          [mensagem_enviada]
  → cliente abriu e copiou       [link_aberto, codigo_copiado]
  → ciclo fechado                [cliente_confirmou | prestador_confirmou]
  → 2ª semana ativa
  → pagante
```

**Definição de ativação — a única que conta:** prestador que **fecha um ciclo
completo** (cobrança criada e pagamento confirmado) em até 7 dias do cadastro.
Criar conta, cadastrar chave Pix, abrir o Dashboard ou criar uma cobrança de
teste **não são ativação**. É a mesma severidade que o gate zero aplica à
elegibilidade — e pela mesma razão: quem não fechou ciclo não recebeu valor e não
informa nada.

Métricas a acompanhar por coorte de convite, em números absolutos:

- convites enviados → onboardings concluídos;
- onboardings → ativados em 7 dias;
- ativados → ainda ativos na 4ª semana;
- cobranças por prestador ativo por mês;
- `vazamentoPct` da `funnel()` por coorte — quem copiou o código e não confirmou;
- disparo e efeito dos lembretes D+0/D+2/D+5: quantos ciclos fecham **depois** do
  lembrete. Esta é a métrica que prova a promessa central; se lembrete não
  converte atraso em pagamento, a mensagem está vendendo algo que o produto não
  entrega.

Nada disso exige instrumentação nova além dos eventos já previstos no gate zero,
mais o evento do rodapé público.

## A aritmética que o GTM não pode contornar

O gate zero testa R$ 19,90/mês. Vale fazer a conta antes do resultado, porque
ela muda a estratégia mesmo no cenário bom:

- **R$ 19,90/mês significa ~1.000 assinantes para R$ 20 mil de MRR.**
- Convite manual, mesmo otimista, entrega dezenas de convites por semana com
  conversão desconhecida. **Nenhuma combinação plausível chega a 1.000 por
  convite manual em prazo relevante.**
- Custo de conversa da Meta Cloud API incide **por prestador ativo, todo mês**, e
  cresce com o uso. Um usuário engajado é mais caro — o
  [plano v2 já registra](./plano-vertical-vendas-whatsapp-v2.md) que o usuário
  pesado do ICP consome desproporcionalmente.

Três conclusões, e nenhuma é opcional:

1. **A Fase 2 do onboarding por WhatsApp deixa de ser dívida técnica e vira
   pré-condição comercial.** Sem cadastro self-serve, não existe GTM — existe
   recrutamento. O plano já está desenhado e as decisões travadas.
2. **A economia unitária tem que ser refeita com preços reais de Meta antes de
   qualquer escala** — o próprio plano v2 lista isso como entregável, não como
   medição.
3. **R$ 19,90 pode estar certo e ainda assim ser o preço errado.** Se o teste do
   gate zero converter no meio da banda, a pergunta seguinte não é "como
   conseguir mais usuários", é "existe um ICP adjacente que paga 3x" — e a
   resposta candidata já está escrita: quem **já tem hábito de comprar
   software**.

## Sequenciamento

### Fase 0 — em paralelo ao gate zero (semanas 0–3)

Não contaminar o teste de pagamento. A oferta vai para os elegíveis atuais,
conforme o gate zero define. **Em paralelo**, e medida à parte:

- montar a lista nominal com 60 candidatos de score ≥ 16, com no mínimo 30 da
  Camada 1;
- convidar 30, em 1:1, aplicando o qualificador único antes do convite;
- medir ativação em 7 dias e retenção em 4 semanas — **não oferecer plano a esta
  coorte durante o teste**, para não misturar sinal de disposição com sinal de
  novidade;
- publicar o rodapé de captação na página pública de pagamento e começar a fila;
- entrevistar todo mundo que aceitou o convite e **não** ativou. Esse é o grupo
  mais informativo do GTM inteiro, e o único que ninguém entrevista.

Gate para seguir, em números absolutos:

- **≥ 12 dos 30 convidados** concluem onboarding;
- **≥ 8** fecham ciclo completo em 7 dias;
- **≥ 6** continuam criando cobranças na 4ª semana;
- **≥ 5** citam espontaneamente o lembrete automático como o motivo de usar;
- a Camada 1 ativa em proporção visivelmente maior que as demais — ou a hipótese
  de sub-segmento cai e é reescrita.

### Fase 1 — depende do ramo do gate zero

**Ramo A (assinatura converte).** O ICP e a mensagem estão certos e o gargalo é
de máquina. Prioridade absoluta: Fase 2 do onboarding self-serve, depois indicação
estruturada e a fila do rodapé público. Só aí revisitar mídia paga, com CAC
calculado contra economia unitária real.

**Ramo B (não converte por falta de valor).** O GTM não conserta produto. Ou se
aprofunda Serviços — e o candidato óbvio é **recorrência nativa**, que transforma
a Camada 1 de repetição manual em automação real — ou se sobe o ICP para quem já
compra software. Neste ramo, este documento é reescrito, não executado.

**Ramo C (valor claro, modelo errado).** A assinatura individual sai do centro e
a monetização passa a depender de fluxo transacionado. O GTM muda de alvo: menos
prestador solo, mais densidade transacional por usuário — e o princípio "sem taxa
por venda" precisa ser revisto antes, não depois.

## Riscos

| Risco | Mitigação |
|---|---|
| Confundir recrutamento com aquisição e achar que há canal | Métrica de fase é ativação e retenção, nunca cadastros |
| Convidar fora do ICP porque a lista qualificada acaba | Qualificador único obrigatório antes de gastar convite; anti-ICP escrito |
| Outbound em massa queimar o número do WhatsApp | Mensagem 1:1 escrita à mão; sem template de marketing nesta fase |
| A dor ser do cliente final, não do prestador | Perguntar o valor perdido em 12 meses; sem número, tratar como conveniência |
| Ativação alta por acompanhamento humano | Registrar toda intervenção manual como fricção, como o piloto v2 já exige |
| Achar que o lembrete funciona sem medir | Medir ciclos fechados **após** lembrete, separadamente |
| Escalar antes da economia unitária | Nenhuma decisão de canal pago antes de custo real de Meta por usuário ativo |
| Sub-segmento escolhido por simpatia | Coorte com Camadas 1, 2 e 3 e comparação por ativação, não por entrevista |

## Próximas duas semanas

1. Extrair o retrato da base (já é passo zero do gate zero) e **cruzar com
   `profession`** — descobrir qual profissão ativa e retém melhor entre os que já
   existem. Isso pode confirmar ou derrubar a hipótese das camadas antes de
   convidar ninguém.
2. Escrever a lista nominal de 60 candidatos com score aplicado.
3. Publicar o rodapé de captação na página pública e o evento correspondente.
4. Enviar os 30 convites 1:1 da coorte de GTM, sem oferta de plano.
5. Entrevistar quem aceitou e não ativou.

## Relação com documentos existentes

- [`teste-disposicao-de-pagamento.md`](./teste-disposicao-de-pagamento.md): gate
  zero; este plano roda em paralelo e **não** oferece plano à coorte nova;
- [`plano-vertical-vendas-whatsapp-v2.md`](./plano-vertical-vendas-whatsapp-v2.md):
  ICP de Vendas, bloqueado; a Camada 1 daqui é o teste mais barato da mesma tese
  de recorrência;
- [`plano-cadastro-prestador-whatsapp.md`](./plano-cadastro-prestador-whatsapp.md):
  Fase 2 do onboarding — pré-condição comercial deste GTM;
- [`ADR-010`](./decisoes/ADR-010-memoria-de-preenchimento-de-cobranca.md):
  memória de preenchimento, o que torna a Camada 1 viável sem recorrência nativa;
- `apps/api/src/analytics.ts`: funil, `vazamentoPct` e base das métricas de coorte.
