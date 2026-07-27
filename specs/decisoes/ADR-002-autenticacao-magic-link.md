---
title: "ADR-002 — Autenticação por magic link"
created: 2026-07-19
updated: 2026-07-26
status: aceita
tags:
  - prestou
  - spec
  - autenticação
  - adr
relacionado:
  - "[[ADR-001 - Arquitetura híbrida Supabase + Railway]]"
  - "[[Fluxo de cadastro, convite e autenticação do prestador]]"
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

1. O administrador cria o convite por WhatsApp e a API envia o template
   `convite_prestador`.
2. O próprio número responde ou toca no botão; o inbound assinado comprova o
   WhatsApp e libera um link temporário de cadastro.
3. No link, o prestador informa o e-mail e passa pelo CAPTCHA.
4. A API cria ou reutiliza uma identidade Supabase ainda sem `provider` e a
   vincula à sessão de onboarding.
5. O navegador solicita o magic link com `shouldCreateUser: false`.
6. Supabase envia o magic link; ao abri-lo, a PWA obtém a sessão confirmada.
7. O prestador informa perfil, chave Pix e consentimento.
8. A API valida o JWT, trava convite/sessão/token e cria o `provider` na mesma
   transação que consome o onboarding.

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
