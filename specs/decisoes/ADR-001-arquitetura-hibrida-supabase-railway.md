---
title: "ADR-001 — Arquitetura híbrida Supabase + Railway"
created: 2026-07-19
status: aceita
tags:
  - prestou
  - spec
  - arquitetura
  - adr
relacionado:
  - "[[Prestou - Plano de Execução do MVP]]"
  - "[[Prestou - MVP]]"
---

# ADR-001 — Arquitetura híbrida Supabase + Railway

## Decisão

Usar uma arquitetura híbrida no MVP:

- **Supabase:** autenticação dos prestadores, PostgreSQL e Storage privado dos comprovantes.
- **Railway:** API Fastify, site mobile e execução agendada dos lembretes.
- **Meta Cloud API:** envio unidirecional de notificações WhatsApp ao prestador.

Decisão aprovada por Fonseca em 19 de julho de 2026.

## Contexto

O backend inicial usa SQLite local, arquivos locais para comprovantes e tokens Bearer emitidos no onboarding. Isso é adequado para validar regras de negócio, mas não oferece persistência segura em deploy efêmero, recuperação de acesso, sessões gerenciadas ou armazenamento privado robusto.

O MVP deve minimizar trabalho de infraestrutura que não testa a hipótese de produto. Ao mesmo tempo, a API Fastify existente contém regras relevantes — geração do Pix, máquina de estados, lembretes, WhatsApp e analytics — que não devem ser reescritas como funções específicas de um fornecedor.

## Consequências

### Positivas

- Autenticação, sessão e recuperação de acesso ficam sob responsabilidade de um serviço gerenciado.
- PostgreSQL e Storage privado evitam volumes locais e perda de dados em redeploy.
- A API permanece portável e concentra as regras de negócio.
- Railway fornece deploy e cron simples para o backend existente.
- Comprovantes podem ser entregues por URLs assinadas e temporárias.

### Custos e riscos

- Existem dois fornecedores para configurar, observar e faturar.
- A API precisa validar JWTs do Supabase e aplicar autorização por prestador.
- Migrações SQL e políticas de Storage/RLS tornam-se parte obrigatória do deploy.
- Ambientes local, staging e produção precisam de variáveis coordenadas entre Supabase e Railway.

## Fronteiras de responsabilidade

| Componente | Responsabilidade |
|---|---|
| Site mobile | Interface mobile-first, sessão Supabase e chamadas à API |
| Supabase Auth | Identidade, login, sessão e recuperação de acesso |
| API Fastify | Autorização, Pix, cobranças, estados, analytics, lembretes e WhatsApp |
| Supabase PostgreSQL | Persistência transacional e auditoria |
| Supabase Storage | Comprovantes privados, com retenção e acesso temporário |
| Railway | Hospedagem da API/site mobile e cron de lembretes |
| Meta Cloud API | Notificação Prestou → prestador |

## Regras de segurança

- O cliente final continua sem autenticação e acessa somente uma URL pública não adivinhável.
- O token público nunca concede acesso ao painel ou a dados de outros clientes.
- A API deriva o prestador autenticado do JWT; não aceita `provider_id` escolhido pelo cliente.
- O bucket de comprovantes é privado; download somente por URL assinada de curta duração.
- A service role do Supabase existe apenas no backend Railway e nunca chega ao navegador.
- Transições de pagamento continuam atômicas e auditadas.

## Implementação

O schema PostgreSQL, a validação JWT, o Storage privado e o site mobile foram implementados. Em 20 de julho de 2026, o fallback SQLite também foi removido; ver [[ADR-005 - Supabase como ambiente único de dados]].

## Decisões pendentes

- Retenção dos comprovantes e prazo das URLs assinadas.
- Política de ambientes e uso de projeto Supabase separado para produção.
