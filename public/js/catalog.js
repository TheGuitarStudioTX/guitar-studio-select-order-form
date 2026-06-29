// Catalog: load product/brand/supplier data from Supabase and render the
// order form UI from it — preserving the legacy look, collapsible brand
// sections, and all filters (category, tension, Full/Half/Singles, …).
import { supabase } from "./supabase.js";
import { fmt, esc } from "./util.js";

let CATALOG = null; // { brands: [...], bySku: Map }

export function getCatalog() { return CATALOG; }

export async function loadCatalog() {
  // v_catalog is flat; page past PostgREST's 1000-row cap.
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("v_catalog")
      .select("*")
      .eq("active", true)
      .order("brand_sort", { ascending: true })
      .order("sort_order", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < page) break;
  }

  // Group flat rows into ordered brands, preserving group/subgroup sequence.
  const brandMap = new Map();
  const bySku = new Map();
  for (const r of rows) {
    if (!brandMap.has(r.brand_slug)) {
      brandMap.set(r.brand_slug, {
        slug: r.brand_slug, name: r.brand_name, brand_type: r.brand_type,
        category: r.category, subcategory: r.subcategory,
        moq_label: r.moq_label, brand_sort: r.brand_sort,
        supplier_name: r.supplier_name, items: [],
      });
    }
    brandMap.get(r.brand_slug).items.push(r);
    bySku.set(r.brand_slug + "|" + r.sku, r);
  }
  CATALOG = { brands: [...brandMap.values()], bySku };
  return CATALOG;
}

// ── Render ──────────────────────────────────────────────────────────────
const CAT_LABELS = { strings: "Strings", accessories: "Accessories", literature: "Literature" };

export function renderOrderForm(container) {
  container.innerHTML = "";
  let cat = null;
  for (const b of CATALOG.brands) {
    if (b.category !== cat) {
      cat = b.category;
      const h = document.createElement("div");
      h.className = "type-section-header";
      h.id = "type-" + cat;
      h.textContent = CAT_LABELS[cat] || cat;
      container.appendChild(h);
    }
    container.appendChild(renderBrand(b));
  }
  return container;
}

function renderBrand(b) {
  const sec = document.createElement("div");
  sec.className = "brand-section collapsed";
  sec.id = "brand-" + b.slug;
  sec.dataset.category = b.subcategory || b.category;

  const moq = b.moq_label
    ? `<div class="meta-left"><span class="moq-pill"><span class="moq-icon">⬤</span> <span>${esc(b.moq_label)}</span></span></div>` : "<div></div>";
  const sup = b.supplier_name
    ? `<div class="meta-right"><span class="muted" style="font-size:11px">Supplier: ${esc(b.supplier_name)}</span></div>` : "";

  let body = "";
  let group = null, subgroup = null;
  for (const it of b.items) {
    if ((it.group_label || null) !== group) {
      group = it.group_label || null; subgroup = null;
      if (group) body += `<tr class="cat-row"><td colspan="6">${esc(group)}</td></tr>`;
    }
    if ((it.subgroup_label || null) !== subgroup) {
      subgroup = it.subgroup_label || null;
      if (subgroup) body += `<tr class="sub-cat-row"><td colspan="6">${esc(subgroup)}</td></tr>`;
    }
    body += rowHtml(b.slug, it);
  }

  sec.innerHTML =
    `<div class="brand-header" onclick="window.__toggleBrand('${b.slug}')">` +
      `<span class="toggle-icon">▾</span><h2>${esc(b.name)}</h2>` +
      (b.brand_type ? `<span class="brand-type">${esc(b.brand_type)}</span>` : "") +
      `<span class="brand-subtotal" id="sub-${b.slug}">$0.00</span>` +
    `</div>` +
    `<div class="brand-body">` +
      `<div class="brand-meta-bar">${moq}${sup}</div>` +
      `<table class="items-table" data-brand="${b.slug}">` +
        `<thead><tr><th>SKU</th><th>Description</th><th class="num">Retail</th><th class="num">Dealer</th><th class="qty-cell">Qty</th><th class="num">Subtotal</th></tr></thead>` +
        `<tbody>${body}</tbody>` +
      `</table>` +
      `<div class="brand-footer"><span class="footer-label">Section subtotal</span><span class="footer-value" id="foot-${b.slug}">$0.00</span></div>` +
    `</div>`;
  return sec;
}

function rowHtml(brandSlug, it) {
  const retail = it.retail != null ? fmt(it.retail) : "—";
  const dealer = it.dealer_cost != null ? fmt(it.dealer_cost) : "—";
  return `<tr data-brand="${brandSlug}" data-sku="${esc(it.sku)}"` +
    (it.pack_type ? ` data-pack="${it.pack_type}"` : "") +
    (it.tension ? ` data-tension="${esc(it.tension)}"` : "") + ">" +
    `<td class="sku">${esc(it.sku)}</td>` +
    `<td class="desc">${esc(it.description)}</td>` +
    `<td class="num">${retail}</td>` +
    `<td class="dealer-cost" data-cost="${it.dealer_cost ?? 0}">${dealer}</td>` +
    `<td class="qty-cell"><div class="qty-wrap">` +
      `<button class="qty-btn" type="button" data-adj="-1">−</button>` +
      `<input class="qty-input" type="number" min="0" value="0" inputmode="numeric">` +
      `<button class="qty-btn" type="button" data-adj="1">+</button>` +
    `</div></td>` +
    `<td class="subtotal">$0.00</td></tr>`;
}

// ── Collapse / expand ───────────────────────────────────────────────────
window.__toggleBrand = (slug) => {
  const sec = document.getElementById("brand-" + slug);
  if (sec) sec.classList.toggle("collapsed");
};
export function collapseAll() {
  document.querySelectorAll(".brand-section").forEach((s) => s.classList.add("collapsed"));
}
export function expandAll() {
  document.querySelectorAll(".brand-section").forEach((s) => s.classList.remove("collapsed"));
}

// ── Filtering (ported & generalized from the legacy form) ───────────────
let activeFilter = "all";

function brandScope() {
  // Compute which brand slugs each brand-level filter allows, from catalog metadata.
  const byCat = (c) => CATALOG.brands.filter((b) => b.category === c).map((b) => b.slug);
  const bySub = (s) => CATALOG.brands.filter((b) => b.subcategory === s).map((b) => b.slug);
  return {
    strings: byCat("strings"),
    accessories: byCat("accessories"),
    literature: byCat("literature"),
    supports: bySub("supports"),
    stands: bySub("stands"),
    care: bySub("care"),
    instructional: bySub("instructional"),
    scores: bySub("scores"),
    humidity: byCat("accessories"),
    fullsets: byCat("strings"), halfsets: byCat("strings"), singles: byCat("strings"),
    normal: byCat("strings"), hard: byCat("strings"), carbon: byCat("strings"), nylon: byCat("strings"),
  };
}

export function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
  if (btn) btn.classList.add("active");
  applyFilters();
}

export function applyFilters() {
  const q = (document.getElementById("search-input")?.value || "").toLowerCase().trim();
  const scope = brandScope();
  const brandLevel = scope[activeFilter];
  let visible = 0, total = 0;
  const catVisible = {};

  for (const b of CATALOG.brands) {
    const sec = document.getElementById("brand-" + b.slug);
    if (!sec) continue;
    const brandAllowed = brandLevel ? brandLevel.includes(b.slug) : true;
    const table = sec.querySelector("[data-brand]");
    let brandHasVisible = false;

    table.querySelectorAll("tbody tr[data-sku]").forEach((row) => {
      total++;
      const txt = row.textContent.toLowerCase();
      const qty = parseInt(row.querySelector(".qty-input")?.value) || 0;
      let show = brandAllowed;
      if (show && q) show = txt.includes(q);
      if (show && activeFilter === "normal") show = txt.includes("normal") || (/\bmedium\b(?!-)/.test(txt) && !txt.includes("medium low"));
      if (show && activeFilter === "hard") show = txt.includes("hard") || txt.includes("high tension") || txt.includes("high)");
      if (show && activeFilter === "carbon") show = txt.includes("carbon");
      if (show && activeFilter === "nylon") show = txt.includes("nylon") && !txt.includes("carbon");
      if (show && activeFilter === "flamenco") show = txt.includes("flamenc");
      if (show && activeFilter === "humidity") show = /humid|humapac|hygrometer|hone/.test(txt);
      if (show && (activeFilter === "fullsets" || activeFilter === "halfsets" || activeFilter === "singles")) {
        const map = { fullsets: "full", halfsets: "half", singles: "single" };
        show = row.getAttribute("data-pack") === map[activeFilter];
      }
      if (show && activeFilter === "ordered") show = qty > 0;

      row.classList.toggle("row-hidden", !show);
      if (show) { visible++; brandHasVisible = true; }
    });

    // group/subgroup heading rows: hide a heading if nothing under it is visible
    toggleHeadings(table);

    const hideSection = (!brandAllowed) || (activeFilter === "ordered" && !brandHasVisible) || (q && !brandHasVisible);
    sec.style.display = hideSection ? "none" : "";
    if (!hideSection) catVisible[b.category] = true;
    if (brandHasVisible && (q || activeFilter !== "all")) sec.classList.remove("collapsed");
  }

  // Show each category divider only if a brand under it is visible.
  for (const cat of Object.keys(CAT_LABELS)) {
    const h = document.getElementById("type-" + cat);
    if (h) h.style.display = catVisible[cat] ? "" : "none";
  }

  const countEl = document.getElementById("search-count");
  if (countEl) countEl.textContent = (q || activeFilter !== "all") ? `${visible} of ${total} items shown` : "";
}

function toggleHeadings(table) {
  // Walk bottom-up: a heading is shown only if a product under it is visible.
  const rows = [...table.querySelectorAll("tbody tr")];
  let catHas = false, subHas = false;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.classList.contains("cat-row")) { r.classList.toggle("row-hidden", !catHas); catHas = false; subHas = false; }
    else if (r.classList.contains("sub-cat-row")) { r.classList.toggle("row-hidden", !subHas); subHas = false; }
    else if (r.dataset.sku && !r.classList.contains("row-hidden")) { catHas = true; subHas = true; }
  }
}
