---
title: "ADR-005 — Supabase como ambiente único de dados"
created: 2026-07-20
status: aceita
tags:
  - prestou
  - spec
  - arquitetura
  - banco-de-dados
  - adr
relacionado:
  - "[[ADR-001 - Arquitetura híbrida Supabase + Railway]]"
---

# ADR-005 — Supabase como ambiente único de dados

## Decisão

Usar PostgreSQL, Auth e Storage do Supabase em desenvolvimento, testes integrados e produção. Remover completamente o fallback SQLite, tokens locais e armazenamento de comprovantes no sistema de arquivos.

Decisão solicitada por Fonseca em 20 de julho de 2026.

## Motivos

- Um único caminho de execução reduz código condicional e divergência entre ambientes.
- Os fluxos críticos passam a ser exercitados contra os mesmos recursos usados em produção.
- Migrações PostgreSQL são a única fonte da verdade do schema.
- Autorização sempre depende de JWT Supabase; não existe identidade alternativa de desenvolvimento.
- Comprovantes sempre respeitam bucket privado e URL assinada.

## Consequências

- Desenvolvimento local exige conexão com um projeto Supabase.
- A API falha cedo quando `DATABASE_URL` ou credenciais Supabase estão ausentes.
- Testes integrados exigem um projeto Supabase separado e descartável.
- A suíte integrada é ignorada quando as variáveis `TEST_*` não estão configuradas.
- O projeto de produção nunca deve ser usado pela suíte automatizada.
- Não há funcionamento offline do backend.

## Variáveis obrigatórias da API

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` — publishable key atual ou anon key legada
- `SUPABASE_SERVICE_ROLE_KEY` — secret key atual ou service-role key legada

## Regras de teste

- Usar projeto Supabase exclusivo para testes.
- Aplicar as mesmas migrações antes da suíte.
- Criar usuários únicos por execução.
- Excluir os usuários ao final; o cascade remove os dados do teste.
- Nunca apontar `TEST_DATABASE_URL` para produção.

