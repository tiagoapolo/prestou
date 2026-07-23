---
title: "Avaliação — Cadastro do prestador pelo WhatsApp vs. login pelo dashboard"
created: 2026-07-23
status: descoberta
tags:
  - prestou
  - produto
  - onboarding
  - whatsapp
  - autenticacao
---

# Avaliação — Cadastro do prestador pelo WhatsApp vs. login pelo dashboard

## Pergunta

Vale a pena implementar o cadastro do prestador pelo WhatsApp em vez de exigir
login pela plataforma do dashboard?

## O que já existe hoje

- Auth por **magic link (e-mail)** via Supabase; `provider.auth_user_id` +
  `email` são a identidade.
- Assistente **bidirecional no WhatsApp** já em produção (Meta Cloud API,
  webhook, classificação de intenção por LLM, slot-filling).
- Tabela `provider_whatsapp_numbers` com verificação de número — mas com uma
  decisão de design deliberada, registrada no próprio código
  (`apps/api/src/routes/whatsapp.ts`):

  > "Só um número verificado é atendido pelo inbound; a autoridade continua
  > sendo o JWT."

Ou seja: hoje o WhatsApp é um **canal vinculado a uma identidade que nasce no
dashboard**, não uma fonte de identidade. A pergunta, no fundo, é: vale inverter
isso?

## Recomendação: não substituir — fazer um híbrido "WhatsApp-first, web-confirm"

Trocar o login do dashboard por cadastro 100% via WhatsApp é **alto esforço +
alto risco** por três motivos concretos ao caso do Prestou:

1. **Retrabalho no modelo de identidade.** Se o WhatsApp vira o provedor de
   identidade, a mesma pessoa ainda precisa entrar no dashboard depois. Isso
   exige auth por telefone (OTP) na web também, ou linking de conta — dois
   sistemas de identidade convivendo. O design atual evitou isso de propósito.

2. **A chave Pix é o campo mais perigoso de coletar em chat.** É para onde o
   dinheiro vai. Capturar/confirmar chave Pix em texto livre no WhatsApp tem
   risco real de erro de digitação → dinheiro na conta errada. Um formulário com
   validação e tela de confirmação visível é muito mais seguro.

3. **O dashboard não vai desaparecer.** Todo o roadmap do painel financeiro
   (fechamento mensal, comprovantes, notas fiscais, export) precisa de uma
   superfície web. Cadastro por WhatsApp **não elimina** o auth do dashboard —
   ele **adiciona** um segundo caminho de onboarding.

### O sweet spot

Deixar o prestador **começar** pelo WhatsApp (onde o público já vive) e
**terminar o sensível** na web:

- No WhatsApp, aproveitar o slot-filling existente → capturar nome, profissão e
  verificar o número (já implementado).
- Enviar um **deep link / magic link** para uma tela única web onde ele confirma
  a **chave Pix** (com validação) e dá o **consentimento LGPD** explícito
  (`consent_at` tem peso jurídico).

Isso corta a fricção onde ela dói de verdade (descoberta + ativação), reutiliza
a infra de intenção/slot-filling, e **não mexe** no modelo de autoridade nem
expõe a chave Pix a erro de chat. Esforço médio, risco baixo.

### O telefone chega validado "de graça"

Ponto central do híbrido, e o que o torna barato: **a validação do número não é
um passo extra — ela acontece como subproduto do início pelo WhatsApp.**

Quando o prestador manda a primeira mensagem (fluxo user-initiated), a Meta
Cloud API entrega o `wa_id` do remetente já autenticado pela própria Meta. O
número está provado pelo simples fato de a mensagem ter chegado daquele
aparelho — não é preciso enviar um código OTP e pedir que ele digite de volta.

Consequências práticas:

- **Nada de OTP na entrada.** O passo web de confirmação (chave Pix +
  consentimento) não precisa reverificar o telefone; ele já vem validado.
- **O deep link carrega o número provado.** Gerar o link amarrado ao `wa_id`
  verificado da conversa, com token de uso único e curta validade. Ao abrir a
  tela web, a sessão já sabe qual telefone é — o prestador só confirma o
  sensível.
- **Reaproveita a tabela existente.** É o mesmo mecanismo de
  `provider_whatsapp_numbers`, só que a verificação passa a ser feita **na
  criação da conta** (por ter mensageado primeiro), em vez de depois, nas
  Settings. Grava-se `verified_at` no momento do vínculo.
- **Base pronta para a aposta de longo prazo.** Com o número já validado e
  ligado à conta desde o cadastro, migrar depois a identidade da web para
  telefone (Supabase phone auth) fica natural — o âncora já existe.

O único cuidado é o inverso: **não confiar no número apenas porque a mensagem
chegou, sem amarrá-lo a um token de uso único no deep link.** A prova de posse
do telefone vem do inbound; a prova de que quem abriu a tela web é a mesma
pessoa vem do token. Os dois juntos.

## Sobre o "vale a pena agora"

O Prestou está em **piloto assistido com poucos prestadores** e em fase de
descoberta do módulo financeiro. Dois pontos:

- Nessa escala, o ROI de construir um fluxo completo de signup por WhatsApp é
  baixo — dá para onboardar os pilotos manualmente. Construir isso quando a
  fricção de onboarding for uma **queda medida** (drop-off no magic link), não
  uma hipótese.
- O próprio plano do painel financeiro já lista a pergunta que decide isso:
  "O Financeiro será usado principalmente no site ou também pelo WhatsApp?"
  (pergunta 18). A resposta das entrevistas da Fase 0 é o gatilho certo para
  decidir se o telefone deve virar a identidade âncora de longo prazo.

## Resumo

O magic link por e-mail é provavelmente a maior fricção real (público de
prestador quase não usa e-mail no Brasil), e vale atacar. Mas atacar com o
híbrido acima, não substituindo o dashboard. A aposta grande — telefone como
identidade única nas duas superfícies (Supabase phone auth) — só depois que a
Fase 0 confirmar que o público é WhatsApp-native.

## Próximos passos quando o tema for retomado

1. Medir o drop-off real do magic link no piloto antes de investir.
2. Nas entrevistas da Fase 0, responder à pergunta de canal (site vs. WhatsApp).
3. Se confirmar a fricção, especificar o híbrido: estados do slot-filling de
   onboarding + a tela web única de confirmação (chave Pix + consentimento).
4. Só então avaliar a migração de identidade para telefone (Supabase phone
   auth) como aposta de longo prazo.
