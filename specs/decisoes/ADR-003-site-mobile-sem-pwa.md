---
title: "ADR-003 — Site mobile comum, sem PWA"
created: 2026-07-19
status: aceita
tags:
  - prestou
  - spec
  - frontend
  - adr
relacionado:
  - "[[ADR-001 - Arquitetura híbrida Supabase + Railway]]"
---

# ADR-003 — Site mobile comum, sem PWA

## Decisão

Construir o painel do prestador e a página pública de pagamento como um **site responsivo mobile-first em React + Vite**, sem recursos de PWA no MVP.

Não haverá manifest de instalação, service worker, cache offline, push notification ou modo standalone.

Decisão aprovada por Fonseca em 19 de julho de 2026.

## Motivos

- O prestador será avisado pelo WhatsApp, não pelo navegador.
- A página do cliente precisa abrir imediatamente no webview do WhatsApp, sem instalação.
- Instalação e funcionamento offline não testam a hipótese principal do MVP.
- Um site comum reduz estados de cache, problemas de atualização e esforço de QA.
- React + Vite atende os fluxos interativos sem necessidade de SSR ou SEO.

## Consequências

- O acesso do prestador acontece por URL/favorito e pelos links recebidos no WhatsApp.
- O Railway hospeda o build estático do frontend e encaminha todas as rotas para `index.html`.
- O site precisa funcionar bem em Safari iOS, Chrome Android e webviews do WhatsApp.
- “PWA” deixa de ser critério de aceite e deve ser entendido como “painel web mobile” nos documentos anteriores.
- A opção de instalação poderá ser reavaliada depois do piloto, se houver evidência de dificuldade de retorno ao painel.

## Critérios de aceite

- Todos os fluxos do prestador funcionam a partir de 320 px de largura.
- A página pública funciona sem login e sem recursos específicos do navegador instalado.
- Recarregar uma rota interna não produz 404 no ambiente publicado.
- Nenhum fluxo depende de service worker, push ou disponibilidade offline.

