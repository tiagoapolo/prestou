---
title: "Avaliação — Cadastro do prestador pelo WhatsApp vs. login pelo dashboard"
created: 2026-07-23
status: implementação revisada
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

## Ponto de partida

- Auth por **magic link (e-mail)** via Supabase; `provider.auth_user_id` +
  `email` são a identidade.
- Assistente **bidirecional no WhatsApp** já em produção (Meta Cloud API,
  webhook, classificação de intenção por LLM, slot-filling).
- Havia uma tabela `provider_whatsapp_numbers` com verificação de número — mas
  com uma
  decisão de design deliberada, registrada no próprio código
  (`apps/api/src/routes/whatsapp.ts`):

  > "Só um número verificado é atendido pelo inbound; a autoridade continua
  > sendo o JWT."

Ou seja: o WhatsApp era um **canal vinculado a uma identidade que nascia no
dashboard**, não uma fonte de identidade. A decisão foi torná-lo prova do canal
no onboarding, sem substituir a identidade web.

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

### O fluxo adotado

O prestador **começa** pelo WhatsApp (onde o público já vive) e **termina o
sensível** na web:

- No WhatsApp, o inbound assinado serve somente para provar o `wa_id` convidado
  e entregar um link determinístico. Número desconhecido nunca passa por
  classificação ou slot-filling da LLM.
- Enviar um **deep link / magic link** para uma tela única web onde ele confirma
  nome, profissão, **chave Pix** (com validação) e o **consentimento LGPD**
  explícito (`consent_at` tem peso jurídico).

Isso corta a fricção onde ela dói de verdade (descoberta + ativação), reutiliza
o webhook existente e **não mexe** no modelo de autoridade nem expõe a chave
Pix a erro de chat.

### O telefone chega validado "de graça"

Ponto central do híbrido, e o que o torna barato: **a validação do número não é
um passo extra — ela acontece como subproduto do início pelo WhatsApp.**

Quando o prestador manda a primeira mensagem (fluxo user-initiated), a Meta
Cloud API entrega o `wa_id` do remetente já autenticado pela própria Meta. O
número está provado pelo simples fato de a mensagem ter chegado daquele
aparelho — não é preciso enviar um código OTP e pedir que ele digite de volta.

Isso prova **posse da conta de WhatsApp**, não que o remetente seja humano,
prestador legítimo ou autorizado a usar todas as capacidades do Prestou. A
assinatura da Meta também só prova a origem do webhook. Portanto, esses sinais
eliminam o OTP do telefone, mas **não substituem um gate de ativação antiabuso**.

Consequências práticas:

- **Nada de OTP na entrada.** O passo web de confirmação (chave Pix +
  consentimento) não precisa reverificar o telefone; ele já vem validado.
- **O deep link carrega o número provado.** Gerar o link amarrado ao `wa_id`
  verificado da conversa, com token de uso único e curta validade. Ao abrir a
  tela web, a sessão já sabe qual telefone é — o prestador só confirma o
  sensível.
- **Usa o número canônico único.** `providers.whatsapp` recebe o número provado
  no momento da criação da conta e `whatsapp_verified_at` registra a prova;
  `provider_whatsapp_numbers` deixa de existir.
- **Base pronta para a aposta de longo prazo.** Com o número já validado e
  ligado à conta desde o cadastro, migrar depois a identidade da web para
  telefone (Supabase phone auth) fica natural — o âncora já existe.

O único cuidado é o inverso: **não confiar no número apenas porque a mensagem
chegou, sem amarrá-lo a um token de uso único no deep link.** A prova de posse
do telefone vem do inbound; o token prova acesso ao link entregue naquela
conversa, mas pode ser encaminhado e não é uma segunda prova de identidade. Por
isso deve ser tratado como credencial temporária, e a conta só deve ser ativada
depois dos demais gates descritos abaixo.

## Antiabuso do auto-cadastro

Não existe controle isolado que assegure ausência de spam. A meta verificável é
**conter o impacto**: uma mensagem de um número desconhecido não pode criar uma
conta ativa, consumir LLM, disparar mensagens para terceiros nem crescer sem
limite no banco.

### Decisão para o piloto: entrada somente por convite

Enquanto o piloto for assistido, somente um número previamente convidado recebe
o link. Um número não convidado recebe `200` silencioso: não cria sessão, não
cria usuário, não recebe resposta e não chama LLM. O convite é de uso único,
expira e só é reivindicado quando o próprio número envia uma mensagem ao
WhatsApp do Prestou por webhook assinado da Meta.

Quando a abertura pública for justificada por conversão medida, remove-se o
convite, mas preservam-se todos os controles seguintes. Deve existir um kill
switch (`WHATSAPP_SIGNUP_ENABLED=false`) e um teto global diário de ativações
para voltar a convite sem deploy.

### Estados e capacidades

| Estado | Persistência | O que pode fazer |
| --- | --- | --- |
| `unknown` | nenhuma persistência de onboarding | nenhuma resposta e nenhuma LLM |
| `invited` | convite privado com TTL | enviar mensagem ao Prestou para provar o próprio número |
| `pending` | sessão privada + token com TTL | confirmar e-mail, preencher os dados web; sem LLM ou operação financeira |
| `active` | `auth.users` + `providers` | usar o produto, ainda protegido pelo guardrail existente |
| `revoked` / `expired` | convite ou sessão sem capacidade | nenhuma resposta; retenção remove o estado transitório |

Regras centrais:

1. **Não criar `auth.users` nem `providers` no primeiro inbound.** Antes da
   ativação, usar uma sessão curta em schema `private`, no máximo uma por
   `wa_id`, apagada automaticamente após 24 horas.
2. **Não chamar LLM para desconhecidos ou pendentes.** O onboarding é uma
   máquina de estados determinística com schemas estritos. Texto, anexo,
   comando financeiro ou intenção são ignorados antes do modelo.
3. **Separar posse de telefone, identidade web e autorização.** A Meta +
   `wa_id` provam o telefone; o token abre a sessão web; o login confirmado cria
   a identidade recuperável; convite/aprovação (no piloto) autoriza a conta.
4. **O deep link não vira sessão Supabase por si só.** No modelo atual, que usa
   magic link por e-mail, o passo web ainda precisa vincular e confirmar o
   e-mail antes de criar `providers`. Se a intenção for eliminar o e-mail, isso
   já é a migração explícita para phone auth, não apenas uma mudança de
   onboarding.

Não usar anonymous sign-in do Supabase como atalho para o estado `pending`:
cada tentativa já criaria uma linha permanente em `auth.users`, exatamente o
recurso que queremos proteger. A própria documentação do Supabase recomenda
CAPTCHA e rate limits para evitar crescimento abusivo de usuários anônimos e
informa que a limpeza automática deles não existe.

### Limites antes da ativação

Valores iniciais para o piloto, configuráveis e sujeitos a ajuste por dados:

- por `wa_id` convidado: até 3 tentativas de emissão por dia;
- teto global inicial de 50 tentativas por dia;
- no máximo uma sessão pendente e um deep link válido por `wa_id`; mensagens
  seguintes ficam silenciosas enquanto o link estiver válido;
- depois da expiração, uma nova mensagem pode emitir um novo link e invalida o
  anterior;
- deduplicação pelo `message_id` da Meta **antes** de qualquer outra escrita,
  resposta ou chamada externa.

O rate limit não deve usar o IP do webhook: para a aplicação, o tráfego chega
da infraestrutura da Meta e vários usuários compartilham essa origem. A chave
útil é o `wa_id`, complementada pelos tetos globais contra rotação de números.

### Deep link e tela web

- Gerar pelo menos 32 bytes aleatórios; armazenar somente HMAC-SHA-256 com
  segredo do servidor, nunca o token bruto.
- Vincular o digest a `wa_id`, `onboarding_session_id`, finalidade e expiração
  de 15 minutos; consumir atomicamente uma única vez.
- Invalidar tokens anteriores ao reenviar e retornar erros genéricos, sem
  revelar se telefone, convite ou e-mail já existem.
- Validar CAPTCHA/Cloudflare Turnstile no servidor antes de chamar Supabase Auth
  ou criar a conta. Pode ser invisível por padrão e exigir desafio visível por
  risco; a recomendação oficial do Supabase é proteger sign-up, sign-in e reset
  com CAPTCHA contra bots.
- Aplicar cooldown próprio aos envios de magic link. Convite, limite de sessões,
  CAPTCHA e rate limit nativo do Supabase formam as demais barreiras.
- Solicitar o magic link só depois de convite e CAPTCHA válidos. A API cria o
  `auth.users` server-side; o cliente usa `shouldCreateUser: false` e cria
  `providers` somente após `email_confirmed_at`. Um cron remove identidades
  provisórias abandonadas sem tocar em usuários Auth preexistentes.
- Fazer a promoção para `providers` de forma idempotente e compensável: uma
  falha não pode deixar número reservado indefinidamente.

### Evitar que uma conta válida vire emissor de spam

Verificar telefone e e-mail não impede um humano malicioso. Um estado adicional
de `active_probation` **não faz parte deste incremento**. No piloto atual:

- não há envio automático de convite nem de mensagens a terceiros originado
  pelo onboarding;
- nenhuma operação em lote e nenhum envio automático originado apenas pelo
  onboarding;
- respeitar opt-out/bloqueio de destinatários e não tentar novos envios;
- manter circuit breaker global de outbound e acompanhar qualidade, bloqueios
  e denúncias informados pela Meta.

O compartilhamento manual por `wa.me`, iniciado conscientemente pelo prestador,
é a capacidade adequada durante o piloto. O número da WABA do Prestou não
deve emprestar sua reputação a uma conta recém-criada.

### Observabilidade e critérios de aceite

O incremento atual mantém logs operacionais sem registrar tokens nem texto do
cadastro e apaga sessões/identidades provisórias por retenção. Eventos analíticos
específicos de signup ficam para a etapa de observabilidade do piloto.

O fluxo só pode ser aberto sem convite quando testes e métricas comprovarem:

- zero criação de `auth.users` antes do gate web (convite + CAPTCHA) e zero
  criação de `providers` antes da confirmação da identidade;
- usuários Auth provisórios abandonados são removidos pelo cron
  `/api/internal/run-whatsapp-onboarding-retention`;
- zero chamada de LLM e zero envio a terceiros para `unknown`/`pending`;
- replay do mesmo `message_id` e do mesmo deep link não produz efeito;
- corrida de duas finalizações cria no máximo uma conta;
- limites por `wa_id`, por destinatário e globais falham fechados;
- kill switch bloqueia novas sessões sem afetar contas ativas;
- taxa de ativação legítima, bloqueios, denúncias e custo por conta ativada têm
  baseline do piloto e alertas definidos antes da abertura.

Referências oficiais do Supabase consultadas na revisão:

- [CAPTCHA no Supabase Auth](https://supabase.com/docs/guides/auth/auth-captcha)
- [Rate limits e prevenção de abuso](https://supabase.com/docs/guides/platform/going-into-prod#rate-limiting-resource-allocation--abuse-prevention)
- [Riscos de abuso em anonymous sign-in](https://supabase.com/docs/guides/auth/auth-anonymous#abuse-prevention-and-rate-limits)

## Decisão de implementação

O Prestou está em **piloto assistido com poucos prestadores** e em fase de
descoberta do módulo financeiro. Dois pontos:

- Nessa escala, o fluxo deve permanecer pequeno e assistido: o administrador
  autoriza números e o prestador inicia a conversa. A abertura pública continua
  condicionada a conversão e abuso medidos.
- O próprio plano do painel financeiro já lista a pergunta que decide isso:
  "O Financeiro será usado principalmente no site ou também pelo WhatsApp?"
  (pergunta 18). A resposta das entrevistas da Fase 0 é o gatilho certo para
  decidir se o telefone deve virar a identidade âncora de longo prazo.

## Resumo

O híbrido preserva o e-mail como identidade recuperável do dashboard e usa o
WhatsApp canônico como canal único, provado no inbound. Não há motivo atual para
um prestador ter mais de um número. Migrar a autenticação web para phone auth é
uma decisão futura e separada.

## Próximos passos de rollout

1. Validar a migração em um clone/staging com a conta legada antes da produção.
2. Configurar redirect URL, Turnstile, cron de retenção e template OTP no
   ambiente hospedado.
3. Rodar o híbrido somente por convite; não abrir o cadastro público no piloto.
4. Medir conversão, bloqueios, denúncias e custo por conta ativada antes de
   retirar o convite.
5. Só então avaliar a migração de identidade para telefone (Supabase phone
   auth) como aposta de longo prazo.

---

# Plano técnico — unificação do número de WhatsApp

## Motivação

Hoje existem **dois números** por prestador, e eles podem divergir:

- `providers.whatsapp` — capturado no onboarding, editável por `UPDATE` direto
  nas Settings (`apps/api/src/routes/providers.ts:190`), **sem validação**. É o
  destino de **todas** as notificações (`apps/api/src/notify.ts:126`).
- `provider_whatsapp_numbers.phone_e164` — verificado por OTP, usado para
  **liberar o inbound** (`apps/api/src/routes/whatsapp.ts:306`).

Isso gera dois defeitos concretos:

1. **O OTP não prova o número que diz provar.** O código de verificação do
   `phone_e164` é entregue em `providers.whatsapp`
   (`apps/api/src/notify.ts:126`), não no número candidato. Se os dois diferem,
   confirmar o código prova posse do número **antigo**, e `verified_at` é gravado
   mesmo assim.
2. **O inbound responde no número errado.** O prestador é resolvido pelo
   `phone_e164` verificado, mas a resposta vai para `provider.whatsapp`
   (`apps/api/src/routes/whatsapp.ts:317`). Se divergem, o assistente responde
   num número diferente do que enviou a mensagem.

Unificar em **um número canônico, que só vira canônico depois de provado**,
resolve os dois de uma vez.

## Estado-alvo

- `providers.whatsapp` é a **fonte única da verdade**: destino das notificações
  **e** chave de resolução do inbound.
- `providers.whatsapp_verified_at` marca se está provado.
- Toda troca de número passa por OTP **enviado ao número novo**; até confirmar, o
  número antigo continua valendo.
- `provider_whatsapp_numbers` deixa de existir; seu papel transitório
  (candidato + código + expiração) vai para uma tabela `whatsapp_verifications`.

## Schema (migração)

Existe uma conta legada, `tiago@tiagopaiva.me`. A unicidade é **global** e todo
`provider` ativo deve nascer com número provado. Antes de remover a tabela
antiga, a migração preserva `verified_at` somente quando o `phone_e164` antigo
corresponde ao `providers.whatsapp` que efetivamente recebia o OTP. Se não
corresponder, a migração falha fechada e exige nova prova.

```sql
-- 1. Coluna de verificação no número canônico.
alter table public.providers
  add column whatsapp_verified_at timestamptz;

-- 2. Backfill da prova compatível; nenhum provider não provado pode sobreviver.
update public.providers pr
   set whatsapp_verified_at = wn.verified_at
  from public.provider_whatsapp_numbers wn
 where wn.provider_id = pr.id
   and wn.verified_at is not null
   and right(wn.phone_e164, 11) = pr.whatsapp;

alter table public.providers
  alter column whatsapp_verified_at set not null;

-- 3. Unicidade global: um número provado -> no máximo uma conta.
create unique index uq_providers_whatsapp
  on public.providers (whatsapp);

-- 4. Estado transitório de troca de número (1:1 com o prestador), fora da
-- Data API. Convites e sessões de onboarding também vivem em `private`.
create table private.whatsapp_verifications (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  candidate_phone text not null,
  code_digest text not null,
  expires_at timestamptz not null,
  verify_attempts integer not null default 0 check (verify_attempts >= 0),
  last_sent_at timestamptz not null default now(),
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index uq_whatsapp_verifications_candidate
  on private.whatsapp_verifications (candidate_phone);

-- 5. A tabela antiga sai somente depois do backfill e das asserções.
drop table public.provider_whatsapp_numbers;
```

## Mudanças no código

### `notify.ts` — permitir destino explícito (a correção do bug)

- Adicionar `to?: string` a `NotifyInput`.
- Em `sendViaCloudApi`, usar `input.to ?? input.provider.whatsapp`
  (`apps/api/src/notify.ts:126`).
- A verificação passa o **número candidato** como `to`. Nenhum outro caller muda.

### `POST /api/whatsapp/number/start`

- Recebe o telefone candidato (schema atual `startSchema`).
- Não revelar se o candidato pertence a outra conta; externamente, retornar uma
  resposta genérica. Registrar o conflito apenas no servidor.
- Permitir no máximo uma verificação pendente por candidato, com resend mínimo
  de 60 segundos e limites por prestador, candidato e globais. Isso impede que
  várias contas usem o endpoint para bombardear o mesmo número.
- Upsert em `whatsapp_verifications` (candidato + **HMAC-SHA-256 do código** +
  TTL de 10 min). Um SHA simples não basta para um código de seis dígitos, cujo
  espaço pode ser enumerado se o banco vazar.
- Envia o OTP **para o candidato** (`notifyProvider({ ..., to: candidate })`).

### `POST /api/whatsapp/number/confirm`

- Valida código e expiração contra `whatsapp_verifications`.
- Comparação em tempo constante; no máximo 5 tentativas. Ao exceder, invalidar
  o código e aplicar cooldown sem indicar qual validação falhou.
- Em sucesso, numa transação:
  `UPDATE providers SET whatsapp = candidate, whatsapp_verified_at = now()` e
  `DELETE FROM whatsapp_verifications WHERE provider_id = ?`.
- Tratar violação do índice único (candidato tomado nesse meio-tempo) → 409.

### `GET /api/whatsapp/number`

- Retornar `providers.whatsapp`, `verified = whatsapp_verified_at is not null`, e
  o `candidate_phone` pendente (se houver), para a UI mostrar "verificação em
  andamento".

### `providers.ts` — Settings deixa de editar o número direto

- Remover `whatsapp` do `UPDATE` de Settings
  (`apps/api/src/routes/providers.ts:190`): número só muda via start/confirm.
  `pix_key`, `default_due_days` etc. continuam ali.

### Inbound gating — resolver pelo número canônico

- Trocar o JOIN em `provider_whatsapp_numbers`
  (`apps/api/src/routes/whatsapp.ts:306`) por:

  ```sql
  SELECT * FROM providers
   WHERE whatsapp IN (?, ?) AND whatsapp_verified_at IS NOT NULL
  ```

- Com isso, a resposta em `apps/api/src/routes/whatsapp.ts:317`
  (`toE164(provider.whatsapp)`) passa a ser, por construção, o mesmo número que
  mandou a mensagem — divergência deixa de ser possível.

### Onboarding — nasce verificado

- **Onboarding web direto:** não cria novos usuários. Login usa magic link com
  `shouldCreateUser: false`; novos usuários nascem apenas depois do gate de
  convite + CAPTCHA.
- **Cadastro-por-WhatsApp (híbrido):** gravar `whatsapp_verified_at` a partir do
  `wa_id` autenticado do inbound — a prova vem sem OTP, mas somente na promoção
  atômica de uma sessão convidada para `active`.
- O formulário web recebe o número da sessão e o mostra somente para leitura;
  telefone enviado pelo navegador é rejeitado.

### Convites do piloto

- Administradores server-side criam, listam e revogam convites por número.
- Convite não valida nem reserva uma conta: ele é reivindicado somente quando o
  mesmo número envia um inbound com assinatura válida da Meta.
- O primeiro inbound admitido recebe um link com token aleatório de 32 bytes;
  somente o HMAC é persistido. Enquanto estiver válido, novas mensagens ficam
  silenciosas; depois da expiração, a reemissão invalida o token anterior.
- O link passa por Turnstile antes de qualquer criação em `auth.users`; o
  cadastro consome convite, sessão e token na mesma transação que cria o
  `provider`.

### Webhook — cortar desconhecidos antes da LLM

O webhook primeiro resolve o número em `providers`. Se não encontrar exatamente
um prestador, tenta reivindicar um convite do mesmo número. Sem convite, retorna
silenciosamente; com convite, responde apenas o link determinístico. Nenhum dos
dois caminhos chama Auth ou LLM.

O ponto de corte fica em `whatsapp.ts`: `interpretMessage(...)` só é chamado
dentro de `if (provider)`. Para desconhecidos, apenas um número convidado pode
receber a resposta fixa:

```ts
const provider = await findActiveProvider(inbound.from);

if (!provider) {
  const token = await startInvitedWhatsAppOnboarding(inbound);
  if (token) await deliverReply(inbound.from, invitedSignupMessage(token));
  return reply.send({ received: true });
}

// Somente prestador ativo atravessa este limite.
const admission = await admitWhatsAppMessage(provider.id, inbound);
if (!admission.allowed) return reply.send({ received: true });
await interpretMessage({ providerId: provider.id, message: inbound.text });
```

Não é necessário classificar a intenção: para um número convidado, o conteúdo da
primeira mensagem é ignorado e o resultado é sempre o mesmo link. Replays e
mensagens seguintes ficam silenciosos enquanto ele estiver válido.

- Validar assinatura e deduplicar `message_id` primeiro.
- Se signup estiver desligado ou o limite falhar, confirmar o webhook com 200 e
  não processar; respostas diferentes de 200 causam retry da Meta.
- Não interpretar comandos, anexos ou slots de números desconhecidos.
- Persistir sessões e rate limits em schema `private`, com `REVOKE ALL` de
  `PUBLIC`, `anon` e `authenticated`; acesso apenas pela API server-side.
- Encaminhar ao assistente financeiro somente depois de resolver exatamente um
  `provider` ativo.

### Templates da Meta

- O cadastro iniciado por inbound **não precisa de template**: o link é uma
  resposta livre dentro da janela de atendimento aberta pelo usuário.
- Criar convite no painel **não envia mensagem outbound**. O administrador deve
  orientar o número convidado a conversar com o WhatsApp do Prestou. Envio
  proativo exigiria opt-in e um template separado, fora deste escopo.
- A troca posterior do número usa somente o template de autenticação configurado
  em `WHATSAPP_AUTH_TEMPLATE`, com o código OTP e botão de copiar código.

## Concorrência e casos de borda

- Unicidade **global** em `providers.whatsapp`: todo prestador já nasce
  verificado e dois prestadores nunca compartilham o mesmo número.
- Dois candidatos pendentes para o mesmo número **não** coexistem: o índice de
  `candidate_phone` reduz bombardeio e reserva o número só durante o TTL curto.
  O índice de `providers.whatsapp` continua sendo o árbitro final na promoção;
  capturar a violação em vez de checar-e-depois-gravar.
- `whatsappIdentityCandidates` (com/sem o 9º dígito) continua igual — a query de
  inbound segue usando `IN (?, ?)`.

## Rollout

Existe **uma única conta**, `tiago@tiagopaiva.me`. A migração reaproveita a data
de verificação antiga apenas se o vínculo E.164 e o número canônico coincidirem.
Não existe `UPDATE ... verified_at = now()` por e-mail: isso inventaria uma
prova. Se a asserção falhar, o rollout para e o número precisa conversar com o
Prestou por convite ou ser reverificado antes da nova tentativa.
