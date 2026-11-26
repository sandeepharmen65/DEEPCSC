create table if not exists public.website_alert_dispatches (
  application_id uuid primary key references public.customer_applications(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  delivery_status text not null check (delivery_status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.website_alert_dispatches enable row level security;
revoke all on table public.website_alert_dispatches from public, anon, authenticated;
grant all on table public.website_alert_dispatches to service_role;

comment on table public.website_alert_dispatches is
  'Private deduplication ledger for generic WhatsApp owner alerts. Contains request IDs only; customer data and files are never copied here.';
