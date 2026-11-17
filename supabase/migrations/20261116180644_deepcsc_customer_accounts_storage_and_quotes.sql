-- Deep CSC customer data. Every table is forced through row-level security.
create table public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null constraint customer_profiles_full_name_check check (char_length(full_name) between 1 and 120),
  mobile text not null constraint customer_profiles_mobile_check check (mobile ~ '^[6-9][0-9]{9}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  service text not null constraint customer_applications_service_check check (char_length(service) between 1 and 180),
  applicant_name text not null constraint customer_applications_applicant_name_check check (char_length(applicant_name) between 1 and 120),
  mobile text not null constraint customer_applications_mobile_check check (mobile ~ '^[6-9][0-9]{9}$'),
  contact_email text,
  notes text not null default '' constraint customer_applications_notes_check check (char_length(notes) <= 5000),
  status text not null default 'new' constraint customer_applications_status_check check (status in ('new','in_review','waiting_customer','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.customer_applications(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null unique,
  original_name text not null constraint customer_documents_original_name_check check (char_length(original_name) between 1 and 180),
  media_type text not null constraint customer_documents_media_type_check check (media_type in ('image/jpeg','image/png','application/pdf')),
  file_size_bytes integer not null constraint customer_documents_file_size_bytes_check check (file_size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  constraint customer_documents_path_owner check (split_part(object_path,'/',1) = owner_id::text)
);

create table public.payment_quotes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.customer_applications(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  service text not null constraint payment_quotes_service_check check (char_length(service) between 1 and 180),
  amount_paise bigint not null constraint payment_quotes_amount_paise_check check (amount_paise > 0),
  currency text not null default 'INR' constraint payment_quotes_currency_check check (currency = 'INR'),
  status text not null default 'approved' constraint payment_quotes_status_check check (status in ('approved','paid','expired','cancelled')),
  expires_at timestamptz not null,
  gateway_order_id text unique,
  gateway_payment_id text unique,
  created_at timestamptz not null default now()
);

create index customer_applications_owner_created_idx on public.customer_applications (owner_id, created_at desc);
create index customer_documents_app_idx on public.customer_documents (application_id, created_at);

alter table public.customer_profiles enable row level security;
alter table public.customer_profiles force row level security;
alter table public.customer_applications enable row level security;
alter table public.customer_applications force row level security;
alter table public.customer_documents enable row level security;
alter table public.customer_documents force row level security;
alter table public.payment_quotes enable row level security;
alter table public.payment_quotes force row level security;

revoke all on public.customer_profiles, public.customer_applications, public.customer_documents, public.payment_quotes from anon, authenticated;
grant select, insert, update on public.customer_profiles to authenticated;
grant select, insert on public.customer_applications to authenticated;
grant select, insert, delete on public.customer_documents to authenticated;
grant select on public.payment_quotes to authenticated;

create policy "customer reads own profile" on public.customer_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "customer creates own profile" on public.customer_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "customer updates own profile" on public.customer_profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "customer reads own applications" on public.customer_applications
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "customer creates own applications" on public.customer_applications
  for insert to authenticated with check ((select auth.uid()) = owner_id and status = 'new');

create policy "customer reads own document records" on public.customer_documents
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "customer creates document record for own application" on public.customer_documents
  for insert to authenticated with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.customer_applications a
      where a.id = application_id and a.owner_id = (select auth.uid())
    )
  );
create policy "customer deletes own document record" on public.customer_documents
  for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "customer reads own quotes" on public.payment_quotes
  for select to authenticated using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deep-csc-private-documents', 'deep-csc-private-documents', false, 10485760, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "customer uploads into own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'deep-csc-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
  );
create policy "customer reads own private documents" on storage.objects
  for select to authenticated using (
    bucket_id = 'deep-csc-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
  );
create policy "customer deletes own private documents" on storage.objects
  for delete to authenticated using (
    bucket_id = 'deep-csc-private-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and owner_id = (select auth.uid())::text
  );
