---
title: "ADR-006 — Deploy Railway por nome do serviço"
created: 2026-07-20
status: aceita
tags:
  - prestou
  - spec
  - arquitetura
  - adr
  - railway
relacionado:
  - "[[ADR-001 - Arquitetura híbrida Supabase + Railway]]"
---

# ADR-006 — Deploy Railway por nome do serviço

## Decisão

Usar um único `railway.json` na raiz do monorepo. Os comandos de build e start
selecionam `@prestou/api` ou `@prestou/web` a partir da variável automática
`RAILWAY_SERVICE_NAME`.

Os serviços devem manter os nomes `@prestou/api` e `@prestou/web`. Caso sejam
renomeados, cada serviço deve declarar `PRESTOU_RAILWAY_SERVICE=api` ou
`PRESTOU_RAILWAY_SERVICE=web`.

Decisão aprovada por Fonseca em 20 de julho de 2026.

## Contexto

O Railway detecta automaticamente apenas o `railway.json` padrão da raiz. O
arquivo alternativo `railway.web.json` dependia de uma configuração manual na
interface. Quando essa configuração não era aplicada, o serviço Web executava o
script `start` da raiz, iniciava a API e falhava por não possuir `DATABASE_URL`.

## Consequências

- API e Web podem continuar como serviços Railway separados ligados ao mesmo
  repositório e à branch `main`.
- O diretório raiz permanece `/`, preservando npm workspaces e o lockfile único.
- Um serviço desconhecido falha com uma mensagem explícita, em vez de executar a
  API por padrão.
- O health check comum é `GET /health`; a API expõe a rota e o servidor SPA do
  Web responde com o documento principal nesse caminho.
- A seleção passa a depender do nome do serviço ou do override explícito
  `PRESTOU_RAILWAY_SERVICE`.

## Configuração operacional

| Serviço | Nome Railway | Override opcional | Variáveis principais |
|---|---|---|---|
| API | `@prestou/api` | `api` | `DATABASE_URL`, Supabase, CORS e cron |
| Web | `@prestou/web` | `web` | `VITE_API_URL` |

Não deve existir Custom Start Command ou Custom Build Command divergente na
interface do Railway. O arquivo raiz é a fonte de verdade do deploy.
