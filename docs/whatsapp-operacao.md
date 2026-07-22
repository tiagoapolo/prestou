# WhatsApp — integração, assistente e operação

Este documento registra a integração bidirecional do Prestou com a WhatsApp
Cloud API, desde a configuração da Meta até a criação confirmada de cobranças e
os guardrails de custo. Tokens e secrets nunca devem ser registrados aqui.

## Recursos configurados na Meta

| Recurso | Valor |
|---|---|
| Portfólio empresarial | `Prestou` (`1085289427502954`) |
| App Meta | `Prestou` (`3082170881993971`) |
| WABA de teste | `Test WhatsApp Business Account` (`1799061831232184`) |
| Usuário do sistema | `Prestou API` (`61592104807907`) |
| Função do usuário do sistema | `Employee` |

O usuário do sistema recebeu acesso ao app com **Gerenciar app** e à WABA com
**Mensagens**. O telefone e o `phone_number_id` ficam somente nas variáveis do
ambiente.

O token usado pela API foi gerado para o app `Prestou`, com validade **Nunca** e
somente a permissão `whatsapp_business_messaging`. Se uma operação administrativa
da WABA for adicionada no futuro, avaliar separadamente a necessidade de
`whatsapp_business_management`; ela não é necessária para enviar e responder às
mensagens atuais.

## Configuração do webhook

O endpoint público é o mesmo para verificação e eventos:

```text
GET  https://DOMINIO_DA_API/api/whatsapp/webhook
POST https://DOMINIO_DA_API/api/whatsapp/webhook
```

Em desenvolvimento, substitua o domínio por uma URL HTTPS do ngrok. Essa URL é
temporária e deve ser atualizada na Meta quando o túnel mudar. O campo de
callback precisa incluir o caminho completo `/api/whatsapp/webhook`.

Na configuração de Webhooks da Meta:

1. informe a URL de callback;
2. use no campo de verificação o mesmo valor de `WHATSAPP_VERIFY_TOKEN`;
3. assine o campo `messages` da conta do WhatsApp;
4. confirme que a WABA está inscrita no app.

O `GET` compara o verify token e devolve `hub.challenge`. O `POST` valida
`X-Hub-Signature-256` com o App Secret antes de interpretar o corpo. O App
Secret fica em **Meta for Developers → App Prestou → Configurações do app →
Básico → Chave secreta do app** e deve ser armazenado somente como
`WHATSAPP_APP_SECRET`.

## Variáveis da API

```env
WHATSAPP_MODE=cloud-api
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_TEMPLATE_LANG=pt_BR
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

WHATSAPP_RATE_LIMIT_PER_MINUTE=10
WHATSAPP_DAILY_MESSAGE_LIMIT=100
WHATSAPP_MAX_MESSAGE_LENGTH=1000
WHATSAPP_GLOBAL_DAILY_AI_LIMIT=5000
WHATSAPP_ABUSE_COOLDOWN_MINUTES=30
WHATSAPP_INVALID_STREAK_LIMIT=3
```

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` e
`WHATSAPP_VERIFY_TOKEN` são secrets. Não os envie por chat, não os coloque no
frontend e não os versione. Depois de trocar qualquer um deles, reinicie a API.

## Token permanente

O token temporário da tela de configuração da API expira e passa a responder
`401`, OAuth code `190`. Para operação contínua:

1. abra **Configurações do negócio → Usuários → Usuários do sistema**;
2. selecione `Prestou API`;
3. confirme os ativos atribuídos;
4. clique em **Gerar token** e escolha o app `Prestou`;
5. escolha **Nunca**;
6. selecione apenas `whatsapp_business_messaging`;
7. copie o token diretamente para `WHATSAPP_ACCESS_TOKEN` no ambiente da API.

Se o token for revogado ou comprometido, use **Anular tokens**, gere outro e
reinicie o serviço.

## Identidade do prestador

O número não autentica o webhook sozinho. A ordem de confiança é:

1. a assinatura da Meta prova a origem do POST;
2. o `wa_id` é normalizado;
3. a API procura um número único, vinculado e verificado em
   `provider_whatsapp_numbers`;
4. o `provider_id` é derivado no servidor e nunca aceito do payload externo.

A Meta pode entregar números brasileiros com ou sem o nono dígito. A resolução
considera as duas formas apenas para localizar o vínculo já verificado. Número
desconhecido, não verificado ou ambíguo é ignorado sem chamar a IA.

O vínculo feito pelo WhatsApp não altera a autenticação do Dashboard, que
continua usando JWT do Supabase.

## Fluxo do assistente

```text
Meta webhook
  → assinatura válida
  → mensagem com ID único da Meta
  → prestador vinculado e verificado
  → guardrail atômico no PostgreSQL
  → orquestrador compartilhado com o Dashboard
  → leitura ou rascunho de cobrança
  → resposta de texto ou botões de confirmação
```

O modelo apenas escolhe uma ferramenta e extrai os argumentos. Ele recebe o
texto da mensagem, mas não recebe lista de clientes, chave Pix, valores do banco
ou dados financeiros. A API resolve clientes, consulta o PostgreSQL, gera o BR
Code e executa escritas.

Capacidades atuais:

- preparar uma cobrança;
- listar cobranças em atraso;
- consultar a situação de um cliente;
- resumir valores a receber e recebidos;
- orientar quando um pedido não é suportado.

## Criação de cobrança pelo WhatsApp

Quando os dados são suficientes, o assistente persiste uma proposta e envia os
botões **Criar cobrança** e **Cancelar**. A proposta:

- pertence ao prestador derivado do número verificado;
- contém um rascunho validado no backend;
- expira em 10 minutos;
- cancela propostas anteriores ainda pendentes;
- é bloqueada com `SELECT ... FOR UPDATE` durante a confirmação;
- só pode ser consumida uma vez;
- devolve o mesmo resultado em cliques repetidos.

O clique **Criar cobrança** usa o mesmo serviço `createCharge` do Dashboard.
Assim, regras de cliente, Pix, pagamento, eventos e validações permanecem iguais
nos dois canais. O clique **Cancelar** não cria cobrança.

## Guardrail de custo e abuso

O guardrail roda antes da OpenAI e é compartilhado por todas as instâncias da
API. O estado fica no schema PostgreSQL `private`, sem acesso para `anon` ou
`authenticated`.

Proteções padrão:

- deduplicação pelo `message_id` da Meta;
- deduplicação por 30 segundos de conteúdo equivalente, usando somente SHA-256;
- máximo de 1.000 caracteres Unicode;
- 10 mensagens por minuto por prestador;
- 100 mensagens por dia por prestador;
- no máximo 5.000 chamadas diárias à IA em toda a instalação;
- somente uma mensagem em processamento por prestador;
- lease de processamento maior que o timeout da OpenAI, com liberação no
  `finally` e expiração automática após queda do processo;
- cooldown de 30 minutos após estouro de cota;
- cooldown após três mensagens longas ou intenções não suportadas consecutivas;
- uma mensagem válida zera a sequência de intenções inválidas;
- botões passam por deduplicação e cotas, mas não consomem o orçamento da IA;
- respostas de bloqueio são textos fixos e nunca chamam o modelo;
- reentregas, conteúdo repetido, concorrência e cooldown repetido são bloqueados
  silenciosamente para não criar novo custo de saída.

O limite global mede **chamadas reservadas à IA**, não tokens exatos. Uma
reserva continua contabilizada quando a OpenAI falha, pois a tentativa já pode
ter gerado custo. Os limites são inteiros positivos e a API recusa inicializar
se alguma configuração for inválida.

O banco não armazena o texto da mensagem no guardrail. Armazena ID da Meta,
prestador, tipo, tamanho, resultado da decisão, horário e hash do conteúdo. Os
eventos e buckets antigos são eliminados oportunisticamente após dois dias.

## Testes

### Template temporário da Meta

No modo de teste, somente destinatários incluídos na lista permitida recebem
mensagens. Caso contrário, a Cloud API devolve `(#131030) Recipient phone number
not in allowed list`.

```bash
pnpm test:whatsapp -- --to 5511999999999
pnpm test:whatsapp -- --to 5511999999999 --dry-run
```

O primeiro comando usa `hello_world` em `en_US`. Templates temporários servem
para validar transporte; templates próprios precisam de aprovação para iniciar
conversas fora da janela permitida pela Meta.

### Teste bidirecional

1. inicie `pnpm dev:api`;
2. exponha a porta da API com ngrok;
3. confirme o callback e a assinatura `messages` na Meta;
4. envie uma solicitação pelo número permitido;
5. confira o rascunho e os botões;
6. clique em **Criar cobrança**;
7. confira a mensagem de sucesso, o link de pagamento e o registro no Dashboard.

Verificações locais:

```bash
pnpm --filter @prestou/api test
pnpm --filter @prestou/api typecheck
```

## Diagnóstico rápido

| Sintoma | Causa provável | Ação |
|---|---|---|
| `401`, OAuth `190` | token expirado, revogado ou incorreto | gerar token do usuário do sistema, atualizar env e reiniciar |
| `400`, `131030` | destinatário não permitido no modo de teste | adicionar o número à lista de destinatários da Meta |
| `GET webhook` retorna `403` | verify token ou caminho incorreto | conferir o valor e usar `/api/whatsapp/webhook` |
| teste do webhook funciona, mas mensagem real não chega | WABA/app não inscritos em `messages` | conferir a assinatura do campo e a conta selecionada |
| ngrok não recebe request | callback antigo, túnel encerrado ou caminho errado | atualizar a URL HTTPS completa na Meta |
| resposta registrada, mas não enviada | `WHATSAPP_MODE=log` ou credenciais ausentes | usar `cloud-api`, preencher env e reiniciar |
| mensagens são ignoradas | número sem vínculo/verificação ou guardrail ativo | conferir vínculo e logs `whatsapp inbound blocked by guardrail` |

## Arquivos e migrações

- `apps/api/src/channels/whatsapp.ts`: assinatura, parsing, número BR e botões;
- `apps/api/src/routes/whatsapp.ts`: Settings, webhook e entrega Cloud API;
- `apps/api/src/whatsapp-guardrail*.ts`: admissão, hash e respostas fixas;
- `apps/api/src/orchestrator.ts`: cérebro compartilhado;
- `apps/api/src/charge-creation.ts`: criação comum ao WhatsApp e Dashboard;
- `scripts/test-whatsapp.mjs`: teste de templates;
- `20260722120000_provider_whatsapp_numbers.sql`: vínculo do número;
- `20260722195152_whatsapp_charge_proposals.sql`: confirmação persistida;
- `20260722202510_whatsapp_guardrail.sql`: limites atômicos e circuit breaker.

## Checklist para sair do teste

- usar domínio estável da API no callback, não ngrok;
- manter App Secret, verify token e access token no ambiente do Railway;
- cadastrar e verificar o número real da WABA;
- aprovar os templates necessários para mensagens iniciadas pela empresa;
- revisar os destinatários e remover dependências da lista de teste;
- observar bloqueios, erros da Cloud API e consumo diário da OpenAI;
- ajustar cotas somente com dados do piloto;
- definir rotação e resposta a comprometimento do token permanente.
