-- Extend the private owner workspace with scheduled public offers, audit events,
-- and manually recorded refunds. Payment amounts are not fetched from a gateway.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.site_offers (
  id uuid primary key default gen_random_uuid(),
  title text not null constraint site_offers_title_check check (char_length(title) between 1 and 100),
  message text not null constraint site_offers_message_check check (char_length(message) between 1 and 280),
  button_label text not null default 'Ask on WhatsApp' constraint site_offers_button_label_check check (char_length(button_label) between 1 and 36),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_offers_valid_window check (ends_at > starts_at)
);

create index site_offers_live_window_idx on public.site_offers (starts_at, ends_at) where active;

create table public.manual_refunds (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.customer_applications(id) on delete set null,
  amount_paise bigint not null constraint manual_refunds_amount_check check (amount_paise > 0),
  method text not null constraint manual_refunds_method_check check (method in ('upi','cash','bank_transfer','other')),
  status text not null default 'pending' constraint manual_refunds_status_check check (status in ('pending','approved','processed','declined')),
  reason text not null constraint manual_refunds_reason_check check (char_length(reason) between 1 and 500),
  payment_reference text constraint manual_refunds_reference_check check (payment_reference is null or char_length(payment_reference) <= 160),
  owner_notes text not null default '' constraint manual_refunds_notes_check check (char_length(owner_notes) <= 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index manual_refunds_created_idx on public.manual_refunds (created_at desc);
create index manual_refunds_application_idx on public.manual_refunds (application_id, created_at desc);

create table public.customer_activity (
  id bigint generated always as identity primary key,
  event_type text not null constraint customer_activity_event_type_check check (event_type in (
    'customer_profile_created','application_created','application_status_changed',
    'offer_created','offer_updated','offer_deleted','refund_record_created','refund_status_changed'
  )),
  actor_id uuid references auth.users(id) on delete set null,
  application_id uuid references public.customer_applications(id) on delete set null,
  offer_id uuid references public.site_offers(id) on delete set null,
  refund_id uuid references public.manual_refunds(id) on delete set null,
  details jsonb not null default '{}'::jsonb constraint customer_activity_details_object check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index customer_activity_created_idx on public.customer_activity (created_at desc);

alter table public.site_offers enable row level security;
alter table public.site_offers force row level security;
alter table public.manual_refunds enable row level security;
alter table public.manual_refunds force row level security;
alter table public.customer_activity enable row level security;
alter table public.customer_activity force row level security;

revoke all on public.site_offers, public.manual_refunds, public.customer_activity from anon, authenticated;
grant select on public.site_offers to anon, authenticated;
grant insert, update, delete on public.site_offers to authenticated;
grant select, insert, update on public.manual_refunds to authenticated;
grant select on public.customer_activity to authenticated;
revoke all on sequence public.customer_activity_id_seq from anon, authenticated;

create policy "public reads current active offers" on public.site_offers
  for select to anon, authenticated
  using (active and starts_at <= now() and ends_at > now());
create policy "owner reads offers with aal2" on public.site_offers
  for select to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );
create policy "owner creates offers with aal2" on public.site_offers
  for insert to authenticated
  with check (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );
create policy "owner updates offers with aal2" on public.site_offers
  for update to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );
create policy "owner deletes offers with aal2" on public.site_offers
  for delete to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

create policy "owner reads refund records with aal2" on public.manual_refunds
  for select to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );
create policy "owner creates refund records with aal2" on public.manual_refunds
  for insert to authenticated
  with check (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );
create policy "owner updates refund records with aal2" on public.manual_refunds
  for update to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and created_by = (select auth.uid())
  );

create policy "owner reads customer activity with aal2" on public.customer_activity
  for select to authenticated
  using (
    lower((select auth.jwt() ->> 'email')) = 'deepcsc06@gmail.com'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

-- Give the authenticated owner only the profile read needed for new-customer counts.
create index customer_profiles_created_idx on public.customer_profiles (created_at desc);

create function public.owner_customer_count_since(p_since timestamptz)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if lower(coalesce((select auth.jwt() ->> 'email'), '')) <> 'deepcsc06@gmail.com'
     or coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2'
     or coalesce((select auth.role()), '') <> 'authenticated' then
    raise insufficient_privilege using message = 'Owner authenticator verification is required.';
  end if;

  return (select pg_catalog.count(*) from public.customer_profiles where created_at >= p_since);
end;
$$;

revoke all on function public.owner_customer_count_since(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.owner_customer_count_since(timestamptz) to authenticated;

create function private.log_deepcsc_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'customer_profiles' and tg_op = 'INSERT' then
    insert into public.customer_activity (event_type, actor_id, details)
    values ('customer_profile_created', new.user_id, '{}'::jsonb);
  elsif tg_table_name = 'customer_applications' and tg_op = 'INSERT' then
    insert into public.customer_activity (event_type, actor_id, application_id, details)
    values ('application_created', auth.uid(), new.id, pg_catalog.jsonb_build_object('service', new.service));
  elsif tg_table_name = 'customer_applications' and tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.customer_activity (event_type, actor_id, application_id, details)
    values ('application_status_changed', auth.uid(), new.id, pg_catalog.jsonb_build_object('from', old.status, 'to', new.status));
  elsif tg_table_name = 'site_offers' and tg_op = 'INSERT' then
    insert into public.customer_activity (event_type, actor_id, offer_id, details)
    values ('offer_created', auth.uid(), new.id, pg_catalog.jsonb_build_object('title', new.title));
  elsif tg_table_name = 'site_offers' and tg_op = 'UPDATE' then
    insert into public.customer_activity (event_type, actor_id, offer_id, details)
    values ('offer_updated', auth.uid(), new.id, pg_catalog.jsonb_build_object('title', new.title, 'active', new.active));
  elsif tg_table_name = 'site_offers' and tg_op = 'DELETE' then
    insert into public.customer_activity (event_type, actor_id, details)
    values ('offer_deleted', auth.uid(), pg_catalog.jsonb_build_object('title', old.title));
  elsif tg_table_name = 'manual_refunds' and tg_op = 'INSERT' then
    insert into public.customer_activity (event_type, actor_id, application_id, refund_id, details)
    values ('refund_record_created', auth.uid(), new.application_id, new.id, pg_catalog.jsonb_build_object('status', new.status, 'amount_paise', new.amount_paise));
  elsif tg_table_name = 'manual_refunds' and tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.customer_activity (event_type, actor_id, application_id, refund_id, details)
    values ('refund_status_changed', auth.uid(), new.application_id, new.id, pg_catalog.jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.log_deepcsc_activity() from public, anon, authenticated, service_role;

create trigger customer_profiles_activity_after_insert
  after insert on public.customer_profiles
  for each row execute function private.log_deepcsc_activity();
create trigger customer_applications_activity_after_insert
  after insert on public.customer_applications
  for each row execute function private.log_deepcsc_activity();
create trigger customer_applications_activity_after_status_update
  after update of status on public.customer_applications
  for each row when (old.status is distinct from new.status)
  execute function private.log_deepcsc_activity();
create trigger site_offers_activity_after_change
  after insert or update or delete on public.site_offers
  for each row execute function private.log_deepcsc_activity();
create trigger manual_refunds_activity_after_insert
  after insert on public.manual_refunds
  for each row execute function private.log_deepcsc_activity();
create trigger manual_refunds_activity_after_status_update
  after update of status on public.manual_refunds
  for each row when (old.status is distinct from new.status)
  execute function private.log_deepcsc_activity();
