// Orders / shared cart. The "cart" is a single shared DRAFT order in
// Supabase that all three users see; quantities sync live. "Submit"
// finalizes the order (prices already snapshotted on each line) and
// opens a fresh draft.
import { supabase } from "./supabase.js";
import { getCatalog } from "./catalog.js";
import { fmt, toast, debounce } from "./util.js";

let draft = null;                 // current draft order row
let qtyMap = new Map();           // "brand|sku" -> qty (mirror of draft items)
let me = null;
let channel = null;

export async function initCart(user) {
  me = user;
  draft = await getOrCreateDraft();
  await loadDraftItems();
  subscribeRealtime();
  return draft;
}

async function getOrCreateDraft() {
  const { data, error } = await supabase
    .from("orders").select("*").eq("status", "draft")
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  if (data && data.length) return data[0];
  const { data: created, error: e2 } = await supabase
    .from("orders").insert({ status: "draft", created_by: me?.id }).select().single();
  if (e2) throw e2;
  await logEvent(created.id, "created", "Draft order opened");
  return created;
}

async function loadDraftItems() {
  qtyMap.clear();
  const { data, error } = await supabase
    .from("order_items").select("brand, sku, qty").eq("order_id", draft.id);
  if (error) throw error;
  for (const r of data) qtyMap.set(r.brand + "|" + r.sku, r.qty);
}

// Apply current qtyMap to the rendered inputs, then recalc.
export function applyQuantitiesToForm() {
  document.querySelectorAll("#order-form tr[data-sku]").forEach((row) => {
    const key = row.dataset.brand + "|" + row.dataset.sku;
    const inp = row.querySelector(".qty-input");
    if (inp && document.activeElement !== inp) inp.value = qtyMap.get(key) || 0;
  });
  recalc();
}

// ── Wire the order form (event delegation) ──────────────────────────────
export function wireOrderForm(container) {
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".qty-btn");
    if (!btn) return;
    const inp = btn.parentElement.querySelector(".qty-input");
    const delta = parseInt(btn.dataset.adj) || 0;
    inp.value = Math.max(0, (parseInt(inp.value) || 0) + delta);
    onQtyChange(inp);
  });
  container.addEventListener("input", (e) => {
    if (e.target.classList.contains("qty-input")) onQtyChange(e.target);
  });
}

function onQtyChange(inp) {
  const row = inp.closest("tr[data-sku]");
  const qty = Math.max(0, parseInt(inp.value) || 0);
  inp.value = qty;
  const key = row.dataset.brand + "|" + row.dataset.sku;
  if (qty > 0) qtyMap.set(key, qty); else qtyMap.delete(key);
  recalc();
  queueSync(row.dataset.brand, row.dataset.sku, qty);
}

// Debounced per-line sync to the DB.
const pending = new Map();
const flush = debounce(async () => {
  const ops = [...pending.entries()];
  pending.clear();
  for (const [key, qty] of ops) {
    const [brand, sku] = key.split("|");
    try { await syncLine(brand, sku, qty); } catch (err) { console.error("sync", key, err); }
  }
}, 600);
function queueSync(brand, sku, qty) { pending.set(brand + "|" + sku, qty); flush(); }

async function syncLine(brand, sku, qty) {
  if (!draft) return;
  if (qty <= 0) {
    await supabase.from("order_items").delete().eq("order_id", draft.id).eq("sku", sku).eq("brand", brand);
    return;
  }
  const cat = getCatalog().bySku.get(brand + "|" + sku);
  const payload = {
    order_id: draft.id, brand, sku,
    description: cat?.description ?? sku,
    qty,
    dealer_cost: cat?.dealer_cost ?? null,   // snapshot current price
    retail: cat?.retail ?? null,
  };
  // Upsert on (order_id, brand, sku) — unique index in db/02_catalog_schema.sql.
  await supabase.from("order_items").upsert(payload, { onConflict: "order_id,brand,sku" });
}

// ── Totals ──────────────────────────────────────────────────────────────
export function recalc() {
  let grandTotal = 0, grandQty = 0;
  document.querySelectorAll("#order-form .items-table").forEach((table) => {
    const slug = table.getAttribute("data-brand");
    let bt = 0, bq = 0;
    table.querySelectorAll("tbody tr[data-sku]").forEach((row) => {
      const qty = Math.max(0, parseInt(row.querySelector(".qty-input")?.value) || 0);
      const price = parseFloat(row.querySelector(".dealer-cost")?.dataset.cost) || 0;
      const sub = qty * price;
      const st = row.querySelector(".subtotal");
      if (st) { st.textContent = fmt(sub); st.classList.toggle("nonzero", sub > 0); }
      bt += sub; bq += qty;
    });
    const subEl = document.getElementById("sub-" + slug);
    const footEl = document.getElementById("foot-" + slug);
    if (subEl) subEl.textContent = fmt(bt);
    if (footEl) footEl.textContent = fmt(bt);
    grandTotal += bt; grandQty += bq;
  });
  setText("bar-total", fmt(grandTotal));
  setText("bar-qty", String(grandQty));
  setText("gt-total", fmt(grandTotal));
  setText("gt-qty", String(grandQty));
  return { grandTotal, grandQty };
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

export function cartCount() { return [...qtyMap.values()].reduce((a, b) => a + b, 0); }

// Current cart as enriched line items (joined to catalog + supplier info),
// for building per-distributor purchase orders.
export function getCartLines() {
  const cat = getCatalog();
  const lines = [];
  for (const [key, qty] of qtyMap.entries()) {
    if (qty <= 0) continue;
    const r = cat?.bySku.get(key);
    if (!r) continue;
    lines.push({
      brand_slug: r.brand_slug, brand_name: r.brand_name,
      supplier_slug: r.supplier_slug || r.brand_slug,
      supplier_name: r.supplier_name || r.brand_name,
      supplier_contact: r.supplier_contact, supplier_email: r.supplier_email,
      supplier_cc: r.supplier_cc, supplier_address: r.supplier_address, supplier_terms: r.supplier_terms,
      sku: r.sku, description: r.description, retail: r.retail, dealer_cost: r.dealer_cost, qty,
    });
  }
  return lines;
}

// ── Clear / submit ──────────────────────────────────────────────────────
export async function clearCart() {
  if (!draft) return;
  await supabase.from("order_items").delete().eq("order_id", draft.id);
  qtyMap.clear();
  document.querySelectorAll("#order-form .qty-input").forEach((i) => (i.value = 0));
  recalc();
}

export async function submitOrder({ label, notes }) {
  if (!draft) throw new Error("No draft");
  if (cartCount() === 0) throw new Error("Add at least one item before submitting.");
  // make sure any in-flight edits are written
  await new Promise((r) => setTimeout(r, 700));
  const { error } = await supabase.from("orders").update({
    status: "submitted", submitted_at: new Date().toISOString(),
    label: label || null, notes: notes || null,
  }).eq("id", draft.id);
  if (error) throw error;
  await logEvent(draft.id, "submitted", `Submitted${label ? " — " + label : ""}`);
  toast("Order submitted ✓");
  // open a fresh shared draft
  draft = await getOrCreateDraft();
  qtyMap.clear();
  document.querySelectorAll("#order-form .qty-input").forEach((i) => (i.value = 0));
  recalc();
  resubscribe();
  return true;
}

export async function logEvent(orderId, action, detail) {
  try {
    await supabase.from("order_events").insert({ order_id: orderId, user_id: me?.id, action, detail });
  } catch (e) { /* non-fatal */ }
}

// ── Realtime ────────────────────────────────────────────────────────────
function subscribeRealtime() {
  try {
    channel = supabase
      .channel("draft-" + draft.id)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "order_items", filter: "order_id=eq." + draft.id },
        async () => { await loadDraftItems(); applyQuantitiesToForm(); })
      .subscribe();
  } catch (e) { console.warn("realtime unavailable", e); }
}
function resubscribe() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
  subscribeRealtime();
}
