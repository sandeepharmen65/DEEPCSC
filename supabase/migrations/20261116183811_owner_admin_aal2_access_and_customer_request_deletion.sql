-- Owner access is reserved for the verified Deep CSC business email and an AAL2 session.
-- Customers remain restricted to their own records. Customers may erase a request and its files.
create policy "owner reads applications with aal2"
  on public.customer_applications
  for select
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

create policy "owner updates application status with aal2"
  on public.customer_applications
  for update
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

create policy "customer deletes own application"
  on public.customer_applications
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owner reads document metadata with aal2"
  on public.customer_documents
  for select
  to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

create policy "owner reads private files with aal2"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'deep-csc-private-documents'
    and lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

-- The browser may update only the status field, after the owner-only RLS policy succeeds.
revoke update, truncate, references, trigger on public.customer_applications from anon, authenticated;
grant update (status) on public.customer_applications to authenticated;
revoke update, truncate, references, trigger on public.customer_documents from anon, authenticated;
