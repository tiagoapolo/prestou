alter table public.payments
  add column financial_voided_at timestamptz;

alter table public.financial_entry_events
  drop constraint if exists financial_entry_events_action_check;

alter table public.financial_entry_events
  add constraint financial_entry_events_action_check
  check (action in ('created', 'updated', 'voided', 'payment_reopened', 'payment_voided'));

-- Corrige cobranças que tenham sido reabertas pela primeira implementação da
-- ação. O estado operacional volta a paga, mas o recebimento fica removido do
-- Financeiro, que é a semântica correta da ação.
with latest_reopens as (
  select distinct on (source_id)
         provider_id, source_id, before_data
    from public.financial_entry_events
   where source_type = 'payment' and action = 'payment_reopened'
   order by source_id, created_at desc
)
insert into public.financial_entry_events
  (id, provider_id, source_type, source_id, action, before_data, after_data, created_at)
select gen_random_uuid(), r.provider_id, 'payment', p.id, 'payment_voided',
       jsonb_build_object('status', p.status),
       jsonb_build_object('status', 'paga', 'financialVoidedAt', current_timestamp),
       current_timestamp
  from public.payments p
 join latest_reopens r on r.source_id = p.id
 where p.status in ('em_aberto', 'cliente_confirmou')
   and (
     select pt.action
       from public.payment_transitions pt
      where pt.payment_id = p.id
      order by pt.created_at desc, pt.id desc
      limit 1
   ) = 'prestador_desfez_pagamento';

with latest_reopens as (
  select distinct on (source_id)
         source_id, before_data
    from public.financial_entry_events
   where source_type = 'payment' and action = 'payment_reopened'
   order by source_id, created_at desc
)
update public.payments p
   set status = 'paga',
       paid_at = nullif(r.before_data ->> 'paidAt', '')::timestamptz,
       paid_via = nullif(r.before_data ->> 'paidVia', ''),
       received_amount_cents = nullif(r.before_data ->> 'receivedAmountCents', '')::integer,
       payment_method = nullif(r.before_data ->> 'paymentMethod', ''),
       financial_note = nullif(r.before_data ->> 'note', ''),
       financial_voided_at = current_timestamp
  from latest_reopens r
 where p.id = r.source_id
   and p.status in ('em_aberto', 'cliente_confirmou')
   and (
     select pt.action
       from public.payment_transitions pt
      where pt.payment_id = p.id
      order by pt.created_at desc, pt.id desc
      limit 1
   ) = 'prestador_desfez_pagamento';

drop index if exists public.idx_payments_paid_at;
create index idx_payments_paid_at
  on public.payments (paid_at)
  where status = 'paga' and financial_voided_at is null;
