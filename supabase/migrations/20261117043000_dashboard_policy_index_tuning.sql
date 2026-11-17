-- Keep the newly introduced owner/public read paths init-plan friendly and
-- cover foreign keys that the database advisor identified on these tables.

create index if not exists site_offers_created_by_idx on public.site_offers (created_by);
create index if not exists manual_refunds_created_by_idx on public.manual_refunds (created_by);
create index if not exists customer_activity_actor_idx on public.customer_activity (actor_id);
create index if not exists customer_activity_application_idx on public.customer_activity (application_id);
create index if not exists customer_activity_offer_idx on public.customer_activity (offer_id);
create index if not exists customer_activity_refund_idx on public.customer_activity (refund_id);

drop policy "public reads current active offers" on public.site_offers;
drop policy "owner reads offers with aal2" on public.site_offers;
create policy "read public active offers or owner offers with aal2" on public.site_offers
  for select to anon, authenticated
  using (
    (active and starts_at <= now() and ends_at > now())
    or (
      lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
      and ((select auth.jwt()) ->> 'aal') = 'aal2'
    )
  );

drop policy "owner creates offers with aal2" on public.site_offers;
create policy "owner creates offers with aal2" on public.site_offers
  for insert to authenticated
  with check (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );

drop policy "owner updates offers with aal2" on public.site_offers;
create policy "owner updates offers with aal2" on public.site_offers
  for update to authenticated
  using (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  )
  with check (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );

drop policy "owner deletes offers with aal2" on public.site_offers;
create policy "owner deletes offers with aal2" on public.site_offers
  for delete to authenticated
  using (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

drop policy "owner reads refund records with aal2" on public.manual_refunds;
create policy "owner reads refund records with aal2" on public.manual_refunds
  for select to authenticated
  using (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

drop policy "owner creates refund records with aal2" on public.manual_refunds;
create policy "owner creates refund records with aal2" on public.manual_refunds
  for insert to authenticated
  with check (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );

drop policy "owner updates refund records with aal2" on public.manual_refunds;
create policy "owner updates refund records with aal2" on public.manual_refunds
  for update to authenticated
  using (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  )
  with check (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );

drop policy "owner reads customer activity with aal2" on public.customer_activity;
create policy "owner reads customer activity with aal2" on public.customer_activity
  for select to authenticated
  using (
    lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
    and ((select auth.jwt()) ->> 'aal') = 'aal2'
  );

drop policy "customer reads own profile" on public.customer_profiles;
drop policy "owner reads profiles with aal2" on public.customer_profiles;
create policy "customers and verified owner read limited profiles" on public.customer_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      lower(((select auth.jwt()) ->> 'email')) = 'deepcsc06@gmail.com'
      and ((select auth.jwt()) ->> 'aal') = 'aal2'
    )
  );
