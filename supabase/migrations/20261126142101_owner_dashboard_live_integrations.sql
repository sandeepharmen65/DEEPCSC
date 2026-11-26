-- Persistent owner-only operations data for the Punjab CSC dashboard.
-- Payment entries are manually recorded; this does not connect a payment gateway.

create table public.owner_center_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb
    constraint owner_center_settings_object check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.owner_payment_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.customer_applications(id) on delete set null,
  service_name text not null constraint owner_payment_records_service_check check (char_length(service_name) between 1 and 180),
  government_fee_paise bigint not null default 0 constraint owner_payment_records_gov_check check (government_fee_paise >= 0),
  service_charge_paise bigint not null default 0 constraint owner_payment_records_charge_check check (service_charge_paise >= 0),
  total_amount_paise bigint generated always as (government_fee_paise + service_charge_paise) stored,
  status text not null default 'due' constraint owner_payment_records_status_check check (status in ('due','paid','cancelled')),
  method text constraint owner_payment_records_method_check check (method is null or method in ('upi','cash','bank_transfer','card','other')),
  payment_reference text constraint owner_payment_records_reference_check check (payment_reference is null or char_length(payment_reference) <= 160),
  notes text not null default '' constraint owner_payment_records_notes_check check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint owner_payment_records_positive_total check (total_amount_paise > 0),
  constraint owner_payment_records_paid_fields check (
    (status = 'paid' and method is not null and paid_at is not null)
    or (status <> 'paid' and paid_at is null)
  )
);

create index owner_payment_records_owner_status_created_idx
  on public.owner_payment_records (owner_id, status, created_at desc);
create index owner_payment_records_owner_created_idx
  on public.owner_payment_records (owner_id, created_at desc);
create index owner_payment_records_application_idx
  on public.owner_payment_records (application_id, created_at desc);

create table public.owner_business_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category text not null constraint owner_business_expenses_category_check check (char_length(category) between 1 and 80),
  amount_paise bigint not null constraint owner_business_expenses_amount_check check (amount_paise > 0),
  spent_on date not null default current_date,
  notes text not null default '' constraint owner_business_expenses_notes_check check (char_length(notes) <= 500),
  created_at timestamptz not null default now()
);

create index owner_business_expenses_owner_date_idx
  on public.owner_business_expenses (owner_id, spent_on desc);

create table public.owner_inventory_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  item_name text not null constraint owner_inventory_items_name_check check (char_length(item_name) between 1 and 120),
  quantity numeric(12,2) not null default 0 constraint owner_inventory_items_quantity_check check (quantity >= 0),
  unit text not null default 'pieces' constraint owner_inventory_items_unit_check check (char_length(unit) between 1 and 24),
  low_stock_at numeric(12,2) not null default 1 constraint owner_inventory_items_threshold_check check (low_stock_at >= 0),
  unit_cost_paise bigint constraint owner_inventory_items_cost_check check (unit_cost_paise is null or unit_cost_paise >= 0),
  updated_at timestamptz not null default now(),
  constraint owner_inventory_items_owner_name_unique unique (owner_id, item_name)
);

create index owner_inventory_items_owner_quantity_idx
  on public.owner_inventory_items (owner_id, quantity, low_stock_at);

create table public.owner_reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  reminder_type text not null default 'other' constraint owner_reminders_type_check check (reminder_type in ('job','scholarship','tax','insurance','puc','licence','followup','other')),
  title text not null constraint owner_reminders_title_check check (char_length(title) between 1 and 160),
  due_on date not null,
  official_url text not null default '' constraint owner_reminders_url_check check (official_url = '' or official_url ~ '^https://'),
  notes text not null default '' constraint owner_reminders_notes_check check (char_length(notes) <= 600),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index owner_reminders_owner_due_idx
  on public.owner_reminders (owner_id, due_on) where not completed;

create table public.owner_pc_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  computer_label text not null constraint owner_pc_sessions_label_check check (char_length(computer_label) between 1 and 40),
  hourly_rate_paise bigint not null default 0 constraint owner_pc_sessions_rate_check check (hourly_rate_paise >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  total_amount_paise bigint not null default 0 constraint owner_pc_sessions_amount_check check (total_amount_paise >= 0),
  status text not null default 'running' constraint owner_pc_sessions_status_check check (status in ('running','ended','cancelled')),
  created_at timestamptz not null default now(),
  constraint owner_pc_sessions_time_status_check check (
    (status = 'running' and ended_at is null)
    or (status <> 'running' and ended_at is not null and ended_at >= started_at)
  )
);

create index owner_pc_sessions_owner_status_idx
  on public.owner_pc_sessions (owner_id, status, started_at desc);
create index owner_pc_sessions_owner_started_idx
  on public.owner_pc_sessions (owner_id, started_at desc);
create unique index owner_pc_sessions_one_running_per_label_idx
  on public.owner_pc_sessions (owner_id, lower(computer_label)) where status = 'running';

create table public.owner_dashboard_activity (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null constraint owner_dashboard_activity_type_check check (char_length(event_type) between 1 and 80),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb constraint owner_dashboard_activity_object check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index owner_dashboard_activity_owner_created_idx
  on public.owner_dashboard_activity (owner_id, created_at desc);

alter table public.owner_center_settings enable row level security;
alter table public.owner_center_settings force row level security;
alter table public.owner_payment_records enable row level security;
alter table public.owner_payment_records force row level security;
alter table public.owner_business_expenses enable row level security;
alter table public.owner_business_expenses force row level security;
alter table public.owner_inventory_items enable row level security;
alter table public.owner_inventory_items force row level security;
alter table public.owner_reminders enable row level security;
alter table public.owner_reminders force row level security;
alter table public.owner_pc_sessions enable row level security;
alter table public.owner_pc_sessions force row level security;
alter table public.owner_dashboard_activity enable row level security;
alter table public.owner_dashboard_activity force row level security;

revoke all on public.owner_center_settings, public.owner_payment_records,
  public.owner_business_expenses, public.owner_inventory_items, public.owner_reminders,
  public.owner_pc_sessions, public.owner_dashboard_activity from anon, authenticated;
grant select, insert, update on public.owner_center_settings to authenticated;
grant select, insert, update on public.owner_payment_records to authenticated;
grant select, insert, update, delete on public.owner_business_expenses, public.owner_inventory_items,
  public.owner_reminders, public.owner_pc_sessions to authenticated;
grant select, insert on public.owner_dashboard_activity to authenticated;
revoke all on sequence public.owner_dashboard_activity_id_seq from public, anon, authenticated;
grant usage, select on sequence public.owner_dashboard_activity_id_seq to authenticated;

create policy "verified owner manages center settings" on public.owner_center_settings
  for all to authenticated
  using ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()))
  with check ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()));
create policy "verified owner manages payment records" on public.owner_payment_records
  for all to authenticated
  using ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()))
  with check ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()));
create policy "verified owner manages expenses" on public.owner_business_expenses
  for all to authenticated
  using ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()))
  with check ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()));
create policy "verified owner manages inventory" on public.owner_inventory_items
  for all to authenticated
  using ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()))
  with check ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()));
create policy "verified owner manages reminders" on public.owner_reminders
  for all to authenticated
  using ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()))
  with check ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()));
create policy "verified owner manages PC sessions" on public.owner_pc_sessions
  for all to authenticated
  using ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()))
  with check ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()));
create policy "verified owner reads dashboard activity" on public.owner_dashboard_activity
  for select to authenticated
  using ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()));
create policy "verified owner records dashboard activity" on public.owner_dashboard_activity
  for insert to authenticated
  with check ((select private.is_punjab_csc_owner()) and owner_id = (select auth.uid()) and actor_id = (select auth.uid()));

