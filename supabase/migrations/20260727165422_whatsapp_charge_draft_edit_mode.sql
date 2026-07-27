alter table public.whatsapp_pending_charges
  add column mode text not null default 'fill',
  add constraint whatsapp_pending_charges_mode_check
    check (mode in ('fill', 'edit'));
