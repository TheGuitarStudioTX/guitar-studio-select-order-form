-- ============================================================
-- Guitar Studio Select — Order Management Schema
-- Target: Supabase / PostgreSQL
-- How to use: paste into the Supabase SQL Editor and Run.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES — one row per team member (Will, Courtney, Jon),
--    linked to the Supabase auth user.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  created_at  timestamptz default now()
);

-- Auto-create a profile row whenever a new auth user is invited.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2. ORDERS — one row per saved or submitted order.
-- ------------------------------------------------------------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  label         text,                                  -- optional, e.g. "June restock"
  status        text not null default 'draft',         -- draft | submitted | ordered | received
  notes         text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  submitted_at  timestamptz
);

-- ------------------------------------------------------------
-- 3. ORDER_ITEMS — line items. Prices are SNAPSHOTTED at order
--    time so historical orders stay accurate when costs change.
-- ------------------------------------------------------------
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  brand        text not null,
  sku          text not null,
  description  text,
  qty          integer not null check (qty > 0),
  dealer_cost  numeric(10,2),       -- unit dealer cost at time of order
  retail       numeric(10,2),       -- unit retail at time of order
  line_total   numeric(10,2) generated always as (qty * coalesce(dealer_cost, 0)) stored
);

-- ------------------------------------------------------------
-- 4. ORDER_EVENTS — history / audit trail for accountability
--    and trend analysis.
-- ------------------------------------------------------------
create table if not exists public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete cascade,
  user_id     uuid references public.profiles(id),
  action      text not null,        -- created | updated | submitted | status_change | deleted
  detail      text,
  created_at  timestamptz default now()
);

-- ------------------------------------------------------------
-- Indexes for common history / trend queries
-- ------------------------------------------------------------
create index if not exists idx_order_items_sku     on public.order_items(sku);
create index if not exists idx_order_items_brand   on public.order_items(brand);
create index if not exists idx_order_items_order   on public.order_items(order_id);
create index if not exists idx_orders_created_at   on public.orders(created_at);
create index if not exists idx_orders_status       on public.orders(status);

-- ------------------------------------------------------------
-- Keep updated_at current on every order edit
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_touch on public.orders;
create trigger trg_orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- The three of you are all trusted internal users, so any signed-in
-- user may read and write every order. Security comes from the login
-- itself: keep public sign-up DISABLED in Supabase and invite Will,
-- Courtney, and Jon manually from the Auth dashboard.
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.order_events enable row level security;

-- profiles: everyone signed in can read; you can edit only your own
drop policy if exists "auth read profiles"  on public.profiles;
drop policy if exists "self update profile" on public.profiles;
create policy "auth read profiles"  on public.profiles for select
  using (auth.role() = 'authenticated');
create policy "self update profile" on public.profiles for update
  using (auth.uid() = id);

-- orders / items / events: full access for any authenticated user
drop policy if exists "auth all orders"       on public.orders;
drop policy if exists "auth all order_items"  on public.order_items;
drop policy if exists "auth all order_events" on public.order_events;
create policy "auth all orders" on public.orders for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all order_items" on public.order_items for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth all order_events" on public.order_events for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- OPTIONAL: a ready-made view for trend reporting
-- (units & spend per brand per month). Query it directly later.
-- ============================================================
create or replace view public.v_monthly_brand_spend as
select
  date_trunc('month', o.created_at)::date as month,
  oi.brand,
  sum(oi.qty)        as units,
  sum(oi.line_total) as dealer_spend
from public.orders o
join public.order_items oi on oi.order_id = o.id
where o.status in ('submitted','ordered','received')
group by 1, 2
order by 1 desc, 2;
