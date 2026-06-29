// Per-distributor purchase orders. Takes enriched cart/order line items,
// groups them by supplier, and renders printable / emailable POs — the
// step that actually places orders with each distributor.
import { fmt, fmtInt, esc, toast, el } from "./util.js";

const STUDIO = {
  name: "The Guitar Studio, LLC",
  person: "Will Douglas, D.M.A.",
  address: "4455 Camp Bowie Blvd., Suite 230, Fort Worth, TX 76116",
  email: "info@theguitarstudio.org",
};

function groupBySupplier(lines) {
  const map = new Map();
  for (const ln of lines) {
    const key = ln.supplier_slug || ln.brand_slug;
    if (!map.has(key)) {
      map.set(key, {
        key, name: ln.supplier_name || ln.brand_name,
        contact: ln.supplier_contact, email: ln.supplier_email, cc: ln.supplier_cc,
        address: ln.supplier_address, terms: ln.supplier_terms,
        items: [], total: 0, qty: 0,
      });
    }
    const g = map.get(key);
    g.items.push(ln);
    g.total += (Number(ln.dealer_cost) || 0) * ln.qty;
    g.qty += ln.qty;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// title is shown in the header (e.g. "Current Order" or a saved order's label).
export function openSupplierOrders(lines, title = "Current Order") {
  const groups = groupBySupplier(lines);
  if (!groups.length) { toast("No items to order yet."); return; }
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const screen = el("div", { id: "supplier-screen" });
  const wrap = el("div", { class: "sup-wrap" });

  // toolbar
  const nav = el("div", { class: "sup-nav no-print" });
  nav.appendChild(el("button", { class: "btn-soft", onclick: () => screen.remove() }, "← Back"));
  nav.appendChild(el("button", { class: "btn-primary", onclick: () => printAll() }, "Print all"));
  const navBtns = [];
  groups.forEach((g, i) => {
    const b = el("button", { class: "sup-nav-btn" + (i === 0 ? " active" : ""), onclick: () => show(i) },
      `${g.name} (${g.qty})`);
    navBtns.push(b); nav.appendChild(b);
  });
  wrap.appendChild(el("div", { class: "no-print", style: "font-size:12px;color:var(--text-muted);margin-bottom:0.5rem" }, `Purchase orders · ${esc(title)} · ${today}`));
  wrap.appendChild(nav);

  // PO blocks
  const blocks = groups.map((g, i) => poBlock(g, i, today));
  blocks.forEach((b) => wrap.appendChild(b));

  function show(i) {
    navBtns.forEach((b, j) => b.classList.toggle("active", j === i));
    blocks.forEach((b, j) => { b.hidden = j !== i; });
  }
  function printAll() {
    blocks.forEach((b) => { b.hidden = false; b.classList.remove("print-hide"); });
    window.print();
  }
  show(0);
  screen.appendChild(wrap);
  document.body.appendChild(screen);
  window.scrollTo(0, 0);
}

function poBlock(g, i, today) {
  const block = el("div", { class: "po-block" });

  const rows = g.items.map((it) =>
    `<tr><td class="sku">${esc(it.sku)}</td><td>${esc(it.description)}</td>` +
    `<td class="num">${it.qty}</td>` +
    `<td class="num">${it.retail != null ? fmt(it.retail) : "—"}</td>` +
    `<td class="num">${fmt(it.dealer_cost)}</td>` +
    `<td class="num">${fmt((Number(it.dealer_cost) || 0) * it.qty)}</td></tr>`).join("");

  block.innerHTML = `
    <div class="po-block-toolbar no-print" style="display:flex;gap:0.5rem;padding:0.5rem 0.75rem;background:var(--parchment);border-bottom:1px solid var(--border)">
      <button class="btn-soft" data-print>Print this order</button>
      <button class="btn-soft" data-copy>Copy for email</button>
    </div>
    <div class="po-head"><span class="po-name">${esc(g.name)}</span><span style="font-size:12px;color:#c0a060">${today}</span></div>
    <div class="po-grid">
      <div>
        <div class="lbl">Supplier</div>
        <div style="font-weight:600">${esc(g.contact || g.name)}</div>
        ${g.email ? `<div style="color:var(--green)">${esc(g.email)}</div>` : ""}
        ${g.cc ? `<div>CC: ${esc(g.cc)}</div>` : ""}
        ${g.address ? `<div class="muted" style="margin-top:2px">${esc(g.address)}</div>` : ""}
      </div>
      <div>
        <div class="lbl">From</div>
        <div style="font-weight:600">${STUDIO.name}</div>
        <div>${STUDIO.person}</div>
        <div class="muted">${STUDIO.address}</div>
        <div style="color:var(--green)">${STUDIO.email}</div>
      </div>
    </div>
    ${g.terms ? `<div class="po-terms"><strong style="color:var(--brown-mid)">Terms: </strong>${esc(g.terms)}</div>` : ""}
    <table class="po-table">
      <thead><tr><th>SKU</th><th>Description</th><th class="num">Qty</th><th class="num">Retail</th><th class="num">Dealer</th><th class="num">Line</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="po-foot">
      <div><div class="lbl">Units</div><div class="val">${fmtInt(g.qty)}</div></div>
      <div><div class="lbl">Order total (dealer)</div><div class="val">${fmt(g.total)}</div></div>
    </div>`;

  block.querySelector("[data-print]").addEventListener("click", () => {
    // print just this block
    const all = [...document.querySelectorAll("#supplier-screen .po-block")];
    all.forEach((b) => b.classList.toggle("print-hide", b !== block));
    const wasHidden = block.hidden; block.hidden = false;
    window.print();
    all.forEach((b) => b.classList.remove("print-hide"));
    block.hidden = wasHidden;
  });
  block.querySelector("[data-copy]").addEventListener("click", (e) => copyEmail(g, today, e.target));
  return block;
}

function copyEmail(g, today, btn) {
  const lines = [];
  lines.push(`Purchase Order — ${STUDIO.name}`);
  lines.push(`Date: ${today}`);
  lines.push(`To: ${g.contact || g.name}${g.email ? " <" + g.email + ">" : ""}`);
  lines.push("");
  lines.push("Please process the following order:");
  lines.push("");
  for (const it of g.items) {
    lines.push(`  ${it.qty} x ${it.sku} — ${it.description} @ ${fmt(it.dealer_cost)} = ${fmt((Number(it.dealer_cost) || 0) * it.qty)}`);
  }
  lines.push("");
  lines.push(`Total: ${fmtInt(g.qty)} units — ${fmt(g.total)} (dealer)`);
  lines.push("");
  lines.push(`${STUDIO.name}`);
  lines.push(`${STUDIO.person}`);
  lines.push(`${STUDIO.address}`);
  lines.push(`${STUDIO.email}`);
  const text = lines.join("\n");

  const done = () => { const t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(() => (btn.textContent = t), 1500); };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = el("textarea", { style: "position:fixed;opacity:0" }); ta.value = text;
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("Copy not supported — select manually"); }
  ta.remove();
}
