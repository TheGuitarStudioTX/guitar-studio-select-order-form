// Shared helpers.
export const fmt = (n) => "$" + (Number(n) || 0).toFixed(2);
export const fmtInt = (n) => (Number(n) || 0).toLocaleString();

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Reject if a promise doesn't settle in time — so a hung network/auth call
// surfaces as a recoverable error instead of an infinite spinner.
export function withTimeout(promise, ms, label = "Request") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ]);
}

export function debounce(fn, ms = 400) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
export function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

// Modal shell that works in sandboxed iframes (native confirm/prompt may be blocked).
export function modal({ title, bodyNode, width = 380, actions = [] }) {
  const ov = el("div", { class: "no-print modal-overlay" });
  const box = el("div", { class: "modal-box", style: `max-width:${width}px` });
  if (title) box.appendChild(el("h3", { class: "modal-title" }, title));
  if (bodyNode) box.appendChild(bodyNode);
  const bar = el("div", { class: "modal-actions" });
  const close = () => ov.remove();
  for (const a of actions) {
    const b = el("button", { class: a.class || "btn-soft", onclick: () => a.onClick(close) }, a.label);
    bar.appendChild(b);
  }
  box.appendChild(bar);
  ov.appendChild(box);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) close(); });
  document.addEventListener("keydown", function onEsc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); } });
  document.body.appendChild(ov);
  return { close, box };
}

export function confirmDialog(msg, yesLabel = "Confirm") {
  return new Promise((resolve) => {
    const body = el("div", { class: "modal-msg", html: esc(msg) });
    modal({ bodyNode: body, actions: [
      { label: "Cancel", onClick: (c) => { c(); resolve(false); } },
      { label: yesLabel, class: "btn-primary", onClick: (c) => { c(); resolve(true); } },
    ] });
  });
}

// promptDialog({ title, fields:[{name,label,type,placeholder,value,rows}], okLabel })
// resolves to a {name: value} object, or null if cancelled.
export function promptDialog({ title, fields = [], okLabel = "OK", width = 420 }) {
  return new Promise((resolve) => {
    const body = el("div", {});
    const inputs = {};
    for (const f of fields) {
      const wrap = el("div", { class: "field", style: "margin-bottom:0.7rem" });
      wrap.appendChild(el("label", {}, f.label || f.name));
      const inp = f.type === "textarea"
        ? el("textarea", { rows: f.rows || 3, placeholder: f.placeholder || "" })
        : el("input", { type: f.type || "text", placeholder: f.placeholder || "" });
      if (f.value) inp.value = f.value;
      inp.style.width = "100%";
      inputs[f.name] = inp;
      wrap.appendChild(inp);
      body.appendChild(wrap);
    }
    const m = modal({ title, bodyNode: body, width, actions: [
      { label: "Cancel", onClick: (c) => { c(); resolve(null); } },
      { label: okLabel, class: "btn-primary", onClick: (c) => {
        c(); resolve(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value.trim()])));
      } },
    ] });
    const first = Object.values(inputs)[0];
    if (first) setTimeout(() => first.focus(), 30);
  });
}
