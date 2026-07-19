---
title: "ADR-004 — Componentes com shadcn/ui"
created: 2026-07-19
status: aceita
tags:
  - prestou
  - spec
  - frontend
  - design-system
  - adr
relacionado:
  - "[[ADR-003 - Site mobile comum, sem PWA]]"
---

# ADR-004 — Componentes com shadcn/ui

## Decisão

Usar **shadcn/ui** como base dos componentes reutilizáveis do site React: botões, campos, labels, cards, badges, alertas, checkboxes e selects.

Decisão solicitada por Fonseca em 19 de julho de 2026.

## Abordagem

- Os componentes são incorporados ao código do Prestou, não consumidos como uma caixa-preta.
- Tailwind CSS fornece os tokens e utilitários de estilo.
- Radix UI fornece primitivas acessíveis quando o componente exige comportamento.
- Cores, tipografia, raios e estados seguem a identidade própria do Prestou.
- CSS específico continua permitido para composição de páginas e detalhes visuais.

## Consequências

- Estados de foco, teclado e acessibilidade ficam consistentes.
- O time pode alterar qualquer componente sem depender de releases de uma biblioteca visual fechada.
- Novos componentes devem ser adicionados pelo mesmo padrão e revisados para mobile.
- Evitar misturar botões/campos HTML estilizados manualmente com equivalentes shadcn sem justificativa.

## Critérios de aceite

- Componentes interativos principais usam a camada `components/ui`.
- Tema Prestou está definido por variáveis semânticas, não por cores espalhadas nas páginas.
- Fluxos permanecem utilizáveis por teclado e com foco visível.
- Build e typecheck permanecem verdes.

