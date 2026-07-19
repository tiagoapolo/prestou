---
title: "ADR-002 — Autenticação por magic link"
created: 2026-07-19
status: aceita
tags:
  - prestou
  - spec
  - autenticação
  - adr
relacionado:
  - "[[ADR-001 - Arquitetura híbrida Supabase + Railway]]"
---

# ADR-002 — Autenticação por magic link

## Decisão

Usar **magic link enviado por e-mail pelo Supabase Auth** como único método de login do prestador no MVP. Não haverá senha nem OTP por telefone nesta fase.

Decisão aprovada por Fonseca em 19 de julho de 2026.

## Motivos

- Evita implementar senha, redefinição e armazenamento de credenciais.
- Não exige contratar ou operar um provedor de SMS.
- É adequado ao piloto assistido de 10 prestadores.
- Mantém a sessão gerenciada pelo Supabase e permite revogação de acesso.

## Consequências

- E-mail passa a ser obrigatório no onboarding do prestador.
- A PWA precisa tratar o retorno do magic link e persistir a sessão Supabase.
- Links de redirecionamento de local, staging e produção precisam ser cadastrados no Supabase.
- A API valida o access token do Supabase e associa `auth.users.id` ao registro em `providers`.
- O telefone continua obrigatório para notificações do Prestou via WhatsApp, mas não autentica o usuário.

## Fluxo

1. No onboarding assistido, o prestador informa e-mail e demais dados do perfil.
2. O operador cria/convida a identidade no Supabase Auth e associa seu ID ao perfil.
3. O prestador informa o e-mail na PWA.
4. Supabase envia o magic link.
5. O link retorna à PWA, que obtém a sessão.
6. A PWA chama a API com `Authorization: Bearer <access_token>`.
7. A API valida o token e resolve o prestador por `auth_user_id`.

## Segurança e privacidade

- A API nunca confia em e-mail ou `provider_id` enviado pela PWA para autorizar recursos.
- O `sub` validado do JWT é a identidade canônica.
- Mensagens de login não revelam se um e-mail já está cadastrado.
- O e-mail não é exposto na página pública de pagamento.
- A service role permanece exclusivamente no backend.

## Critérios de aceite

- Prestador recebe o link e entra sem senha.
- Sessão permanece ativa após recarregar a PWA.
- Token ausente, expirado ou inválido recebe `401`.
- Usuário Supabase válido sem perfil Prestou recebe `403` com orientação de onboarding.
- Um prestador não acessa cobranças ou comprovantes de outro.

