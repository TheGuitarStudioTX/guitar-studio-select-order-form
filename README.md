# Guitar Studio Select — Order Management

A hosted, multi-user replacement for the single-file `order_form_v9.html`. The
catalog (~2,200 products across 18 brands / 12 suppliers) lives in Supabase;
the order form is generated from it; orders are shared, submitted, and tracked.

- **Stack:** Supabase (Postgres + Auth), static front end deployed to Netlify.
- **Login:** invite-only (Will, Courtney, Jon). Public sign-up disabled.
- **Front end:** vanilla ES modules + Supabase JS (from CDN) — no build step.

---

## Project layout

```
order_form_v9.html            legacy source (parsed once to seed the catalog)
gcs_supabase_schema.sql        STEP 1 — orders / order_items / profiles / events (provided)
db/
  02_catalog_schema.sql        STEP 2 — suppliers / brands / products, RLS, import RPC
  03_seed_catalog.sql          STEP 3 — auto-generated catalog seed (from the HTML)
public/                        the deployed site (Netlify publish dir)
  index.html  styles.css  config.js
  js/  supabase, auth, catalog, orders, history, admin, app, util
scripts/
  parse_catalog.pl             regenerates db/03_seed_catalog.sql from the HTML
  gen-config.mjs               Netlify build step: env vars -> config.js
  serve.pl                     tiny static server for local dev
netlify.toml
```

---

## 1. Set up Supabase

1. Create a project at <https://supabase.com>.
2. **SQL Editor → New query**, then run, in order:
   1. `gcs_supabase_schema.sql`
   2. `db/02_catalog_schema.sql`
   3. `db/03_seed_catalog.sql`
   Each is safe to re-run.
3. **Authentication → Providers → Email:** enable Email. Turn **OFF**
   “Allow new users to sign up” (keeps it invite-only). Magic-link / OTP can stay on.
4. **Authentication → Users → Add user / Invite** — invite the three accounts:
   Will, Courtney, Jon. A `profiles` row is created automatically for each.
   - Optional: set someone as admin with
     `update public.profiles set is_admin = true where email = 'you@example.com';`
     (The Admin screen is visible to all signed-in users by default — see the
     commented “admin-only” policies in `02_catalog_schema.sql` to lock editing.)
5. **Project Settings → API:** copy the **Project URL** and the **anon public** key.

---

## 2. Run locally

The site is static. Point any static server at `public/`, e.g. the included one:

```bash
perl scripts/serve.pl 8787       # then open http://127.0.0.1:8787
```

Before it can talk to Supabase, edit `public/config.js` and paste your URL +
anon key (the anon key is public by design; data is protected by RLS + login).

---

## 3. Deploy to Netlify

1. Push this folder to a Git repo and “Add new site → Import an existing project”
   in Netlify (or `netlify deploy` with the CLI).
2. Netlify reads `netlify.toml`: publish dir `public`, build `node scripts/gen-config.mjs`.
3. **Site settings → Environment variables**, add:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_ANON_KEY` = your anon public key
   The build injects them into `config.js`.
4. In Supabase **Authentication → URL Configuration**, add your Netlify URL to
   **Site URL** / **Redirect URLs** so magic links and password resets return there.
5. Deploy.

---

## Features

- **Order form** generated from the catalog tables — same look, collapsible brand
  sections, search, and all filters (category, Normal/Hard/Carbon/Nylon tension,
  Full/Half/Singles pack, supports/stands/care/humidity, literature, ordered-only).
- **Shared cart** — quantities are saved to a single shared *draft* order in
  Supabase (replacing `localStorage`) and sync live across the three users.
- **Submit order** — finalizes the draft (status `submitted`), snapshotting each
  line's dealer/retail price, then opens a fresh draft. (`order_events` logs it.)
- **Order History** — filter by date / brand / SKU / status, expand any order,
  advance status (submitted → ordered → received), and a **monthly spend trend**
  rollup from the `v_monthly_brand_spend` view.
- **Admin**
  - Add / edit **brands & suppliers** and **products** (prices, description, active).
  - **Dealer price-list import**: upload an `.xlsx`/`.xls`/`.csv`, map columns,
    preview, and import. New distributors (e.g. **Augustine, Alfred**) are created
    automatically — no code changes. Backed by the `import_catalog(jsonb)` RPC.

---

## Regenerating the catalog from the HTML

If you ever need to re-seed from the legacy form:

```bash
perl scripts/parse_catalog.pl order_form_v9.html db/03_seed_catalog.sql
```

Re-running the seed upserts by natural key (`slug`, `brand`+`sku`) so it won't
duplicate rows.

---

## Notes / decisions

- **Trust model:** mirrors the provided schema — any signed-in user can read &
  write orders and catalog. Security is the invite-only login. Tighten later with
  the `is_admin` flag + the commented RLS policies.
- **SKU keying:** order lines are unique on `(order_id, brand, sku)` because a
  handful of SKUs (some Hal Leonard titles) appear under more than one brand.
- **No build tooling required** locally; Netlify only runs Node for the one-line
  config-injection step.
```
