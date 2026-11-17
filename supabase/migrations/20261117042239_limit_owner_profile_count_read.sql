-- Keep the dashboard's new-account count limited to profile IDs and timestamps.
-- No customer name or mobile number is exposed by this owner count query.

drop function if exists public.owner_customer_count_since(timestamptz);

revoke select on public.customer_profiles from authenticated;
grant select (user_id, created_at) on public.customer_profiles to authenticated;

create policy "owner reads profiles with aal2" on public.customer_profiles
  for select to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );
