create index idx_charges_client
  on public.charges (client_id);

create index idx_events_charge
  on public.events (charge_id);

create index idx_events_payment
  on public.events (payment_id);

create index idx_notifications_payment
  on public.notifications (payment_id);

create index idx_payment_transitions_payment
  on public.payment_transitions (payment_id);

create policy "block_direct_client_access"
  on public.providers
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "block_direct_client_access"
  on public.clients
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "block_direct_client_access"
  on public.charges
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "block_direct_client_access"
  on public.payments
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "block_direct_client_access"
  on public.payment_transitions
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "block_direct_client_access"
  on public.events
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "block_direct_client_access"
  on public.notifications
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "block_direct_client_access"
  on public.assistant_action_proposals
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);
