// Admin: manage suppliers, brands and products, plus a dealer price-list
// spreadsheet import so new distributors can be onboarded without code.
import { supabase } from "./supabase.js";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { fmt, esc, toast, el } from "./util.js";

let suppliers = [], brands = [];

export async function renderAdmin(root) {
  root.innerHTML = `
    <div class="view-pad">
      <h2 class="view-title">Admin</h2>
      <p class="view-sub">Edit the catalog and import dealer price lists. Changes are shared and update the order form for everyone.</p>
      <div id="app-nav" style="margin-bottom:1rem;border-radius:6px;overflow:hidden">
        <button class="nav-tab active" data-tab="import">Price-List Import</button>
        <button class="nav-tab" data-tab="products">Products</button>
        <button class="nav-tab" data-tab="brands">Brands &amp; Suppliers</button>
      </div>
      <div id="admin-body"></div>
    </div>`;
  root.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      root.querySelectorAll("[data-tab]").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      openTab(root, b.dataset.tab);
    }));

  await refreshRefs();
  openTab(root, "import");
}

async function refreshRefs() {
  const [s, b] = await Promise.all([
    supabase.from("suppliers").select("*").order("name"),
    supabase.from("brands").select("*, suppliers(name)").order("sort_order"),
  ]);
  suppliers = s.data || [];
  brands = b.data || [];
}

function openTab(root, tab) {
  const body = root.querySelector("#admin-body");
  if (tab === "import") return renderImport(body);
  if (tab === "products") return renderProducts(body);
  if (tab === "brands") return renderBrands(body);
}

function notifyCatalogChanged() { document.dispatchEvent(new CustomEvent("gcs:catalog-changed")); }

// ── Brands & Suppliers ──────────────────────────────────────────────────
function renderBrands(body) {
  body.innerHTML = `
    <div class="panel">
      <h3>Add brand</h3>
      <div class="row-flex">
        <div class="field"><label>Slug *</label><input id="nb-slug" placeholder="augustine"></div>
        <div class="field"><label>Name *</label><input id="nb-name" placeholder="Augustine"></div>
        <div class="field"><label>Type</label><input id="nb-type" placeholder="Classical Guitar Strings"></div>
        <div class="field"><label>Category</label><select id="nb-cat"><option>strings</option><option>accessories</option><option>literature</option></select></div>
        <div class="field"><label>Subcategory</label><input id="nb-sub" placeholder="strings"></div>
        <div class="field"><label>Supplier</label><select id="nb-sup"></select></div>
        <div class="field"><label>MOQ label</label><input id="nb-moq" placeholder="No minimum"></div>
        <button class="btn-primary" id="nb-add">Add brand</button>
      </div>
    </div>
    <div class="panel"><h3>Brands</h3><div id="brand-list"></div></div>
    <div class="panel">
      <h3>Add / edit supplier</h3>
      <div class="row-flex">
        <div class="field"><label>Slug *</label><input id="ns-slug" placeholder="augustine"></div>
        <div class="field"><label>Name *</label><input id="ns-name"></div>
        <div class="field"><label>Contact</label><input id="ns-contact"></div>
        <div class="field"><label>Email</label><input id="ns-email"></div>
        <div class="field"><label>Address</label><input id="ns-address"></div>
        <button class="btn-primary" id="ns-add">Save supplier</button>
      </div>
      <div id="supplier-list" style="margin-top:0.8rem"></div>
    </div>`;

  const supSel = body.querySelector("#nb-sup");
  supSel.innerHTML = `<option value="">— none —</option>` + suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");

  body.querySelector("#nb-add").addEventListener("click", async () => {
    const row = {
      slug: val("nb-slug").toLowerCase(), name: val("nb-name"), brand_type: val("nb-type") || null,
      category: val("nb-cat"), subcategory: val("nb-sub") || null,
      supplier_id: val("nb-sup") || null, moq_label: val("nb-moq") || null,
      sort_order: (brands.length + 1) * 10,
    };
    if (!row.slug || !row.name) return toast("Slug and name required");
    const { error } = await supabase.from("brands").insert(row);
    if (error) return toast("Error: " + error.message);
    toast("Brand added"); await refreshRefs(); renderBrands(body); notifyCatalogChanged();
  });

  body.querySelector("#ns-add").addEventListener("click", async () => {
    const row = { slug: val("ns-slug").toLowerCase(), name: val("ns-name"), contact: val("ns-contact") || null,
      email: val("ns-email") || null, address: val("ns-address") || null };
    if (!row.slug || !row.name) return toast("Slug and name required");
    const { error } = await supabase.from("suppliers").upsert(row, { onConflict: "slug" });
    if (error) return toast("Error: " + error.message);
    toast("Supplier saved"); await refreshRefs(); renderBrands(body);
  });

  const list = body.querySelector("#brand-list");
  list.innerHTML = `<table class="data-table"><thead><tr><th>Slug</th><th>Name</th><th>Type</th><th>Category</th><th>Sub</th><th>Supplier</th><th>MOQ</th><th>Active</th><th></th></tr></thead><tbody></tbody></table>`;
  const tb = list.querySelector("tbody");
  for (const b of brands) {
    const tr = el("tr", {},
      cellInput(b, "slug", true), cellInput(b, "name"), cellInput(b, "brand_type"),
      cellSelect(b, "category", ["strings", "accessories", "literature"]),
      cellInput(b, "subcategory"),
      supplierCell(b), cellInput(b, "moq_label"), activeCell(b));
    const save = el("button", { class: "btn-soft", onclick: () => saveBrand(b, tr) }, "Save");
    tr.appendChild(el("td", {}, save));
    tb.appendChild(tr);
  }

  const sl = body.querySelector("#supplier-list");
  sl.innerHTML = `<table class="data-table"><thead><tr><th>Slug</th><th>Name</th><th>Contact</th><th>Email</th></tr></thead><tbody>` +
    suppliers.map((s) => `<tr><td>${esc(s.slug)}</td><td>${esc(s.name)}</td><td>${esc(s.contact || "")}</td><td>${esc(s.email || "")}</td></tr>`).join("") + `</tbody></table>`;
}

function cellInput(obj, key, readonly) {
  const td = el("td", {});
  const inp = el("input", { value: obj[key] ?? "", style: "width:100%;font-size:12px;border:1px solid var(--border);border-radius:3px;padding:2px 5px" });
  if (readonly) inp.readOnly = true;
  inp.dataset.key = key; td.appendChild(inp); return td;
}
function cellSelect(obj, key, opts) {
  const td = el("td", {});
  const sel = el("select", { style: "font-size:12px" });
  sel.innerHTML = opts.map((o) => `<option ${o === obj[key] ? "selected" : ""}>${o}</option>`).join("");
  sel.dataset.key = key; td.appendChild(sel); return td;
}
function supplierCell(b) {
  const td = el("td", {});
  const sel = el("select", { style: "font-size:12px" });
  sel.innerHTML = `<option value="">—</option>` + suppliers.map((s) => `<option value="${s.id}" ${s.id === b.supplier_id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  sel.dataset.key = "supplier_id"; td.appendChild(sel); return td;
}
function activeCell(b) {
  const td = el("td", {});
  const cb = el("input", { type: "checkbox" }); cb.checked = b.active; cb.dataset.key = "active";
  td.appendChild(cb); return td;
}
async function saveBrand(b, tr) {
  const upd = {};
  tr.querySelectorAll("[data-key]").forEach((i) => {
    upd[i.dataset.key] = i.type === "checkbox" ? i.checked : (i.value === "" ? null : i.value);
  });
  delete upd.slug;
  const { error } = await supabase.from("brands").update(upd).eq("id", b.id);
  if (error) return toast("Error: " + error.message);
  toast("Saved " + b.slug); notifyCatalogChanged();
}

// ── Products ────────────────────────────────────────────────────────────
function renderProducts(body) {
  body.innerHTML = `
    <div class="panel">
      <h3>Add product</h3>
      <div class="row-flex">
        <div class="field"><label>Brand</label><select id="np-brand"></select></div>
        <div class="field"><label>SKU *</label><input id="np-sku"></div>
        <div class="field"><label>Description *</label><input id="np-desc" style="min-width:240px"></div>
        <div class="field"><label>Retail</label><input id="np-retail" type="number" step="0.01"></div>
        <div class="field"><label>Dealer</label><input id="np-dealer" type="number" step="0.01"></div>
        <div class="field"><label>Pack</label><select id="np-pack"><option value="">—</option><option>full</option><option>half</option><option>single</option></select></div>
        <div class="field"><label>Tension</label><input id="np-tension"></div>
        <div class="field"><label>Group</label><input id="np-group"></div>
        <button class="btn-primary" id="np-add">Add</button>
      </div>
    </div>
    <div class="panel">
      <h3>Find &amp; edit products</h3>
      <div class="row-flex">
        <div class="field"><label>Search SKU / description</label><input id="p-q" placeholder="type to search…" style="min-width:280px"></div>
        <div class="field"><label>Brand</label><select id="p-brand"><option value="">All</option></select></div>
        <button class="btn-primary" id="p-search">Search</button>
      </div>
      <div id="product-results" style="margin-top:0.8rem"><p class="muted">Search to list products (max 200 shown).</p></div>
    </div>`;

  const brandOpts = brands.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  body.querySelector("#np-brand").innerHTML = brandOpts;
  body.querySelector("#p-brand").innerHTML = `<option value="">All</option>` + brandOpts;

  body.querySelector("#np-add").addEventListener("click", async () => {
    const row = {
      brand_id: val("np-brand"), sku: val("np-sku"), description: val("np-desc"),
      retail: numOrNull("np-retail"), dealer_cost: numOrNull("np-dealer"),
      pack_type: val("np-pack") || null, tension: val("np-tension") || null, group_label: val("np-group") || null,
    };
    if (!row.brand_id || !row.sku || !row.description) return toast("Brand, SKU and description required");
    const { error } = await supabase.from("products").upsert(row, { onConflict: "brand_id,sku" });
    if (error) return toast("Error: " + error.message);
    toast("Product saved"); notifyCatalogChanged();
  });

  const doSearch = async () => {
    const q = val("p-q").trim(), bid = val("p-brand");
    let query = supabase.from("products").select("*, brands(name,slug)").limit(200).order("sku");
    if (bid) query = query.eq("brand_id", bid);
    if (q) query = query.or(`sku.ilike.%${q}%,description.ilike.%${q}%`);
    const { data, error } = await query;
    const box = body.querySelector("#product-results");
    if (error) { box.textContent = "Error: " + error.message; return; }
    if (!data.length) { box.innerHTML = `<p class="muted">No products found.</p>`; return; }
    box.innerHTML = `<table class="data-table"><thead><tr><th>Brand</th><th>SKU</th><th>Description</th><th class="num">Retail</th><th class="num">Dealer</th><th>Active</th><th></th></tr></thead><tbody></tbody></table>`;
    const tb = box.querySelector("tbody");
    for (const p of data) {
      const tr = el("tr", {},
        el("td", { class: "muted" }, p.brands?.name || ""),
        el("td", { class: "sku" }, p.sku),
        cellInput(p, "description"),
        priceCell(p, "retail"), priceCell(p, "dealer_cost"), activeCell(p));
      tr.appendChild(el("td", {}, el("button", { class: "btn-soft", onclick: () => saveProduct(p, tr) }, "Save")));
      tb.appendChild(tr);
    }
  };
  body.querySelector("#p-search").addEventListener("click", doSearch);
  body.querySelector("#p-q").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
}
function priceCell(p, key) {
  const td = el("td", { class: "num" });
  const inp = el("input", { type: "number", step: "0.01", value: p[key] ?? "", style: "width:80px;text-align:right;font-size:12px;border:1px solid var(--border);border-radius:3px;padding:2px 5px" });
  inp.dataset.key = key; td.appendChild(inp); return td;
}
async function saveProduct(p, tr) {
  const upd = {};
  tr.querySelectorAll("[data-key]").forEach((i) => {
    upd[i.dataset.key] = i.type === "checkbox" ? i.checked : (i.type === "number" ? numVal(i) : (i.value === "" ? null : i.value));
  });
  const { error } = await supabase.from("products").update(upd).eq("id", p.id);
  if (error) return toast("Error: " + error.message);
  toast("Saved " + p.sku); notifyCatalogChanged();
}

// ── Price-list import ───────────────────────────────────────────────────
let importRows = [];
const FIELDS = ["sku", "description", "retail", "dealer_cost", "pack_type", "tension", "group_label", "subgroup_label"];

function renderImport(body) {
  body.innerHTML = `
    <div class="panel">
      <h3>1 · Choose the brand (distributor)</h3>
      <p class="muted" style="margin-bottom:0.6rem">Pick an existing brand, or type a new slug to onboard a new distributor (e.g. <em>augustine</em>, <em>alfred</em>). New brands are created automatically.</p>
      <div class="row-flex">
        <div class="field"><label>Existing brand</label><select id="im-brand"><option value="">— new brand —</option></select></div>
        <div class="field"><label>New brand slug</label><input id="im-newslug" placeholder="augustine"></div>
        <div class="field"><label>New brand name</label><input id="im-newname" placeholder="Augustine"></div>
        <div class="field"><label>New brand category</label><select id="im-newcat"><option>accessories</option><option>strings</option><option>literature</option></select></div>
      </div>
    </div>
    <div class="panel">
      <h3>2 · Upload the price list (.xlsx, .xls or .csv)</h3>
      <input type="file" id="im-file" accept=".xlsx,.xls,.csv">
      <div id="im-map" style="margin-top:0.9rem"></div>
    </div>
    <div class="panel" id="im-preview-panel" hidden>
      <h3>3 · Preview &amp; import</h3>
      <div id="im-preview"></div>
      <div style="margin-top:0.8rem;display:flex;gap:0.6rem;align-items:center">
        <button class="btn-primary" id="im-go">Import to catalog</button>
        <span id="im-count" class="muted"></span>
      </div>
    </div>`;

  body.querySelector("#im-brand").innerHTML =
    `<option value="">— new brand —</option>` + brands.map((b) => `<option value="${b.slug}">${esc(b.name)} (${b.slug})</option>`).join("");

  body.querySelector("#im-file").addEventListener("change", (e) => handleFile(e.target.files[0], body));
  body.querySelector("#im-go").addEventListener("click", () => runImport(body));
}

async function handleFile(file, body) {
  if (!file) return;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  // find first non-empty row as header
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() !== ""));
  if (headerIdx < 0) return toast("Empty sheet");
  const headers = rows[headerIdx].map((h) => String(h).trim());
  const dataRows = rows.slice(headerIdx + 1).filter((r) => r.some((c) => String(c).trim() !== ""));
  importRows = dataRows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  renderMapping(body, headers);
}

function renderMapping(body, headers) {
  const guess = (names) => headers.find((h) => names.some((n) => h.toLowerCase().includes(n))) || "";
  const guesses = {
    sku: guess(["sku", "item", "model", "code", "part"]),
    description: guess(["desc", "name", "title", "product"]),
    retail: guess(["retail", "msrp", "list", "map"]),
    dealer_cost: guess(["dealer", "cost", "wholesale", "net"]),
    pack_type: guess(["pack", "set type"]),
    tension: guess(["tension"]),
    group_label: guess(["group", "category", "series"]),
    subgroup_label: guess(["subgroup", "composer", "sub"]),
  };
  const map = body.querySelector("#im-map");
  map.innerHTML = `<p class="muted" style="margin-bottom:0.5rem">Match your spreadsheet columns to catalog fields. SKU is required.</p>` +
    `<div class="row-flex">` + FIELDS.map((f) =>
      `<div class="field"><label>${f}${f === "sku" ? " *" : ""}</label><select data-field="${f}">` +
      `<option value="">—</option>` + headers.map((h) => `<option ${h === guesses[f] ? "selected" : ""}>${esc(h)}</option>`).join("") +
      `</select></div>`).join("") + `</div>` +
    `<button class="btn-soft" id="im-preview-btn" style="margin-top:0.7rem">Build preview</button>`;
  map.querySelector("#im-preview-btn").addEventListener("click", () => buildPreview(body));
}

function currentMapping(body) {
  const m = {};
  body.querySelectorAll("[data-field]").forEach((s) => { if (s.value) m[s.dataset.field] = s.value; });
  return m;
}

function buildPreview(body) {
  const m = currentMapping(body);
  if (!m.sku) return toast("Map the SKU column");
  const mapped = importRows.map((r) => {
    const o = {};
    for (const f of FIELDS) if (m[f]) o[f] = clean(r[m[f]]);
    return o;
  }).filter((o) => o.sku);
  body._mapped = mapped;
  const panel = body.querySelector("#im-preview-panel");
  panel.hidden = false;
  body.querySelector("#im-count").textContent = `${mapped.length} rows ready`;
  const sample = mapped.slice(0, 10);
  body.querySelector("#im-preview").innerHTML =
    `<table class="data-table"><thead><tr>${FIELDS.map((f) => `<th>${f}</th>`).join("")}</tr></thead><tbody>` +
    sample.map((o) => `<tr>${FIELDS.map((f) => `<td>${esc(o[f] ?? "")}</td>`).join("")}</tr>`).join("") +
    `</tbody></table><p class="muted" style="margin-top:0.4rem">Showing first ${sample.length} of ${mapped.length}.</p>`;
}

async function runImport(body) {
  const mapped = body._mapped || [];
  if (!mapped.length) return toast("Build a preview first");
  let brandSlug = val("im-brand");
  let extra = {};
  if (!brandSlug) {
    brandSlug = val("im-newslug").trim().toLowerCase();
    if (!brandSlug) return toast("Pick a brand or enter a new slug");
    extra = { brand_name: val("im-newname") || brandSlug, category: val("im-newcat") };
  }
  const payload = mapped.map((o) => {
    const row = { ...o, brand_slug: brandSlug, ...extra };
    if (row.retail != null) row.retail = String(row.retail).replace(/[^0-9.\-]/g, "");
    if (row.dealer_cost != null) row.dealer_cost = String(row.dealer_cost).replace(/[^0-9.\-]/g, "");
    if (row.pack_type) row.pack_type = String(row.pack_type).toLowerCase().trim();
    if (row.pack_type && !["full", "half", "single"].includes(row.pack_type)) delete row.pack_type;
    return row;
  });
  const btn = body.querySelector("#im-go");
  btn.disabled = true; btn.textContent = "Importing…";
  const { data, error } = await supabase.rpc("import_catalog", { p_rows: payload });
  btn.disabled = false; btn.textContent = "Import to catalog";
  if (error) return toast("Import failed: " + error.message);
  toast(`Imported ${data.products_upserted} products (${data.brands_created} new brand(s))`);
  await refreshRefs(); notifyCatalogChanged();
}

// ── helpers ──
function val(id) { const e = document.getElementById(id); return e ? e.value : ""; }
function numOrNull(id) { const v = val(id); return v === "" ? null : Number(v); }
function numVal(i) { return i.value === "" ? null : Number(i.value); }
function clean(v) { return (v === undefined || v === null) ? "" : String(v).trim(); }
