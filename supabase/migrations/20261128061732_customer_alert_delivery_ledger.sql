begin;

-- Deduplicate the single generic owner alert sent when a customer account is
-- created. The ledger stores only the Auth user ID and delivery state, never
-- profile fields, application details, contact information, or document data.
create table if not exists public.website_customer_alert_dispatches (
  user_id uuid primary key references auth.users(id) on delete cascade,
  delivery_status text not null
    constraint website_customer_alert_dispatches_status_check
    check (delivery_status in ('sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.website_customer_alert_dispatches enable row level security;
alter table public.website_customer_alert_dispatches force row level security;
revoke all on table public.website_customer_alert_dispatches from public, anon, authenticated;
grant all on table public.website_customer_alert_dispatches to service_role;

comment on table public.website_customer_alert_dispatches is
  'Private deduplication ledger for generic new-customer WhatsApp alerts. Stores only user ID and delivery state; no customer PII, request details, or document data.';

commit;
