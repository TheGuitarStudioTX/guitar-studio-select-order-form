// Order History: browse submitted orders, filter by date / brand / SKU,
// advance status, and see the monthly spend trend (v_monthly_brand_spend).
import { supabase } from "./supabase.js";
import { fmt, fmtInt, esc, toast, el } from "./util.js";
import { logEvent } from "./orders.js";
import { openSupplierOrders } from "./supplier.js";

let brandLookup = new Map(); // slug -> { name, supplier_* }

const STATUSES = ["draft", "submitted", "ordered", "received"];
const NEXT = { submitted: "ordered", ordered: "received" };

export async function renderHistory(root) {
  root.innerHTML = `
    <div class="view-pad">
      <h2 class="view-title">Order History</h2>
      <p class="view-sub">Shared across the team — every submitted order, searchable and trend-tracked.</p>

      <div class="panel">
        <div class="row-flex">
          <div class="field"><label>From</label><input type="date" id="h-from"></div>
          <div class="field"><label>To</label><input type="date" id="h-to"></div>
          <div class="field"><label>Brand</label><input type="text" id="h-brand" placeholder="e.g. savarez"></div>
          <div class="field"><label>SKU contains</label><input type="text" id="h-sku" placeholder="e.g. EJ45"></div>
          <div class="field"><label>Status</label>
            <select id="h-status"><option value="">All (submitted+)</option>
              <option>submitted</option><option>ordered</option><option>received</option><option>draft</option></select>
          </div>
          <button class="btn-primary" id="h-apply">Apply</button>
          <button class="btn-soft" id="h-reset">Reset</button>
        </div>
      </div>

      <div class="panel">
        <h3>Monthly Trend — units &amp; dealer spend</h3>
        <div id="h-trend"><span class="spinner"></span></div>
      </div>

      <div class="panel">
        <h3>Orders</h3>
        <div id="h-list"><span class="spinner"></span></div>
      </div>
    </div>`;

  root.querySelector("#h-apply").addEventListener("click", () => loadOrders(root));
  root.querySelector("#h-reset").addEventListener("click", () => {
    ["h-from", "h-to", "h-brand", "h-sku"].forEach((id) => (root.querySelector("#" + id).value = ""));
    root.querySelector("#h-status").value = "";
    loadOrders(root);
  });

  await Promise.all([loadTrend(root), loadOrders(root), loadBrandLookup()]);
}

async function loadBrandLookup() {
  const { data } = await supabase.from("brands").select("slug, name, suppliers(slug, name, contact, email, cc, address, terms)");
  brandLookup = new Map();
  for (const b of data || []) brandLookup.set(b.slug, { name: b.name, sup: b.suppliers });
}

function linesFromOrder(o) {
  return (o.order_items || []).map((i) => {
    const b = brandLookup.get(i.brand) || {};
    const s = b.sup || {};
    return {
      brand_slug: i.brand, brand_name: b.name || i.brand,
      supplier_slug: s.slug || i.brand, supplier_name: s.name || b.name || i.brand,
      supplier_contact: s.contact, supplier_email: s.email, supplier_cc: s.cc,
      supplier_address: s.address, supplier_terms: s.terms,
      sku: i.sku, description: i.description, retail: i.retail, dealer_cost: i.dealer_cost, qty: i.qty,
    };
  });
}

async function loadTrend(root) {
  const box = root.querySelector("#h-trend");
  const { data, error } = await supabase.from("v_monthly_brand_spend").select("*");
  if (error) { box.textContent = "Could not load trend: " + error.message; return; }
  if (!data.length) { box.innerHTML = `<p class="muted">No submitted orders yet.</p>`; return; }

  // Roll brand rows up to month totals.
  const months = new Map();
  for (const r of data) {
    const m = months.get(r.month) || { month: r.month, units: 0, spend: 0 };
    m.units += Number(r.units); m.spend += Number(r.dealer_spend);
    months.set(r.month, m);
  }
  const rows = [...months.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
  const max = Math.max(...rows.map((r) => r.spend), 1);
  box.innerHTML = `<div class="trend">` + rows.map((r) => {
    const label = new Date(r.month + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const pct = Math.round((r.spend / max) * 100);
    return `<div class="trend-row"><div>${label}</div>` +
      `<div class="trend-bar-track"><div class="trend-bar-fill" style="width:${pct}%"></div></div>` +
      `<div class="trend-amt">${fmt(r.spend)} · ${fmtInt(r.units)}u</div></div>`;
  }).join("") + `</div>`;
}

async function loadOrders(root) {
  const list = root.querySelector("#h-list");
  list.innerHTML = `<span class="spinner"></span>`;
  const from = root.querySelector("#h-from").value;
  const to = root.querySelector("#h-to").value;
  const brand = root.querySelector("#h-brand").value.trim().toLowerCase();
  const sku = root.querySelector("#h-sku").value.trim();
  const status = root.querySelector("#h-status").value;

  let q = supabase.from("orders")
    .select("*, order_items(brand, sku, description, qty, dealer_cost, line_total), profiles(full_name,email)")
    .order("created_at", { ascending: false });

  if (status) q = q.eq("status", status);
  else q = q.in("status", ["submitted", "ordered", "received"]);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to + "T23:59:59");

  const { data, error } = await q;
  if (error) { list.textContent = "Error: " + error.message; return; }

  // Brand/SKU filters apply to line items (client side).
  let orders = data;
  if (brand) orders = orders.filter((o) => o.order_items.some((i) => (i.brand || "").toLowerCase().includes(brand)));
  if (sku) orders = orders.filter((o) => o.order_items.some((i) => (i.sku || "").toLowerCase().includes(sku.toLowerCase())));

  if (!orders.length) { list.innerHTML = `<p class="muted">No orders match these filters.</p>`; return; }
  list.innerHTML = "";
  for (const o of orders) list.appendChild(orderCard(o, root));
}

function orderCard(o, root) {
  const items = o.order_items || [];
  const units = items.reduce((a, i) => a + i.qty, 0);
  const total = items.reduce((a, i) => a + Number(i.line_total || 0), 0);
  const when = new Date(o.submitted_at || o.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const who = o.profiles?.full_name || o.profiles?.email || "—";

  const wrap = el("div", { style: "border:1px solid var(--border);border-radius:5px;margin-bottom:0.7rem;overflow:hidden" });
  const head = el("div", { style: "display:flex;align-items:center;gap:0.8rem;padding:0.6rem 0.8rem;background:var(--parchment);cursor:pointer" });
  head.innerHTML =
    `<span class="badge ${o.status}">${o.status}</span>` +
    `<strong style="flex:1">${esc(o.label || "Order")} <span class="muted" style="font-weight:400">· ${when} · ${esc(who)}</span></strong>` +
    `<span class="muted">${fmtInt(units)} units</span>` +
    `<strong style="color:var(--green)">${fmt(total)}</strong>`;

  const body = el("div", { hidden: true, style: "padding:0.6rem 0.8rem;background:white" });
  let rows = items.map((i) =>
    `<tr><td class="sku">${esc(i.sku)}</td><td>${esc(i.description || "")}</td>` +
    `<td class="muted">${esc(i.brand)}</td><td class="num">${i.qty}</td>` +
    `<td class="num">${fmt(i.dealer_cost)}</td><td class="num">${fmt(i.line_total)}</td></tr>`).join("");
  body.innerHTML =
    `<table class="data-table"><thead><tr><th>SKU</th><th>Description</th><th>Brand</th>` +
    `<th class="num">Qty</th><th class="num">Unit</th><th class="num">Line</th></tr></thead><tbody>${rows}</tbody></table>`;
  if (o.notes) body.appendChild(el("p", { class: "muted", style: "margin-top:0.5rem", html: "Notes: " + esc(o.notes) }));

  // actions: supplier POs + status advance
  const bar = el("div", { class: "no-print", style: "margin-top:0.7rem;display:flex;gap:0.5rem;flex-wrap:wrap" });
  bar.appendChild(el("button", { class: "btn-soft", onclick: (ev) => {
    ev.stopPropagation();
    openSupplierOrders(linesFromOrder(o), o.label || "Order " + when);
  } }, "Supplier orders / print"));
  if (NEXT[o.status]) {
    const adv = el("button", { class: "btn-soft", onclick: async (ev) => {
      ev.stopPropagation();
      const ns = NEXT[o.status];
      const { error } = await supabase.from("orders").update({ status: ns }).eq("id", o.id);
      if (error) return toast("Error: " + error.message);
      await logEvent(o.id, "status_change", `${o.status} → ${ns}`);
      toast(`Marked ${ns}`);
      loadOrders(root);
    } }, `Mark as ${NEXT[o.status]}`);
    bar.appendChild(adv);
  }
  body.appendChild(bar);

  head.addEventListener("click", () => { body.hidden = !body.hidden; });
  wrap.append(head, body);
  return wrap;
}
