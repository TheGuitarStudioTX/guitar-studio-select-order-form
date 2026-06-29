-- ============================================================
-- Guitar Studio Select — Catalog Schema (suppliers / brands / products)
-- Target: Supabase / PostgreSQL
-- Run order:
--   1. gcs_supabase_schema.sql      (orders/items/profiles/events — provided)
--   2. db/02_catalog_schema.sql     (this file)
--   3. db/03_seed_catalog.sql       (auto-generated from order_form_v9.html)
-- Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- Optional admin flag (the Admin screen is visible to any signed-in
-- user by default, matching the trust model in the orders schema;
-- flip this + the commented policies below to lock editing down).
-- ------------------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- One line per (brand, SKU) within an order, so the shared cart can upsert
-- by (order_id, brand, sku). Brand is part of the key because a few SKUs
-- (e.g. some Hal Leonard titles) appear under more than one brand.
create unique index if not exists uq_order_items_order_brand_sku
  on public.order_items(order_id, brand, sku);

-- ------------------------------------------------------------
-- SUPPLIERS — the distributor / ordering contact a brand ships from.
-- New distributors (Augustine, Alfred, …) are just new rows.
-- ------------------------------------------------------------
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  contact     text,
  email       text,
  cc          text,
  address     text,
  terms       text,
  created_at  timestamptz default now()
);

-- ------------------------------------------------------------
-- BRANDS — a catalog grouping rendered as a collapsible section.
-- ------------------------------------------------------------
create table if not exists public.brands (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  brand_type   text,                                   -- subtitle, e.g. "Classical Guitar Strings"
  category     text not null default 'accessories'
                 check (category in ('strings','accessories','literature')),
  subcategory  text,                                   -- finer bucket: supports/stands/care/instructional/scores…
  supplier_id  uuid references public.suppliers(id) on delete set null,
  moq_amount   numeric(10,2) default 0,
  moq_label    text,
  sort_order   int default 0,
  active        boolean not null default true,
  created_at    timestamptz default now()
);
create index if not exists idx_brands_category on public.brands(category);

-- ------------------------------------------------------------
-- PRODUCTS — one row per orderable SKU.
-- ------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brands(id) on delete cascade,
  sku             text not null,
  description     text not null,
  retail          numeric(10,2),
  dealer_cost     numeric(10,2),
  pack_type       text check (pack_type in ('full','half','single')),  -- null for non-string items
  tension         text,                                                -- normal | hard | extra hard | light | flamenco | …
  group_label     text,                                                -- section heading (cat-row)
  subgroup_label  text,                                                -- sub-heading / composer (sub-cat-row)
  sort_order      int default 0,
  active          boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (brand_id, sku)
);
create index if not exists idx_products_brand    on public.products(brand_id);
create index if not exists idx_products_sku       on public.products(sku);
create index if not exists idx_products_pack      on public.products(pack_type);

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Convenience view: the whole catalog, flattened, ready for the UI.
-- security_invoker = true is CRITICAL: without it the view runs as its
-- owner and BYPASSES the RLS on products/brands/suppliers, leaking dealer
-- costs to anyone with the public anon key. With it, the view respects the
-- caller's RLS (authenticated only).
-- ------------------------------------------------------------
create or replace view public.v_catalog with (security_invoker = true) as
select
  p.id, p.sku, p.description, p.retail, p.dealer_cost, p.pack_type, p.tension,
  p.group_label, p.subgroup_label, p.sort_order, p.active,
  b.slug as brand_slug, b.name as brand_name, b.brand_type, b.category, b.subcategory,
  b.moq_amount, b.moq_label, b.sort_order as brand_sort,
  s.slug as supplier_slug, s.name as supplier_name, s.contact as supplier_contact,
  s.email as supplier_email, s.cc as supplier_cc, s.address as supplier_address, s.terms as supplier_terms
from public.products p
join public.brands b   on b.id = p.brand_id
left join public.suppliers s on s.id = b.supplier_id
where b.active;

-- The monthly trend view (defined in the orders schema) has the same risk —
-- make it respect the caller's RLS too, so spend data isn't readable by anon.
alter view if exists public.v_monthly_brand_spend set (security_invoker = on);

-- ============================================================
-- ROW LEVEL SECURITY
-- Mirrors the orders schema: any signed-in user may read & write.
-- (Security comes from invite-only login.)
-- ============================================================
alter table public.suppliers enable row level security;
alter table public.brands    enable row level security;
alter table public.products  enable row level security;

drop policy if exists "auth read suppliers"  on public.suppliers;
drop policy if exists "auth write suppliers" on public.suppliers;
drop policy if exists "auth read brands"     on public.brands;
drop policy if exists "auth write brands"    on public.brands;
drop policy if exists "auth read products"   on public.products;
drop policy if exists "auth write products"  on public.products;

create policy "auth read suppliers"  on public.suppliers for select using (auth.role() = 'authenticated');
create policy "auth write suppliers" on public.suppliers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth read brands"     on public.brands for select using (auth.role() = 'authenticated');
create policy "auth write brands"    on public.brands for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth read products"   on public.products for select using (auth.role() = 'authenticated');
create policy "auth write products"  on public.products for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- To restrict editing to admins later, replace the "write" policies above with, e.g.:
--   using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin))

-- ============================================================
-- IMPORT RPC — bulk upsert a dealer price list.
-- Accepts a JSON array of rows; auto-creates brands (and so new
-- distributors) on the fly. Each row: { brand_slug, sku, description,
-- retail, dealer_cost, pack_type, tension, group_label, subgroup_label,
-- brand_name?, category?, subcategory? }.
-- Returns { brands_created, products_upserted }.
-- ============================================================
create or replace function public.import_catalog(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_brand uuid;
  n_products int := 0;
  n_brands int := 0;
  v_cat text;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'not authorized';
  end if;

  for r in select value from jsonb_array_elements(p_rows)
  loop
    if coalesce(r->>'sku','') = '' then continue; end if;

    select id into v_brand from public.brands where slug = lower(r->>'brand_slug');
    if v_brand is null then
      v_cat := coalesce(nullif(r->>'category',''), 'accessories');
      if v_cat not in ('strings','accessories','literature') then v_cat := 'accessories'; end if;
      insert into public.brands (slug, name, category, subcategory)
      values (lower(r->>'brand_slug'),
              coalesce(nullif(r->>'brand_name',''), initcap(replace(r->>'brand_slug','_',' '))),
              v_cat,
              nullif(r->>'subcategory',''))
      returning id into v_brand;
      n_brands := n_brands + 1;
    end if;

    insert into public.products
      (brand_id, sku, description, retail, dealer_cost, pack_type, tension, group_label, subgroup_label)
    values
      (v_brand, r->>'sku', coalesce(nullif(r->>'description',''), r->>'sku'),
       nullif(r->>'retail','')::numeric, nullif(r->>'dealer_cost','')::numeric,
       nullif(r->>'pack_type',''), nullif(r->>'tension',''),
       nullif(r->>'group_label',''), nullif(r->>'subgroup_label',''))
    on conflict (brand_id, sku) do update set
      description = excluded.description,
      retail      = coalesce(excluded.retail, products.retail),
      dealer_cost = coalesce(excluded.dealer_cost, products.dealer_cost),
      pack_type   = coalesce(excluded.pack_type, products.pack_type),
      tension     = coalesce(excluded.tension, products.tension),
      group_label = coalesce(excluded.group_label, products.group_label),
      subgroup_label = coalesce(excluded.subgroup_label, products.subgroup_label),
      active = true;
    n_products := n_products + 1;
  end loop;

  return jsonb_build_object('brands_created', n_brands, 'products_upserted', n_products);
end;
$$;

grant execute on function public.import_catalog(jsonb) to authenticated;
