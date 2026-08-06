# Todo: Onboarding self-serve pelo WhatsApp

Fonte: `tasks/plan.md`. A implementação segue a ordem de dependências abaixo.

- [x] Task 1: Introduzir o contrato de modos sem quebrar configuração existente
  - Acceptance: `disabled`, `invite_only` e `public` são testados; a variável
    legada preserva o comportamento atual; startup valida pré-requisitos.
  - Verify: teste focado de config e `pnpm --filter @prestou/api typecheck`.
  - Files: `apps/api/src/config.ts`, `apps/api/src/server.ts`,
    `apps/api/.env.example`, `apps/api/test/config.test.ts`.

- [ ] Task 2: Tornar sessões source-aware e adicionar correlação do funil
  - Acceptance: convite continua válido; sessão pública sem convite é possível;
    RLS e índices são preservados.
  - Verify: migração em Supabase de teste, teste de onboarding e advisors.
  - Files: nova migração, fixture e teste de onboarding.

- [x] Task 3: Criar o contrato assinado de intenção e os primitivos de analytics
  - Acceptance: atribuição validada e assinada; envelope inválido não autoriza;
    eventos aceitam `journeyId` idempotente.
  - Verify: teste unitário focado e typecheck da API.
  - Files: `public-signup.ts`, `analytics.ts`, teste unitário.

- [x] Task 4: Entregar a rota pública e o CTA até o WhatsApp
  - Acceptance: `/comecar` abre apenas `wa.me` oficial; modo indisponível é
    seguro; entrada é rastreada uma vez.
  - Verify: testes de API e Vitest da página.
  - Files: rota de onboarding, teste, `App.tsx`, nova página e seu teste.

- [ ] Task 5: Admitir inbound público sem permitir LLM ou duplicidade
  - Acceptance: frase exata cria uma sessão; mensagens não elegíveis não chegam
    à LLM; replays não criam duplicidade.
  - Verify: testes de webhook, corrida e replay.
  - Files: parser, onboarding, rota WhatsApp, fixture e integração.

- [ ] Task 6: Generalizar Auth e promoção para sessões públicas
  - Acceptance: origem pública e convite criam uma conta única; cada modo aplica
    o gate correto; Auth não deixa órfãos indevidos.
  - Verify: integração completa e testes de retenção.
  - Files: onboarding, providers, fixture e integração.

- [ ] Task 7: Tornar a experiência web neutra à origem
  - Acceptance: copy não chama tudo de convite; conta nova encontra `/comecar`;
    acessibilidade preservada.
  - Verify: Vitest, typecheck e navegador real.
  - Files: Login, Onboarding, Auth e testes.

- [ ] Task 8: Instrumentar todas as transições do onboarding
  - Acceptance: seis etapas idempotentes; metadados sem PII; primeira cobrança
    derivável.
  - Verify: integração de eventos e inspeção de metadados.
  - Files: analytics, onboarding, providers e teste.

- [ ] Task 9: Expor o funil agregado para operação
  - Acceptance: endpoint e admin mostram conversão sem PII; autorização admin
    é obrigatória.
  - Verify: testes de consulta/autorização, Vitest e `EXPLAIN` em teste.
  - Files: query de analytics, rota, teste e painel admin.

- [ ] Task 10: Fechar segurança, operação e documentação
  - Acceptance: runbook, smoke de staging, rollback e revisão Supabase/Meta
    documentados; produção não é habilitada.
  - Verify: suites completas, typecheck, build, diff e revisão de secrets.
  - Files: exemplos de env, README, operação e specs de fluxo.
