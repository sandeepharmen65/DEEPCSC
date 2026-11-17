-- Bind owner access to the confirmed Auth user's immutable UID. The email is
-- used only once to locate the current owner and is not used by RLS policies.
-- Dashboard access continues to require an AAL2 authenticator session.

begin;

create table private.punjab_csc_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.punjab_csc_owners enable row level security;
alter table private.punjab_csc_owners force row level security;
revoke all on table private.punjab_csc_owners from public, anon, authenticated, service_role;

-- Fail safely if the current configured owner cannot be identified exactly once.
do $$
declare
  matching_owners integer;
  owner_user_id uuid;
begin
  select count(*), (array_agg(id))[1]
    into matching_owners, owner_user_id
    from auth.users
   where lower(email) = 'sandeepharmen@gmail.com';

  if matching_owners <> 1 or owner_user_id is null then
    raise exception 'Expected exactly one current Punjab CSC owner Auth user for the existing owner email; no owner policies were changed.';
  end if;

  insert into private.punjab_csc_owners(user_id)
  values (owner_user_id)
  on conflict (user_id) do nothing;
end;
$$;

-- Private, user-ID-based check remains valid when Supabase Auth confirms the
-- new email. The function is not in an exposed schema and only tests auth.uid().
create or replace function private.is_punjab_csc_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (
      select 1
        from private.punjab_csc_owners owner_entry
       where owner_entry.user_id = (select auth.uid())
    )
$$;

revoke all on function private.is_punjab_csc_owner() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_punjab_csc_owner() to authenticated;

-- Offers: keep anonymous public-offer reads separate from the private helper.
drop policy if exists "read public active offers or owner offers with aal2" on public.site_offers;
drop policy if exists "public reads current active offers" on public.site_offers;
drop policy if exists "owner reads offers with aal2" on public.site_offers;
create policy "public reads current active offers" on public.site_offers
  for select to anon, authenticated
  using (active and starts_at <= now() and ends_at > now());
create policy "owner reads offers with aal2" on public.site_offers
  for select to authenticated
  using ((select private.is_punjab_csc_owner()));
drop policy if exists "owner creates offers with aal2" on public.site_offers;
create policy "owner creates offers with aal2" on public.site_offers
  for insert to authenticated
  with check ((select private.is_punjab_csc_owner()) and created_by = (select auth.uid()));
drop policy if exists "owner updates offers with aal2" on public.site_offers;
create policy "owner updates offers with aal2" on public.site_offers
  for update to authenticated
  using ((select private.is_punjab_csc_owner()))
  with check ((select private.is_punjab_csc_owner()) and created_by = (select auth.uid()));
drop policy if exists "owner deletes offers with aal2" on public.site_offers;
create policy "owner deletes offers with aal2" on public.site_offers
  for delete to authenticated
  using ((select private.is_punjab_csc_owner()));

-- Manual refunds
drop policy if exists "owner reads refund records with aal2" on public.manual_refunds;
create policy "owner reads refund records with aal2" on public.manual_refunds
  for select to authenticated
  using ((select private.is_punjab_csc_owner()));
drop policy if exists "owner creates refund records with aal2" on public.manual_refunds;
create policy "owner creates refund records with aal2" on public.manual_refunds
  for insert to authenticated
  with check ((select private.is_punjab_csc_owner()) and created_by = (select auth.uid()));
drop policy if exists "owner updates refund records with aal2" on public.manual_refunds;
create policy "owner updates refund records with aal2" on public.manual_refunds
  for update to authenticated
  using ((select private.is_punjab_csc_owner()))
  with check ((select private.is_punjab_csc_owner()) and created_by = (select auth.uid()));

-- Activity log
drop policy if exists "owner reads customer activity with aal2" on public.customer_activity;
create policy "owner reads customer activity with aal2" on public.customer_activity
  for select to authenticated
  using ((select private.is_punjab_csc_owner()));

-- Customer profiles: retain each customer's own-row access.
drop policy if exists "customers and verified owner read limited profiles" on public.customer_profiles;
drop policy if exists "owner reads profiles with aal2" on public.customer_profiles;
drop policy if exists "customer reads own profile" on public.customer_profiles;
create policy "customers and verified owner read limited profiles" on public.customer_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_punjab_csc_owner()));

-- Applications, document metadata, and private storage downloads.
drop policy if exists "owner reads applications with aal2" on public.customer_applications;
create policy "owner reads applications with aal2" on public.customer_applications
  for select to authenticated
  using ((select private.is_punjab_csc_owner()));
drop policy if exists "owner updates application status with aal2" on public.customer_applications;
create policy "owner updates application status with aal2" on public.customer_applications
  for update to authenticated
  using ((select private.is_punjab_csc_owner()))
  with check ((select private.is_punjab_csc_owner()));
drop policy if exists "owner reads document metadata with aal2" on public.customer_documents;
create policy "owner reads document metadata with aal2" on public.customer_documents
  for select to authenticated
  using ((select private.is_punjab_csc_owner()));
drop policy if exists "owner reads private files with aal2" on storage.objects;
create policy "owner reads private files with aal2" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deep-csc-private-documents'
    and (select private.is_punjab_csc_owner())
  );

commit;
