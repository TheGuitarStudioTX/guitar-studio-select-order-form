// App controller: login gate, navigation, and the order-form view.
import { configured, supabase } from "./supabase.js";
import * as auth from "./auth.js";
import * as catalog from "./catalog.js";
import * as orders from "./orders.js";
import { renderHistory } from "./history.js";
import { renderAdmin } from "./admin.js";
import { openSupplierOrders } from "./supplier.js";
import { fmt, fmtInt, esc, toast, confirmDialog, promptDialog, modal, el } from "./util.js";

const loginScreen = document.getElementById("login-screen");
const appEl = document.getElementById("app");
const msg = document.getElementById("li-msg");
let currentUser = null;
let orderViewReady = false;

// ── Boot ────────────────────────────────────────────────────────────────
if (!configured) {
  showLoginMessage("⚠ Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (see config.js / README).", "err");
  document.getElementById("login-form").querySelectorAll("input,button").forEach((b) => (b.disabled = true));
} else {
  wireLogin();
  auth.onAuthChange(handleAuth);
  auth.currentUser().then(handleAuth);
}

async function handleAuth(user) {
  currentUser = user;
  if (user) {
    loginScreen.hidden = true;
    appEl.hidden = false;
    document.getElementById("who").textContent = user.email;
    auth.myProfile().then((p) => {
      if (p?.full_name && p.full_name !== user.email) document.getElementById("who").textContent = p.full_name;
    });
    await bootApp();
  } else {
    appEl.hidden = true;
    loginScreen.hidden = false;
  }
}

// ── Login ───────────────────────────────────────────────────────────────
function wireLogin() {
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("li-email").value;
    const pw = document.getElementById("li-pw").value;
    if (!pw) return showLoginMessage("Enter your password, or use “Email me a login link”.", "err");
    setBusy(true);
    try { await auth.signInWithPassword(email, pw); }
    catch (err) { showLoginMessage(err.message || "Sign-in failed", "err"); }
    finally { setBusy(false); }
  });

  document.getElementById("li-magic").addEventListener("click", async () => {
    const email = document.getElementById("li-email").value;
    if (!email) return showLoginMessage("Enter your email first.", "err");
    setBusy(true);
    try { await auth.sendMagicLink(email); showLoginMessage("Check your email for a one-time login link.", "ok"); }
    catch (err) { showLoginMessage(err.message || "Could not send link", "err"); }
    finally { setBusy(false); }
  });

  document.getElementById("li-reset").addEventListener("click", async () => {
    const email = document.getElementById("li-email").value;
    if (!email) return showLoginMessage("Enter your email first.", "err");
    setBusy(true);
    try { await auth.sendPasswordReset(email); showLoginMessage("Password reset email sent.", "ok"); }
    catch (err) { showLoginMessage(err.message || "Could not send reset", "err"); }
    finally { setBusy(false); }
  });

  // Handle the password-recovery redirect.
  supabase.auth.onAuthStateChange(async (event) => {
    if (event === "PASSWORD_RECOVERY") {
      const res = await promptDialog({
        title: "Set a new password",
        fields: [{ name: "pw", label: "New password (min 6 characters)", type: "password" }],
        okLabel: "Update password",
      });
      if (res?.pw) { try { await auth.updatePassword(res.pw); toast("Password updated ✓"); } catch (e) { toast(e.message); } }
    }
  });
}
function showLoginMessage(t, cls) { msg.textContent = t; msg.className = "login-msg " + (cls || ""); }
function setBusy(b) { document.getElementById("li-submit").disabled = b; }

document.getElementById("sign-out").addEventListener("click", () => auth.signOut());

// ── App boot ────────────────────────────────────────────────────────────
async function bootApp() {
  wireNav();
  if (!orderViewReady) {
    buildFilterChips();
    wireOrderChrome();
    await initOrderView();
  }
  document.addEventListener("gcs:catalog-changed", reloadCatalog);
}

async function initOrderView() {
  const target = document.getElementById("order-form");
  target.innerHTML = `<p style="padding:2rem;text-align:center" class="muted"><span class="spinner"></span> Loading catalog…</p>`;
  try {
    await catalog.loadCatalog();
    catalog.renderOrderForm(target);
    orders.wireOrderForm(target);
    await orders.initCart(currentUser);
    orders.applyQuantitiesToForm();
    catalog.applyFilters();
    orderViewReady = true;
  } catch (err) {
    showOrderError(err);
  }
}

function showOrderError(err) {
  const msg = (err && err.message) || "Unknown error";
  const looksLikeSession = /timed out|JWT|token|session|auth/i.test(msg);
  document.getElementById("order-form").innerHTML = `
    <div style="max-width:520px;margin:2rem auto;padding:1.4rem 1.5rem;border:1px solid var(--border);border-radius:8px;background:white;text-align:center">
      <div style="font-family:'Libre Baskerville',serif;font-size:16px;color:var(--brown-dark);margin-bottom:0.5rem">Couldn’t load the catalog</div>
      <p class="muted" style="font-size:13px;margin-bottom:1rem">${esc(msg)}.<br>${looksLikeSession ? "Your sign-in may have expired." : "This is usually a temporary connection hiccup."}</p>
      <div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap">
        <button class="btn-primary" id="err-retry">Retry</button>
        <button class="btn-soft" id="err-relogin">Sign in again</button>
      </div>
    </div>`;
  document.getElementById("err-retry").addEventListener("click", initOrderView);
  document.getElementById("err-relogin").addEventListener("click", forceReLogin);
}

async function forceReLogin() {
  try { await auth.signOut(); } catch (e) { /* ignore */ }
  try { Object.keys(localStorage).filter(k => k.startsWith("sb-")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  location.reload();
}

async function reloadCatalog() {
  await catalog.loadCatalog();
  catalog.renderOrderForm(document.getElementById("order-form"));
  orders.applyQuantitiesToForm();
  catalog.applyFilters();
}

// ── Navigation ──────────────────────────────────────────────────────────
function wireNav() {
  document.querySelectorAll("#app > nav .nav-tab").forEach((tab) =>
    tab.addEventListener("click", () => switchView(tab.dataset.view, tab)));
}
let adminLoaded = false;
async function switchView(view, tab) {
  document.querySelectorAll("#app > nav .nav-tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");
  for (const v of ["order", "history", "admin"]) document.getElementById("view-" + v).hidden = (v !== view);
  if (view === "history") await renderHistory(document.getElementById("view-history"));
  if (view === "admin") await renderAdmin(document.getElementById("view-admin"));
}

// ── Order view chrome ───────────────────────────────────────────────────
const CHIPS = [
  ["all", "All"], ["strings", "Strings"], ["accessories", "Accessories"], ["literature", "Literature"], ["|"],
  ["normal", "Normal Tension"], ["hard", "Hard Tension"], ["carbon", "Carbon"], ["nylon", "Nylon"], ["|"],
  ["fullsets", "Full Sets"], ["halfsets", "Half Sets"], ["singles", "Singles"], ["|"],
  ["supports", "Supports & Foot Rests"], ["stands", "Stands & Hangers"], ["care", "Care & Tools"], ["humidity", "Humidity"], ["|"],
  ["instructional", "Instructional"], ["scores", "Scores"], ["flamenco", "Flamenco"], ["|"],
  ["ordered", "⬤ Ordered Only"],
];
function buildFilterChips() {
  const box = document.getElementById("filter-chips");
  box.innerHTML = "";
  for (const [f, label] of CHIPS) {
    if (f === "|") { const d = document.createElement("span"); d.className = "chip-divider"; d.textContent = "·"; box.appendChild(d); continue; }
    const b = document.createElement("button");
    b.className = "chip" + (f === "all" ? " active" : "");
    b.dataset.filter = f; b.textContent = label;
    b.addEventListener("click", () => catalog.setFilter(f, b));
    box.appendChild(b);
  }
}
function wireOrderChrome() {
  const dateEl = document.getElementById("lh-date");
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  document.getElementById("search-input").addEventListener("input", () => catalog.applyFilters());
  document.getElementById("btn-expand").addEventListener("click", () => catalog.expandAll());
  document.getElementById("btn-collapse").addEventListener("click", () => catalog.collapseAll());

  document.getElementById("btn-clear").addEventListener("click", async () => {
    if (await confirmDialog("Clear all quantities from the shared order?", "Clear")) {
      await orders.clearCart(); toast("Cart cleared");
    }
  });

  document.getElementById("btn-supplier").addEventListener("click", () => {
    const lines = orders.getCartLines();
    if (!lines.length) return toast("Add at least one item first.");
    openSupplierOrders(lines, "Current Order (draft)");
  });

  document.getElementById("btn-submit").addEventListener("click", openSubmitModal);
}

// ── Submit review modal ─────────────────────────────────────────────────
function openSubmitModal() {
  const lines = orders.getCartLines();
  if (!lines.length) return toast("Add at least one item first.");

  // group by brand for a quick review
  const byBrand = new Map();
  let total = 0, units = 0;
  for (const ln of lines) {
    const g = byBrand.get(ln.brand_name) || { qty: 0, total: 0 };
    g.qty += ln.qty; g.total += (Number(ln.dealer_cost) || 0) * ln.qty;
    byBrand.set(ln.brand_name, g);
    total += (Number(ln.dealer_cost) || 0) * ln.qty; units += ln.qty;
  }
  const rows = [...byBrand.entries()].map(([b, g]) =>
    `<tr><td>${esc(b)}</td><td class="num">${fmtInt(g.qty)}</td><td class="num">${fmt(g.total)}</td></tr>`).join("");

  const body = el("div", {});
  body.innerHTML =
    `<div class="submit-summary"><table><thead><tr><td><strong>Brand</strong></td><td class="num"><strong>Units</strong></td><td class="num"><strong>Dealer</strong></td></tr></thead><tbody>${rows}</tbody></table></div>` +
    `<div class="submit-totals"><span>${fmtInt(units)} units across ${byBrand.size} brand(s)</span><span>${fmt(total)}</span></div>` +
    `<div class="field" style="margin-top:0.9rem"><label>Order label (optional)</label><input id="sm-label" placeholder="e.g. June restock" style="width:100%"></div>` +
    `<div class="field" style="margin-top:0.6rem"><label>Notes (optional)</label><textarea id="sm-notes" rows="2" style="width:100%"></textarea></div>`;

  modal({
    title: "Submit order", width: 460, bodyNode: body,
    actions: [
      { label: "Cancel", onClick: (c) => c() },
      { label: "Submit order", class: "btn-primary", onClick: async (close) => {
        const label = body.querySelector("#sm-label").value.trim();
        const notes = body.querySelector("#sm-notes").value.trim();
        const snapshot = orders.getCartLines();
        try {
          await orders.submitOrder({ label, notes });
          close();
          if (await confirmDialog("Order submitted ✓ Generate the per-distributor purchase orders now?", "Open orders")) {
            openSupplierOrders(snapshot, label || "Submitted order");
          }
        } catch (err) { toast(err.message); }
      } },
    ],
  });
}
