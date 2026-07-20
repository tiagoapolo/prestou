---
title: "ADR-007 — pnpm para gestão do monorepo"
created: 2026-07-20
status: aceita
tags:
  - prestou
  - spec
  - arquitetura
  - adr
  - pnpm
relacionado:
  - "[[ADR-006 - Deploy Railway por nome do serviço]]"
---

# ADR-007 — pnpm para gestão do monorepo

## Decisão

Usar pnpm como gerenciador exclusivo do monorepo, com a versão `11.9.0` fixada
no campo `packageManager` da raiz e workspaces declarados em
`pnpm-workspace.yaml`.

Fixar o runtime de build e produção em Node.js 24 LTS por `.nvmrc` e
`engines.node`, mantendo os ambientes local e Railway alinhados. A versão do
Corepack usada pelo Nixpacks é fixada separadamente para garantir a execução do
pnpm nesse runtime.

Cada aplicação e pacote mantém seu próprio `package.json`. A raiz apenas
orquestra comandos compartilhados e não concentra dependências específicas dos
workspaces.

Decisão aprovada por Fonseca em 20 de julho de 2026.

## Contexto

O projeto começou com npm workspaces e `package-lock.json`. Com API, site e uma
biblioteca Pix compartilhada, pnpm oferece filtros mais explícitos, instalação
mais econômica e isolamento mais rigoroso das dependências.

Ter vários `package.json` não depende do gerenciador: cada workspace precisa
declarar seus próprios scripts, dependências e metadados.

## Consequências

- `pnpm-lock.yaml` passa a ser o único lockfile versionado.
- Dependências internas usam o protocolo `workspace:*`.
- Builds direcionados usam `pnpm --filter`; o filtro `@prestou/api...` inclui o
  pacote Pix do qual a API depende.
- Railway detecta pnpm pelo lockfile e pela versão fixada em `packageManager`.
- Railway usa Node.js 24 LTS, sem resolução flutuante de `nodejs lts`.
- Nixpacks instala Corepack 0.34.6 antes de executar pnpm, evitando a versão
  legada incompatível com Node.js 24 usada pelo provider padrão.
- Instalações reproduzíveis usam `pnpm install --frozen-lockfile`.
- Scripts de instalação de dependências ficam bloqueados por padrão; somente
  `esbuild`, necessário ao Vite, está explicitamente autorizado.

## Estrutura

| Workspace | Responsabilidade |
|---|---|
| raiz | orquestração, lockfile e configuração Railway |
| `@prestou/api` | Fastify, banco, autenticação e regras de negócio |
| `@prestou/web` | site mobile React |
| `@prestou/pix` | geração e validação do BR Code Pix |
