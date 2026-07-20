# Prestou

Cobranças via Pix para prestadores de serviço, sem complicação e sem o dinheiro passar pela plataforma.

O Prestou cria uma cobrança com valor definido, gera o Pix Copia e Cola, prepara a mensagem para envio pelo WhatsApp e permite que o próprio cliente confirme o pagamento e anexe um comprovante. O prestador acompanha quem deve, valida recebimentos e envia lembretes semiautomáticos.

## Status

MVP em desenvolvimento para piloto assistido com prestadores reais.

Implementado:

- onboarding do prestador;
- autenticação Supabase por magic link;
- cadastro e reaproveitamento de clientes;
- cobrança única com Pix estático;
- BR Code próprio com CRC16;
- página pública de pagamento sem login;
- QR Code sob demanda;
- confirmação do cliente e comprovante opcional;
- validação, pagamento manual e contestação pelo prestador;
- painel “quem me deve”;
- lembretes D+0, D+2 e D+5;
- notificações ao prestador pela Meta Cloud API;
- analytics do funil e auditoria de transições;
- PostgreSQL e Storage privado no Supabase em todos os ambientes.

## Arquitetura

```text
Site React + Vite
       │
       │ JWT Supabase
       ▼
API Fastify no Railway ─────► Meta Cloud API ─────► WhatsApp do prestador
       │
       ├────► PostgreSQL do Supabase
       └────► Supabase Storage privado
```

| Componente | Tecnologia |
|---|---|
| Site mobile | React, Vite, TypeScript, shadcn/ui e Tailwind CSS |
| API | Fastify e Zod |
| Autenticação | Supabase Auth com magic link |
| Banco de dados | PostgreSQL do Supabase |
| Comprovantes | Supabase Storage privado |
| Hospedagem | Railway |
| Notificações | WhatsApp Cloud API da Meta |
| Pix | Implementação própria do BR Code/Bacen |

O cliente final não cria conta. Cada pagamento possui um token público aleatório e não adivinhável.

## Estrutura

```text
apps/
  api/                  API Fastify, regras de negócio e testes de fluxo
  web/                  site mobile React
packages/
  pix/                  geração e validação do BR Code Pix
specs/decisoes/         registros de decisões arquiteturais
supabase/migrations/    schema PostgreSQL e configuração do bucket privado
```

## Requisitos

- Node.js LTS, versão 20 ou superior;
- pnpm 11.9.0 (fixado no `packageManager` da raiz);
- projeto Supabase;
- conta Railway para publicação;
- WABA/Meta Cloud API somente para o envio real de WhatsApp.

## Instalação

```bash
corepack enable
pnpm install --frozen-lockfile
```

## Desenvolvimento local

O desenvolvimento usa o mesmo PostgreSQL, Auth e Storage do Supabase utilizados em produção. Não existe banco ou autenticação alternativos locais.

Copie e preencha os exemplos:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Inicie a API:

```bash
pnpm dev:api
```

Em outro terminal, inicie o site:

```bash
pnpm dev:web
```

- Site: `http://localhost:3000`
- API: `http://localhost:3333`
- Health check: `http://localhost:3333/health`

O login local usa magic link real do Supabase. Cadastre `http://localhost:3000` nas redirect URLs do Auth.

## Configuração do Supabase

Aplique a migração em [`supabase/migrations`](./supabase/migrations):

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

A migração cria:

- tabelas do MVP;
- índices;
- auditoria de transições;
- RLS como defesa em profundidade;
- bucket privado `receipts`, limitado a 10 MB por arquivo.

Configure no Supabase Auth:

- Site URL do frontend publicado;
- redirect URL do frontend;
- magic link por e-mail;
- SMTP próprio antes de ampliar o piloto, se necessário.

## Variáveis da API

Use [`apps/api/.env.example`](./apps/api/.env.example) como referência.

Principais variáveis de produção:

```env
PORT=3333
PUBLIC_WEB_URL=https://seu-site.example
CORS_ORIGINS=https://seu-site.example

DATABASE_URL=postgresql://...
DATABASE_POOL_SIZE=5
DATABASE_SSL=true

SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SUPABASE_RECEIPTS_BUCKET=receipts
SIGNED_URL_TTL_SECONDS=300

CRON_SECRET=...

WHATSAPP_MODE=log
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_TEMPLATE_LANG=pt_BR
```

Use a URL do Transaction Pooler do Supabase em `DATABASE_URL`. A service role e a URL do banco são segredos exclusivos da API e nunca podem chegar ao navegador.

## Variáveis do site

Use [`apps/web/.env.example`](./apps/web/.env.example) como referência:

```env
VITE_API_URL=https://sua-api.example
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

A publishable/anon key é pública por definição. A secret/service-role key não é.

## WhatsApp

O modo padrão é `log`: a notificação é gravada no banco, mas não enviada.

Para envio real:

```env
WHATSAPP_MODE=cloud-api
```

Templates esperados:

- `pagamento_confirmado_cliente`;
- `lembrete_cobranca_prestador`.

No MVP, a automação é estritamente Prestou → prestador. Mensagens ao cliente são abertas como links `wa.me` e enviadas manualmente pelo prestador.

## Qualidade

Execute typecheck, build e testes unitários:

```bash
pnpm test
pnpm typecheck
pnpm --filter @prestou/web build
```

O filtro da API inclui sua dependência `@prestou/pix`. Em deploys Railway separados, use:

```bash
# Serviço da API
pnpm --filter @prestou/api... build

# Serviço do site
pnpm --filter @prestou/web build
```

Os testes do pacote Pix sempre são executados. Os testes integrados da API exigem um projeto Supabase separado e as quatro variáveis `TEST_*` descritas em `apps/api/.env.example`; sem elas, o runner os marca como ignorados. Nunca execute a suíte integrada contra o projeto de produção.

Com um projeto de teste configurado, a suíte cobre fluxo feliz, isolamento entre prestadores, concorrência de estados, contestação, pagamento manual, painel, analytics e idempotência dos lembretes.

## Máquina de estados

```text
em_aberto ── cliente confirma ──► cliente_confirmou ── prestador valida ──► paga
     │                                  │
     └── prestador marca manual ────────┘
                                        └── contesta ──► em_aberto
```

`atrasada` é uma condição derivada de `em_aberto` com vencimento passado; nunca é persistida como estado.

## Cron de lembretes

O Railway deve chamar periodicamente:

```http
POST /api/internal/run-reminders
Authorization: Bearer <CRON_SECRET>
```

O processamento é idempotente por pagamento e dia.

## Railway

O [`railway.json`](./railway.json) da raiz atende os dois serviços. O script de
deploy usa `RAILWAY_SERVICE_NAME`, fornecido automaticamente pelo Railway, para
selecionar o workspace correto:

- `@prestou/api`: build e start do workspace da API;
- `@prestou/web`: build e start do workspace do site;
- health check comum: `GET /health`;
- restart automático em caso de falha.

Mantenha os nomes dos serviços como `@prestou/api` e `@prestou/web`. Se precisar
renomeá-los, defina `PRESTOU_RAILWAY_SERVICE=api` ou
`PRESTOU_RAILWAY_SERVICE=web` no serviço correspondente. Um nome desconhecido
interrompe o deploy com uma mensagem explícita, sem iniciar o workspace errado.

Antes do deploy da API, configure pelo menos `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_WEB_URL`,
`CORS_ORIGINS` e `CRON_SECRET`. No Web, configure `VITE_API_URL` com o domínio
HTTPS público da API. O Railway fornece `PORT` automaticamente. Não use
`pnpm dev:web` em produção.

## Decisões técnicas

- [ADR-001 — Arquitetura híbrida Supabase + Railway](./specs/decisoes/ADR-001-arquitetura-hibrida-supabase-railway.md)
- [ADR-002 — Autenticação por magic link](./specs/decisoes/ADR-002-autenticacao-magic-link.md)
- [ADR-003 — Site mobile comum, sem PWA](./specs/decisoes/ADR-003-site-mobile-sem-pwa.md)
- [ADR-004 — Componentes com shadcn/ui](./specs/decisoes/ADR-004-componentes-shadcn-ui.md)
- [ADR-005 — Supabase como ambiente único de dados](./specs/decisoes/ADR-005-supabase-como-ambiente-unico-de-dados.md)
- [ADR-006 — Deploy Railway por nome do serviço](./specs/decisoes/ADR-006-deploy-railway-por-servico.md)
- [ADR-007 — pnpm para gestão do monorepo](./specs/decisoes/ADR-007-pnpm-para-o-monorepo.md)

## Segurança

- não commite arquivos `.env`;
- nunca exponha `SUPABASE_SERVICE_ROLE_KEY`;
- comprovantes ficam em bucket privado;
- downloads usam URLs assinadas e temporárias;
- a API deriva o prestador do JWT validado;
- a página pública não expõe nome ou telefone do cliente;
- toda transição de pagamento é atômica e auditada.

## Escopo do MVP

Fora do MVP: parcelamento, PSP/Pix dinâmico, confirmação automática por webhook, envio automático ao cliente, agenda, OCR, cartão, boleto e aplicativo nativo.

O objetivo do piloto é descobrir se o prestador recebe mais rápido e deixa de pedir comprovantes — e se isso vale uma mensalidade real.
