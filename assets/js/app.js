/* ============================================================
   Santería Arkangel — lógica de sitio (vanilla JS, sin frameworks)
   Todo se conecta a los endpoints PHP dentro de /api
============================================================ */

let CATEGORIES = []; // se carga desde api/categories.php (editable por el administrador)
const ORDER_STATUSES = ["Pendiente", "Confirmado", "Listo para despachar", "Despachado", "Entregado", "Cancelado"];

let STATE = {
  settings: {},
  products: [],
  activeCategory: "Todas",
  query: "",
  pageSize: 12,
  viewFilter: null, // "novedades" | "ofertas" | null
  cart: [],
  customer: null, // { name, email, phone, address, city, province, postal_code } o null
  isAdmin: false,
};

/* ---------------- API helper ---------------- */
let CSRF_TOKEN = null;

async function api(path, { method = "GET", json = null, form = null } = {}) {
  const opts = { method, credentials: "include" };
  const headers = {};
  if (method !== "GET" && CSRF_TOKEN) headers["X-CSRF-Token"] = CSRF_TOKEN;
  if (json) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(json);
  } else if (form) {
    opts.body = form; // FormData: el navegador setea el Content-Type solo
  }
  opts.headers = headers;
  const res = await fetch("api/" + path, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    throw new Error(data.error || "Ocurrió un error inesperado.");
  }
  return data;
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("es-AR");
}

function priceForQty(tiers, qty) {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  let price = sorted[0]?.price ?? 0;
  for (const t of sorted) if (qty >= t.minQty) price = t.price;
  return price;
}

// Si el producto está marcado como oferta, el precio de oferta reemplaza el
// escalón base (1 unidad); los descuentos por cantidad más altos se siguen
// aplicando normalmente arriba de eso.
function effectiveTiers(p, tiersList) {
  const base = tiersList && tiersList.length ? tiersList : p.tiers;
  const sorted = [...base].sort((a, b) => a.minQty - b.minQty);
  if (p.isOffer && p.offerPrice) {
    sorted[0] = { ...sorted[0], price: p.offerPrice };
  }
  return sorted;
}

// Si la opción elegida (ej: "7 colores", "Combinado Blanco/Negro") tiene su propia
// tabla de precios por cantidad, se usa esa en vez de la tabla general del producto.
function resolveTiersForSelection(product, selection) {
  for (const g of product.variantGroups || []) {
    const opt = g.options.find(o => o.id === selection[g.id]);
    if (opt && opt.tiers && opt.tiers.length) return opt.tiers;
  }
  return product.tiers;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ---------------- Carrito (localStorage) ---------------- */
function loadCart() {
  try { STATE.cart = JSON.parse(localStorage.getItem("arkangel_cart") || "[]"); } catch (e) { STATE.cart = []; }
}
function saveCart() {
  localStorage.setItem("arkangel_cart", JSON.stringify(STATE.cart));
  renderCartBadge();
}
function renderCartBadge() {
  const total = STATE.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const count = STATE.cart.reduce((s, l) => s + l.qty, 0);
  document.getElementById("cart-total").textContent = fmt(total);
  const badge = document.getElementById("cart-count");
  if (count > 0) { badge.textContent = count; badge.classList.remove("hidden"); }
  else { badge.classList.add("hidden"); }
}

/* ---------------- Overlays genéricos ---------------- */
function open(id) { document.getElementById(id).classList.remove("hidden"); }
function close(id) { document.getElementById(id).classList.add("hidden"); }

document.addEventListener("click", (e) => {
  if (e.target.dataset.close) close(e.target.dataset.close);
  if (e.target.classList.contains("overlay") || e.target.classList.contains("drawer-overlay")) {
    e.target.classList.add("hidden");
  }
});

/* ============================================================
   Carga inicial
============================================================ */
async function loadSettings() {
  STATE.settings = await api("settings.php");
  const s = STATE.settings;
  document.getElementById("brand-name").textContent = s.store_name || "Santería Arkangel";
  document.getElementById("footer-name").textContent = s.store_name || "Santería Arkangel";
  document.getElementById("footer-year").textContent = new Date().getFullYear();
  if (s.store_logo) document.getElementById("brand-logo").src = s.store_logo;
  document.getElementById("about-summary").textContent = s.about_summary || "";

  const hero = document.getElementById("hero");
  if (s.hero_image) {
    hero.classList.add("has-image");
    hero.style.backgroundImage = `url(${s.hero_image})`;
  } else {
    hero.classList.remove("has-image");
    hero.style.backgroundImage = "";
  }

  const catalogLink = document.getElementById("catalog-link");
  if (s.catalog_pdf) {
    catalogLink.href = s.catalog_pdf;
    catalogLink.classList.remove("hidden");
  }

  const wa = document.getElementById("wa-float");
  if (s.whatsapp) {
    wa.href = `https://wa.me/${s.whatsapp.replace(/\D/g, "")}`;
    wa.classList.remove("hidden");
  }
}

async function loadCategories() {
  CATEGORIES = await api("categories.php");
}

async function loadProducts() {
  STATE.products = await api("products.php");
  renderHeroCategories();
  renderCategories();
  renderGrid();
}

function renderHeroCategories() {
  const rowWrap = document.getElementById("hero-categories");
  const dropdownWrap = document.getElementById("hero-cat-dropdown");
  const toggle = document.getElementById("hero-cat-toggle");

  const btnHtml = (extraClass) => CATEGORIES.map(c =>
    `<button class="${extraClass}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join("");

  rowWrap.innerHTML = btnHtml("hero-cat-btn");
  dropdownWrap.innerHTML = btnHtml("");

  function goToCategory(cat) {
    STATE.activeCategory = cat;
    renderCategories();
    renderGrid();
    dropdownWrap.classList.remove("open");
    document.getElementById("product-grid").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  rowWrap.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => goToCategory(btn.dataset.cat)));
  dropdownWrap.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => goToCategory(btn.dataset.cat)));

  toggle.onclick = (e) => {
    e.stopPropagation();
    dropdownWrap.classList.toggle("open");
  };
  document.addEventListener("click", (e) => {
    if (!dropdownWrap.contains(e.target) && e.target !== toggle) dropdownWrap.classList.remove("open");
  });
}

function isNewProduct(createdAt) {
  if (!createdAt) return false;
  const created = new Date(createdAt.replace(" ", "T"));
  const days = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  return days <= 30;
}

/* ============================================================
   Catálogo: categorías y grilla
============================================================ */
function renderCategories() {
  const wrap = document.getElementById("category-scroll");
  const cats = ["Todas", ...CATEGORIES];
  wrap.innerHTML = cats.map(c =>
    `<button class="chip ${STATE.activeCategory === c ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join("");
  wrap.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      STATE.activeCategory = btn.dataset.cat;
      renderCategories();
      renderGrid();
    });
  });
}

document.getElementById("search-input").addEventListener("input", (e) => {
  STATE.query = e.target.value;
  renderGrid();
});

document.getElementById("page-size-select").addEventListener("change", (e) => {
  STATE.pageSize = e.target.value === "all" ? Infinity : Number(e.target.value);
  renderGrid();
});

function renderGrid() {
  const grid = document.getElementById("product-grid");
  let filtered = STATE.products.filter(p => {
    const matchesCat = STATE.activeCategory === "Todas" || p.category === STATE.activeCategory;
    const matchesQuery = p.name.toLowerCase().includes(STATE.query.toLowerCase());
    return matchesCat && matchesQuery;
  });
  if (STATE.viewFilter === "novedades") filtered = filtered.filter(p => isNewProduct(p.createdAt));
  if (STATE.viewFilter === "ofertas") filtered = filtered.filter(p => p.isOffer);

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color:var(--muted); grid-column: 1/-1;">No hay productos que coincidan con tu búsqueda.</p>`;
    return;
  }

  const shown = filtered.slice(0, STATE.pageSize);

  grid.innerHTML = shown.map(p => {
    const minPrice = priceForQty(effectiveTiers(p, p.tiers), 1);
    const baseMinPrice = Math.min(...p.tiers.map(t => t.price));
    const badges = [];
    if (p.isOffer) badges.push(`<span class="badge offer">Oferta</span>`);
    if (isNewProduct(p.createdAt)) badges.push(`<span class="badge new">Nuevo</span>`);
    if (p.inStock === false) badges.push(`<span class="badge" style="background:#5f6b73;">Agotado</span>`);
    const priceHtml = (p.isOffer && p.offerPrice)
      ? `<span class="old">${fmt(baseMinPrice)}</span>${fmt(minPrice)}`
      : `Desde ${fmt(minPrice)}`;
    return `
      <button class="card" data-id="${p.id}">
        ${badges.join("")}
        <div class="thumb">${p.image ? `<img src="${p.image}" alt="${escapeHtml(p.name)}">` : `<span class="wing-icon">🕊️</span>`}</div>
        <div class="body">
          <p class="cat">${escapeHtml(p.category)}</p>
          <h3 class="display">${escapeHtml(p.name)}</h3>
          <p class="price">${priceHtml}</p>
        </div>
      </button>`;
  }).join("");

  if (filtered.length > shown.length) {
    grid.insertAdjacentHTML("beforeend", `<p class="load-more-wrap" style="color:var(--muted); font-size:0.8rem;">Mostrando ${shown.length} de ${filtered.length} productos — elegí "Mostrar todos" para verlos todos.</p>`);
  }

  grid.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => openProduct(Number(card.dataset.id)));
  });
}

/* ============================================================
   Modal de producto
============================================================ */
let PRODUCT_SELECTION = {};

function currentProductImage(product, selection) {
  for (const g of product.variantGroups || []) {
    const optId = selection[g.id];
    const opt = g.options.find(o => o.id === optId);
    if (opt?.image) return opt.image;
  }
  return product.image || "";
}
function optionsLabel(product, selection) {
  return (product.variantGroups || [])
    .map(g => {
      const opt = g.options.find(o => o.id === selection[g.id]);
      return opt ? `${g.name}: ${opt.value}` : null;
    })
    .filter(Boolean).join(" · ");
}

function openProduct(id) {
  const p = STATE.products.find(x => x.id === id);
  if (!p) return;
  PRODUCT_SELECTION = {};
  (p.variantGroups || []).forEach(g => { if (g.options[0]) PRODUCT_SELECTION[g.id] = g.options[0].id; });
  renderProductModal(p, 1);
  open("modal-product");
}

function renderProductModal(p, qty) {
  const maxQty = (typeof p.stock === "number") ? p.stock : Infinity;
  let hitLimit = false;
  if (qty > maxQty) { qty = maxQty; hitLimit = true; }
  if (qty < 1) qty = 1;

  const activeTiers = resolveTiersForSelection(p, PRODUCT_SELECTION);
  const price = priceForQty(effectiveTiers(p, activeTiers), qty);
  const img = currentProductImage(p, PRODUCT_SELECTION);
  const groupsHtml = (p.variantGroups || []).map(g => `
    <div class="field">
      <label class="field-label">${escapeHtml(g.name)}</label>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${g.options.map(o => `
          <button class="chip variant-opt ${PRODUCT_SELECTION[g.id] === o.id ? "active" : ""}" data-group="${g.id}" data-option="${o.id}">${escapeHtml(o.value)}</button>
        `).join("")}
      </div>
    </div>`).join("");

  const tiersHtml = activeTiers.length > 1 ? `
    <ul style="font-size:0.78rem; color:var(--muted); margin: 8px 0 0; padding-left: 18px;">
      ${effectiveTiers(p, activeTiers).map(t => `<li>${t.minQty}+ unidades: ${fmt(t.price)} c/u</li>`).join("")}
    </ul>` : "";

  const limitWarning = hitLimit
    ? `<p style="color:var(--danger); font-size:0.78rem; margin-top:6px;">Solo quedan ${maxQty} unidades disponibles.</p>`
    : "";

  document.getElementById("product-detail-content").innerHTML = `
    <div class="thumb" style="aspect-ratio:16/9; border-radius:10px; margin-bottom:14px;">
      ${img ? `<img src="${img}" alt="${escapeHtml(p.name)}">` : `<span style="font-size:2rem;">🕊️</span>`}
    </div>
    <p class="cat" style="color:var(--accent); text-transform:uppercase; font-size:0.75rem;">${escapeHtml(p.category)}</p>
    <h3 class="display" style="font-size:1.5rem; margin: 4px 0;">${escapeHtml(p.name)}</h3>
    <p style="color:var(--muted); font-size:0.9rem;">${escapeHtml(p.description || "")}</p>
    ${groupsHtml}
    <div class="field">
      <label class="field-label">Cantidad</label>
      <div class="qty-control">
        <button class="qty-btn" id="qty-minus">−</button>
        <input type="number" min="1" max="${maxQty === Infinity ? "" : maxQty}" id="qty-value" value="${qty}" style="width:56px; text-align:center; padding:6px 4px;">
        <button class="qty-btn" id="qty-plus" ${qty >= maxQty ? "disabled style=\"opacity:0.4;\"" : ""}>+</button>
      </div>
      ${limitWarning}
      ${tiersHtml}
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin: 14px 0;">
      <span style="color:var(--muted);">Subtotal</span>
      <span class="display" style="font-size:1.3rem; color:var(--accent);" id="product-subtotal">${fmt(price * qty)}</span>
    </div>
    ${p.inStock === false
      ? `<div style="text-align:center; padding:12px; border-radius:10px; background:var(--panel); border:1px solid var(--line); color:var(--muted); font-weight:600;">Agotado por el momento</div>`
      : `<button class="btn-primary" id="add-to-cart-btn">Agregar al carrito</button>`}
  `;

  document.querySelectorAll(".variant-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      PRODUCT_SELECTION[btn.dataset.group] = Number(btn.dataset.option) || btn.dataset.option;
      renderProductModal(p, qty);
    });
  });
  document.getElementById("qty-minus").addEventListener("click", () => renderProductModal(p, Math.max(1, qty - 1)));
  document.getElementById("qty-plus").addEventListener("click", () => renderProductModal(p, qty + 1));
  const qtyInput = document.getElementById("qty-value");
  qtyInput.addEventListener("change", () => {
    const val = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    renderProductModal(p, val);
  });
  qtyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") qtyInput.blur();
  });
  document.getElementById("add-to-cart-btn")?.addEventListener("click", () => {
    const activeTiers = resolveTiersForSelection(p, PRODUCT_SELECTION);
    const unitPrice = priceForQty(effectiveTiers(p, activeTiers), qty);
    STATE.cart.push({
      lineId: uid(), productId: p.id, name: p.name,
      label: optionsLabel(p, PRODUCT_SELECTION),
      image: currentProductImage(p, PRODUCT_SELECTION),
      selection: { ...PRODUCT_SELECTION },
      tiersUsed: activeTiers,
      qty, unitPrice,
    });
    saveCart();
    close("modal-product");
    renderCartDrawer();
    open("drawer-cart");
  });
}

/* ============================================================
   Carrito
============================================================ */
document.getElementById("btn-cart").addEventListener("click", () => { renderCartDrawer(); open("drawer-cart"); });

function renderCartDrawer() {
  const itemsEl = document.getElementById("cart-items");
  const footerEl = document.getElementById("cart-footer");

  if (STATE.cart.length === 0) {
    itemsEl.innerHTML = `<p style="color:var(--muted); font-size:0.9rem;">Todavía no agregaste productos.</p>`;
    footerEl.innerHTML = "";
    return;
  }

  itemsEl.innerHTML = STATE.cart.map(l => `
    <div class="admin-row" data-line="${l.lineId}">
      <div class="thumb-sm">${l.image ? `<img src="${l.image}">` : "🕊️"}</div>
      <div class="grow">
        <p>${escapeHtml(l.name)}</p>
        <p class="muted">${escapeHtml(l.label || "")} · ${fmt(l.unitPrice)} c/u</p>
        <div class="qty-control" style="margin-top:6px;">
          <button class="qty-btn qty-dec" style="width:24px;height:24px;">−</button>
          <span>${l.qty}</span>
          <button class="qty-btn qty-inc" style="width:24px;height:24px;">+</button>
        </div>
      </div>
      <div style="text-align:right;">
        <p style="color:var(--accent); margin:0;">${fmt(l.unitPrice * l.qty)}</p>
        <button class="btn-danger remove-line" style="margin-top:8px;">🗑</button>
      </div>
    </div>
  `).join("");

  const total = STATE.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  footerEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
      <span style="color:var(--muted);">Total</span>
      <span class="display" style="font-size:1.3rem; color:var(--accent);">${fmt(total)}</span>
    </div>
    <button class="btn-primary" id="go-checkout">Ir a pagar</button>
  `;

  itemsEl.querySelectorAll(".admin-row").forEach(row => {
    const lineId = row.dataset.line;
    row.querySelector(".qty-inc").addEventListener("click", () => changeLineQty(lineId, 1));
    row.querySelector(".qty-dec").addEventListener("click", () => changeLineQty(lineId, -1));
    row.querySelector(".remove-line").addEventListener("click", () => {
      STATE.cart = STATE.cart.filter(l => l.lineId !== lineId);
      saveCart(); renderCartDrawer();
    });
  });
  document.getElementById("go-checkout").addEventListener("click", () => {
    close("drawer-cart");
    openCheckout();
  });
}

function changeLineQty(lineId, delta) {
  const line = STATE.cart.find(l => l.lineId === lineId);
  if (!line) return;
  const product = STATE.products.find(p => p.id === line.productId);
  const maxQty = (product && typeof product.stock === "number") ? product.stock : Infinity;
  let newQty = Math.max(1, line.qty + delta);
  if (newQty > maxQty) {
    newQty = maxQty;
    showToast(`Solo quedan ${maxQty} unidades disponibles de "${line.name}".`);
  }
  line.qty = newQty;
  if (product) {
    line.unitPrice = priceForQty(effectiveTiers(product, line.tiersUsed), newQty);
  }
  saveCart();
  renderCartDrawer();
}

/* ============================================================
   Checkout
============================================================ */
let CHECKOUT_PAY_METHOD = "transferencia";

function openCheckout() {
  CHECKOUT_PAY_METHOD = "transferencia";
  renderCheckout();
  open("modal-checkout");
}

function renderCheckout() {
  const total = STATE.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const s = STATE.settings;

  if (!STATE.customer) {
    document.getElementById("checkout-content").innerHTML = `
      <h3 class="display" style="font-size:1.5rem;">Finalizar pedido</h3>
      <p style="color:var(--muted); font-size:0.9rem;">Necesitás iniciar sesión (o crear una cuenta gratis) para completar tu pedido y poder hacerle seguimiento.</p>
      <button class="btn-primary" id="checkout-login-btn">Iniciar sesión / Crear cuenta</button>
    `;
    document.getElementById("checkout-login-btn").addEventListener("click", () => {
      close("modal-checkout");
      openAccount("login");
    });
    return;
  }

  document.getElementById("checkout-content").innerHTML = `
    <h3 class="display" style="font-size:1.5rem; margin-bottom:12px;">Finalizar pedido</h3>

    <label class="field-label" style="display:block; margin-bottom:8px;">Tu pedido</label>
    <div id="checkout-items" style="margin-bottom:16px;"></div>

    <p style="font-size:0.85rem; color: var(--muted);">Se va a enviar a:</p>
    <p style="font-size:0.9rem; margin-top:2px;">${escapeHtml(STATE.customer.name)} — ${escapeHtml(STATE.customer.address || "sin dirección cargada")}, ${escapeHtml(STATE.customer.city || "")}</p>
    <p style="font-size:0.8rem; color:var(--muted); margin-bottom:14px;"><a href="#" id="edit-shipping-link" style="color:var(--accent);">Editar datos de envío</a></p>

    <label class="field-label">Método de pago</label>
    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <button class="chip pay-opt ${CHECKOUT_PAY_METHOD === "transferencia" ? "active" : ""}" data-pay="transferencia" style="flex:1;">Transferencia</button>
      <button class="chip pay-opt ${CHECKOUT_PAY_METHOD === "mercadopago" ? "active" : ""}" data-pay="mercadopago" style="flex:1;">Mercado Pago</button>
    </div>

    <div id="pay-details" style="background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; font-size:0.85rem; margin-bottom:14px;"></div>

    <p style="font-size:0.78rem; color:var(--muted); margin-bottom:14px;">⏳ La confirmación del pago y la preparación del pedido pueden demorar hasta 48hs.</p>

    <div style="display:flex; justify-content:space-between; margin-bottom:14px;">
      <span style="color:var(--muted);">Total a pagar</span>
      <span class="display" style="font-size:1.3rem; color:var(--accent);" id="checkout-total">${fmt(total)}</span>
    </div>

    <button class="btn-primary" id="confirm-order-btn">Confirmar pedido</button>
  `;

  function renderCheckoutItems() {
    const wrap = document.getElementById("checkout-items");
    wrap.innerHTML = STATE.cart.map(l => `
      <div class="admin-row" data-line="${l.lineId}">
        <div class="thumb-sm">${l.image ? `<img src="${l.image}">` : "🕊️"}</div>
        <div class="grow">
          <p>${escapeHtml(l.name)}</p>
          <p class="muted">${escapeHtml(l.label || "")} · ${fmt(l.unitPrice)} c/u</p>
          <div class="qty-control" style="margin-top:6px;">
            <button class="qty-btn co-qty-dec" style="width:24px;height:24px;">−</button>
            <input type="number" min="1" class="co-qty-input" value="${l.qty}" style="width:44px; text-align:center; padding:4px 2px;">
            <button class="qty-btn co-qty-inc" style="width:24px;height:24px;">+</button>
          </div>
        </div>
        <div style="text-align:right;">
          <p style="color:var(--accent); margin:0; font-weight:600;">${fmt(l.unitPrice * l.qty)}</p>
        </div>
      </div>
    `).join("");

    wrap.querySelectorAll(".admin-row").forEach(row => {
      const lineId = row.dataset.line;
      row.querySelector(".co-qty-inc").addEventListener("click", () => { changeLineQty(lineId, 1); refreshCheckoutTotals(); });
      row.querySelector(".co-qty-dec").addEventListener("click", () => { changeLineQty(lineId, -1); refreshCheckoutTotals(); });
      row.querySelector(".co-qty-input").addEventListener("change", (e) => {
        const line = STATE.cart.find(l => l.lineId === lineId);
        const newQty = Math.max(1, parseInt(e.target.value, 10) || 1);
        changeLineQty(lineId, newQty - line.qty);
        refreshCheckoutTotals();
      });
    });
  }

  function refreshCheckoutTotals() {
    renderCheckoutItems();
    const newTotal = STATE.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    document.getElementById("checkout-total").textContent = fmt(newTotal);
  }

  renderCheckoutItems();
  renderPayDetails();

  document.querySelectorAll(".pay-opt").forEach(btn => {
    btn.addEventListener("click", () => { CHECKOUT_PAY_METHOD = btn.dataset.pay; renderCheckout(); });
  });
  document.getElementById("edit-shipping-link").addEventListener("click", (e) => {
    e.preventDefault(); close("modal-checkout"); openAccount("profile");
  });
  document.getElementById("confirm-order-btn").addEventListener("click", submitOrder);

  function renderPayDetails() {
    const box = document.getElementById("pay-details");
    if (CHECKOUT_PAY_METHOD === "transferencia") {
      box.innerHTML = `
        <p>Titular: ${escapeHtml(s.titular || "— a configurar —")}</p>
        <p>Alias: ${escapeHtml(s.alias || "— a configurar —")}</p>
        <p>CBU: ${escapeHtml(s.cbu || "— a configurar —")}</p>`;
    } else {
      box.innerHTML = s.mp_link
        ? `<a href="${s.mp_link}" target="_blank" rel="noreferrer" style="color:var(--accent);">Abrir link de pago de Mercado Pago →</a>`
        : `<p style="color:var(--muted);">Todavía no hay un link de Mercado Pago configurado.</p>`;
    }
  }
}

async function submitOrder() {
  const total = STATE.cart.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  try {
    const result = await api("orders.php", {
      method: "POST",
      json: { action: "create", items: STATE.cart, paymentMethod: CHECKOUT_PAY_METHOD },
    });
    STATE.cart = [];
    saveCart();
    close("modal-checkout");
    showToast(`¡Pedido #${result.orderId} creado! Podés verlo en Mi cuenta > Mis pedidos.`);

    if (STATE.settings.whatsapp) {
      const lines = [];
      const text = [
        `Hola! Acabo de hacer el pedido #${result.orderId} en ${STATE.settings.store_name || "la tienda"}.`,
        `Total: ${fmt(total)}`,
        `Método de pago: ${CHECKOUT_PAY_METHOD === "transferencia" ? "Transferencia bancaria" : "Mercado Pago"}`,
      ].join("\n");
      window.open(`https://wa.me/${STATE.settings.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`, "_blank");
    }
  } catch (e) {
    showToast(e.message);
  }
}

/* ============================================================
   Cuenta de cliente: login, registro, perfil, pedidos
============================================================ */
async function refreshCustomerSession() {
  try {
    const res = await api("customer_session.php");
    STATE.customer = res.loggedIn ? res.profile : null;
  } catch (e) { STATE.customer = null; }
  document.getElementById("btn-account").textContent = STATE.customer ? `Hola, ${STATE.customer.name.split(" ")[0]}` : "Mi cuenta";
}

document.getElementById("btn-account").addEventListener("click", () => openAccount(STATE.customer ? "profile" : "login"));

function openAccount(tab) {
  renderAccount(tab);
  open("modal-account");
}

function renderAccount(tab) {
  const el = document.getElementById("account-content");

  if (!STATE.customer) {
    el.innerHTML = `
      <div class="tabs">
        <button class="tab-btn ${tab === "login" ? "active" : ""}" data-tab="login">Iniciar sesión</button>
        <button class="tab-btn ${tab === "register" ? "active" : ""}" data-tab="register">Crear cuenta</button>
      </div>
      <div id="account-tab-body"></div>
    `;
    el.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => renderAccount(b.dataset.tab)));

    const body = document.getElementById("account-tab-body");
    if (tab === "register") {
      body.innerHTML = `
        <div class="field"><label class="field-label">Nombre y apellido</label><input type="text" id="reg-name"></div>
        <div class="field"><label class="field-label">Email</label><input type="email" id="reg-email"></div>
        <div class="field"><label class="field-label">Teléfono</label><input type="tel" id="reg-phone"></div>
        <div class="field"><label class="field-label">Contraseña</label><input type="password" id="reg-pass" minlength="8" placeholder="Mínimo 8 caracteres"></div>
        <p class="error-text hidden" id="reg-error"></p>
        <button class="btn-primary" id="reg-submit">Crear cuenta</button>
      `;
      document.getElementById("reg-submit").addEventListener("click", async () => {
        try {
          await api("register.php", { method: "POST", json: {
            name: document.getElementById("reg-name").value,
            email: document.getElementById("reg-email").value,
            phone: document.getElementById("reg-phone").value,
            pass: document.getElementById("reg-pass").value,
          }});
          await refreshCustomerSession();
          renderAccount("profile");
        } catch (e) {
          const err = document.getElementById("reg-error");
          err.textContent = e.message; err.classList.remove("hidden");
        }
      });
    } else {
      body.innerHTML = `
        <div class="field"><label class="field-label">Email</label><input type="email" id="login-email"></div>
        <div class="field"><label class="field-label">Contraseña</label><input type="password" id="login-pass"></div>
        <p class="error-text hidden" id="login-error"></p>
        <button class="btn-primary" id="login-submit">Entrar</button>
      `;
      document.getElementById("login-submit").addEventListener("click", async () => {
        try {
          await api("customer_login.php", { method: "POST", json: {
            email: document.getElementById("login-email").value,
            pass: document.getElementById("login-pass").value,
          }});
          await refreshCustomerSession();
          renderAccount("profile");
        } catch (e) {
          const err = document.getElementById("login-error");
          err.textContent = e.message; err.classList.remove("hidden");
        }
      });
    }
    return;
  }

  // Cliente logueado: perfil / pedidos
  el.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${tab !== "orders" ? "active" : ""}" data-tab="profile">Mi perfil</button>
      <button class="tab-btn ${tab === "orders" ? "active" : ""}" data-tab="orders">Mis pedidos</button>
      <button class="btn-secondary" id="logout-btn" style="margin-left:auto;">Cerrar sesión</button>
    </div>
    <div id="account-tab-body"></div>
  `;
  el.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => renderAccount(b.dataset.tab)));
  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("customer_logout.php", { method: "POST", json: {} });
    STATE.customer = null;
    document.getElementById("btn-account").textContent = "Mi cuenta";
    renderAccount("login");
  });

  const body = document.getElementById("account-tab-body");
  if (tab === "orders") {
    body.innerHTML = `<p style="color:var(--muted); font-size:0.85rem;">Cargando…</p>`;
    api("orders.php?scope=mine").then(orders => {
      if (orders.length === 0) {
        body.innerHTML = `<p style="color:var(--muted); font-size:0.9rem;">Todavía no hiciste ningún pedido.</p>`;
        return;
      }
      const s = STATE.settings;
      const inProcess = ["Pendiente", "Confirmado", "Listo para despachar"];
      body.innerHTML = orders.map(o => {
        const methodLabel = o.paymentMethod === "mercadopago" ? "Mercado Pago" : "Transferencia bancaria";
        let extra = "";

        if (o.status === "Pendiente") {
          extra += `<div style="margin-top:8px; padding:8px; border-radius:8px; background:#fff4e0; color:#8a5a00; font-size:0.8rem; font-weight:600;">⏳ Pendiente de confirmación de pago</div>`;
          if (o.paymentMethod !== "mercadopago") {
            extra += `
              <div style="margin-top:6px; padding:8px; border-radius:8px; background:var(--bg-alt); font-size:0.8rem;">
                <p>Titular: ${escapeHtml(s.titular || "— a configurar —")}</p>
                <p>Alias: ${escapeHtml(s.alias || "— a configurar —")}</p>
                <p>CBU: ${escapeHtml(s.cbu || "— a configurar —")}</p>
              </div>`;
          }
        }
        if (inProcess.includes(o.status)) {
          extra += `<p style="margin-top:6px; font-size:0.75rem; color:var(--muted);">La confirmación del pago y la preparación del pedido pueden demorar hasta 48hs.</p>`;
        }
        if (o.status === "Despachado" && (o.trackingCode || o.carrier)) {
          const carrierHtml = o.carrier && /^https?:\/\//.test(o.carrier)
            ? `<a href="${o.carrier}" target="_blank" rel="noreferrer" style="color:var(--accent);">${escapeHtml(o.carrier)}</a>`
            : escapeHtml(o.carrier || "");
          extra += `
            <div style="margin-top:8px; padding:8px; border-radius:8px; background:#e6f7ee; color:#1a6b3f; font-size:0.8rem;">
              📦 Despachado ${o.trackingCode ? `— Seguimiento: <strong>${escapeHtml(o.trackingCode)}</strong>` : ""} ${carrierHtml ? `<br>${carrierHtml}` : ""}
            </div>`;
        }

        return `
        <div class="order-card">
          <span class="status">${escapeHtml(o.status)}</span>
          <p style="margin:4px 0;">Pedido #${o.id} — ${new Date(o.createdAt.replace(" ", "T")).toLocaleDateString("es-AR")}</p>
          ${o.items.map(it => `<p style="margin:2px 0; color:var(--muted);">${it.qty}x ${escapeHtml(it.name)} ${it.label ? `(${escapeHtml(it.label)})` : ""}</p>`).join("")}
          <p style="margin-top:6px; font-weight:600;">Total: ${fmt(o.total)}</p>
          <p style="font-size:0.78rem; color:var(--muted);">Método de pago: ${methodLabel}</p>
          ${extra}
        </div>
      `;
      }).join("");
    });
  } else {
    const c = STATE.customer;
    body.innerHTML = `
      <div class="field"><label class="field-label">Nombre y apellido</label><input type="text" id="pf-name" value="${escapeHtml(c.name)}"></div>
      <div class="field"><label class="field-label">Email</label><input type="email" value="${escapeHtml(c.email)}" disabled></div>
      <div class="field"><label class="field-label">Teléfono</label><input type="tel" id="pf-phone" value="${escapeHtml(c.phone || "")}"></div>
      <div class="field"><label class="field-label">Dirección</label><input type="text" id="pf-address" value="${escapeHtml(c.address || "")}"></div>
      <div class="field"><label class="field-label">Ciudad</label><input type="text" id="pf-city" value="${escapeHtml(c.city || "")}"></div>
      <div class="field"><label class="field-label">Provincia</label><input type="text" id="pf-province" value="${escapeHtml(c.province || "")}"></div>
      <div class="field"><label class="field-label">Código postal</label><input type="text" id="pf-postal" value="${escapeHtml(c.postal_code || "")}"></div>
      <button class="btn-primary" id="pf-save">Guardar datos</button>
    `;
    document.getElementById("pf-save").addEventListener("click", async () => {
      const payload = {
        name: document.getElementById("pf-name").value,
        phone: document.getElementById("pf-phone").value,
        address: document.getElementById("pf-address").value,
        city: document.getElementById("pf-city").value,
        province: document.getElementById("pf-province").value,
        postal_code: document.getElementById("pf-postal").value,
      };
      try {
        await api("profile.php", { method: "POST", json: payload });
        STATE.customer = { ...STATE.customer, ...payload };
        showToast("Datos guardados.");
      } catch (e) { showToast(e.message); }
    });
  }
}

/* ============================================================
   Panel de administrador
============================================================ */
document.getElementById("btn-admin").addEventListener("click", () => { renderAdmin("login"); open("modal-admin"); });

async function refreshAdminSession() {
  try {
    const res = await api("session.php");
    STATE.isAdmin = !!res.admin;
    if (STATE.isAdmin) STATE.products = await api("products.php"); // ya había sesión: traer el stock real
  } catch (e) { STATE.isAdmin = false; }
  document.getElementById("btn-admin").classList.remove("hidden"); // siempre visible, pide login
}

function renderAdmin(tab) {
  const el = document.getElementById("admin-content");

  if (!STATE.isAdmin) {
    el.innerHTML = `
      <h3 class="display" style="font-size:1.4rem;">Administrar</h3>
      <div class="field"><label class="field-label">Usuario</label><input type="text" id="adm-user"></div>
      <div class="field"><label class="field-label">Contraseña</label><input type="password" id="adm-pass"></div>
      <p class="error-text hidden" id="adm-error"></p>
      <button class="btn-primary" id="adm-login-btn">Entrar</button>
    `;
    document.getElementById("adm-login-btn").addEventListener("click", async () => {
      try {
        await api("login.php", { method: "POST", json: {
          user: document.getElementById("adm-user").value,
          pass: document.getElementById("adm-pass").value,
        }});
        STATE.isAdmin = true;
        await loadSettings(); // ahora incluye los campos privados (usuario admin, avisos)
        STATE.products = await api("products.php"); // ahora incluye el stock real
        renderAdmin("productos");
      } catch (e) {
        const err = document.getElementById("adm-error");
        err.textContent = e.message; err.classList.remove("hidden");
      }
    });
    return;
  }

  el.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${tab === "productos" ? "active" : ""}" data-tab="productos">Productos</button>
      <button class="tab-btn ${tab === "categorias" ? "active" : ""}" data-tab="categorias">Categorías</button>
      <button class="tab-btn ${tab === "pedidos" ? "active" : ""}" data-tab="pedidos">Pedidos</button>
      <button class="tab-btn ${tab === "config" ? "active" : ""}" data-tab="config">Configuración</button>
    </div>
    <div id="admin-tab-body"></div>
  `;
  el.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => renderAdmin(b.dataset.tab)));

  if (tab === "pedidos") renderAdminOrders();
  else if (tab === "config") renderAdminSettings();
  else if (tab === "categorias") renderAdminCategories();
  else renderAdminProducts();
}

function renderAdminCategories() {
  const body = document.getElementById("admin-tab-body");
  body.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:14px;">
      <input type="text" id="new-cat-input" placeholder="Nueva categoría…" style="flex:1;">
      <button class="btn-secondary" id="new-cat-btn">+ Agregar</button>
    </div>
    <div id="cat-list"></div>
  `;

  function drawList() {
    document.getElementById("cat-list").innerHTML = CATEGORIES.map(c => `
      <div class="admin-row">
        <input type="text" class="cat-rename-input" data-old="${escapeHtml(c)}" value="${escapeHtml(c)}" style="flex:1;">
        <button class="btn-secondary cat-rename-btn" data-old="${escapeHtml(c)}">Guardar</button>
        <button class="btn-danger cat-remove-btn" data-name="${escapeHtml(c)}">🗑</button>
      </div>
    `).join("");

    document.querySelectorAll(".cat-rename-btn").forEach(b => b.addEventListener("click", async () => {
      const input = document.querySelector(`.cat-rename-input[data-old="${b.dataset.old}"]`);
      const newName = input.value.trim();
      if (!newName || newName === b.dataset.old) return;
      const fd = new FormData();
      fd.append("action", "rename");
      fd.append("old", b.dataset.old);
      fd.append("new", newName);
      CATEGORIES = await api("categories.php", { method: "POST", form: fd });
      STATE.products = await api("products.php");
      showToast("Categoría renombrada.");
      drawList();
      renderHeroCategories();
      renderCategories();
    }));
    document.querySelectorAll(".cat-remove-btn").forEach(b => b.addEventListener("click", async () => {
      if (!confirm(`¿Borrar la categoría "${b.dataset.name}"? Los productos que la tenían van a quedar sin categoría asignada.`)) return;
      const fd = new FormData();
      fd.append("action", "remove");
      fd.append("name", b.dataset.name);
      CATEGORIES = await api("categories.php", { method: "POST", form: fd });
      drawList();
      renderHeroCategories();
      renderCategories();
    }));
  }
  drawList();

  document.getElementById("new-cat-btn").addEventListener("click", async () => {
    const input = document.getElementById("new-cat-input");
    const name = input.value.trim();
    if (!name) return;
    const fd = new FormData();
    fd.append("action", "add");
    fd.append("name", name);
    CATEGORIES = await api("categories.php", { method: "POST", form: fd });
    input.value = "";
    drawList();
    renderHeroCategories();
    renderCategories();
  });
}

/* ---- Admin: productos ---- */
function renderAdminProducts() {
  const body = document.getElementById("admin-tab-body");
  body.innerHTML = `
    <button class="btn-primary" id="new-product-btn" style="margin-bottom:12px;">+ Nuevo producto</button>
    <div id="admin-product-list"></div>
  `;
  document.getElementById("new-product-btn").addEventListener("click", () => renderProductForm(null));
  const list = document.getElementById("admin-product-list");
  list.innerHTML = STATE.products.map(p => `
    <div class="admin-row">
      <div class="thumb-sm">${p.image ? `<img src="${p.image}">` : "🕊️"}</div>
      <div class="grow"><p>${escapeHtml(p.name)}</p><p class="muted">${escapeHtml(p.category)}</p></div>
      <button class="btn-secondary edit-p" data-id="${p.id}">Editar</button>
      <button class="btn-danger del-p" data-id="${p.id}">🗑</button>
    </div>
  `).join("");
  list.querySelectorAll(".edit-p").forEach(b => b.addEventListener("click", () => {
    renderProductForm(STATE.products.find(p => p.id === Number(b.dataset.id)));
  }));
  list.querySelectorAll(".del-p").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("¿Borrar este producto?")) return;
    const fd = new FormData();
    fd.append("action", "delete");
    fd.append("id", b.dataset.id);
    STATE.products = await api("products.php", { method: "POST", form: fd });
    renderAdminProducts();
    renderGrid();
  }));
}

function renderProductForm(product) {
  const body = document.getElementById("admin-tab-body");
  const form = product ? JSON.parse(JSON.stringify(product)) : {
    id: null, name: "", category: CATEGORIES[0], description: "", image: "",
    isOffer: false, offerPrice: null, stock: 20, variantGroups: [], tiers: [{ minQty: 1, price: 0 }],
  };
  // tempId para relacionar inputs de imagen de opciones nuevas
  form.variantGroups.forEach(g => g.options.forEach(o => { if (!o.tempId) o.tempId = uid(); }));
  let mainImageFile = null;
  const optionFiles = {}; // tempId -> File

  function draw() {
    body.innerHTML = `
      <button class="btn-secondary" id="back-to-list">← Volver</button>
      <h3 class="display" style="font-size:1.3rem; margin:10px 0;">${product ? "Editar producto" : "Nuevo producto"}</h3>

      <label class="field-label">Foto principal</label>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <div class="upload-preview" id="main-img-preview">${form.image ? `<img src="${form.image}">` : "🕊️"}</div>
        <button class="btn-secondary" id="main-img-btn">📷 Subir foto</button>
        <input type="file" accept="image/*" id="main-img-input" class="hidden">
      </div>

      <div class="field"><label class="field-label">Nombre</label><input type="text" id="pf-name" value="${escapeHtml(form.name)}"></div>
      <div class="field"><label class="field-label">Categoría</label>
        <select id="pf-category">${CATEGORIES.map(c => `<option ${form.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
      </div>
      <div class="field"><label class="field-label">Descripción</label><textarea id="pf-desc" rows="2">${escapeHtml(form.description)}</textarea></div>

      <div class="field" style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" id="pf-offer" ${form.isOffer ? "checked" : ""}>
        <label for="pf-offer" style="font-size:0.85rem;">Marcar como oferta</label>
      </div>
      <div class="field" id="offer-price-field" style="${form.isOffer ? "" : "display:none;"}">
        <label class="field-label">Precio de oferta</label>
        <input type="number" id="pf-offer-price" value="${form.offerPrice ?? ""}">
      </div>

      <div class="field">
        <label class="field-label">Stock disponible</label>
        <input type="number" id="pf-stock" min="0" value="${form.stock ?? 20}">
        <p style="font-size:0.72rem; color:var(--muted); margin-top:4px;">Se descuenta solo con cada venta. El cliente nunca ve este número — solo le va a aparecer "Agotado" cuando llegue a 0.</p>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <label class="field-label" style="margin:0;">Variantes (color, aroma, tamaño…)</label>
        <button class="btn-secondary" id="add-group-btn">+ Agregar nuevo</button>
      </div>
      <div id="groups-wrap"></div>

      <label class="field-label" style="display:block; margin-top:10px;">Precios por cantidad</label>
      <div id="tiers-wrap"></div>
      <button class="btn-secondary" id="add-tier-btn" style="margin-bottom:14px;">+ Agregar escalón</button>

      <p class="error-text hidden" id="pf-error"></p>
      <button class="btn-primary" id="pf-save-btn">Guardar producto</button>
    `;

    document.getElementById("back-to-list").addEventListener("click", renderAdminProducts);
    document.getElementById("main-img-btn").addEventListener("click", () => document.getElementById("main-img-input").click());
    document.getElementById("main-img-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      mainImageFile = file;
      document.getElementById("main-img-preview").innerHTML = `<img src="${URL.createObjectURL(file)}">`;
    });
    document.getElementById("pf-offer").addEventListener("change", (e) => {
      form.isOffer = e.target.checked;
      document.getElementById("offer-price-field").style.display = form.isOffer ? "" : "none";
    });
    document.getElementById("add-group-btn").addEventListener("click", () => {
      form.variantGroups.push({ id: uid(), name: "", options: [{ tempId: uid(), value: "", image: "", tiers: [] }] });
      drawGroups();
    });
    document.getElementById("add-tier-btn").addEventListener("click", () => {
      form.tiers.push({ minQty: 1, price: 0 });
      drawTiers();
    });
    document.getElementById("pf-save-btn").addEventListener("click", saveProduct);

    drawGroups();
    drawTiers();
  }

  const openOptionTiers = new Set(); // qué opciones tienen abierto su editor de precio propio (solo UI, no se guarda)

  function drawGroups() {
    const wrap = document.getElementById("groups-wrap");
    wrap.innerHTML = form.variantGroups.map((g, gi) => `
      <div class="variant-group-box" data-gi="${gi}">
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <input type="text" class="group-name" data-gi="${gi}" placeholder="Nombre (ej: Color)" value="${escapeHtml(g.name)}" style="flex:1;">
          <button class="btn-danger remove-group" data-gi="${gi}">🗑</button>
        </div>
        ${g.options.map((o, oi) => {
          const key = gi + "-" + oi;
          const hasOwnPrice = o.tiers && o.tiers.length > 0;
          const isOpen = openOptionTiers.has(key) || hasOwnPrice;
          return `
          <div class="variant-option-row" data-gi="${gi}" data-oi="${oi}">
            <div class="upload-preview sm opt-preview" data-gi="${gi}" data-oi="${oi}">${o.image ? `<img src="${o.image}">` : "🕊️"}</div>
            <input type="text" class="option-value" data-gi="${gi}" data-oi="${oi}" placeholder="Ej: Rojo" value="${escapeHtml(o.value)}" style="flex:1;">
            <button class="btn-secondary opt-img-btn" data-gi="${gi}" data-oi="${oi}">📷</button>
            <input type="file" accept="image/*" class="hidden opt-img-input" data-gi="${gi}" data-oi="${oi}">
            <button class="btn-danger remove-option" data-gi="${gi}" data-oi="${oi}">✕</button>
          </div>
          <div style="padding-left:44px; margin-bottom:10px;">
            <button class="btn-secondary toggle-own-price" data-gi="${gi}" data-oi="${oi}" style="font-size:0.75rem; padding:4px 10px;">
              ${hasOwnPrice ? "💲 Precio propio (editar)" : "💲 Poner precio propio para esta opción"}
            </button>
            ${isOpen ? `
              <div class="option-tiers-box" data-gi="${gi}" data-oi="${oi}" style="margin-top:8px; padding:8px; background:var(--bg-alt); border-radius:8px;">
                ${(o.tiers && o.tiers.length ? o.tiers : [{ minQty: 1, price: 0 }]).map((t, ti) => `
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                    <span style="font-size:0.72rem; color:var(--muted);">Desde</span>
                    <input type="number" class="opt-tier-min" data-gi="${gi}" data-oi="${oi}" data-ti="${ti}" value="${t.minQty}" style="width:64px;">
                    <span style="font-size:0.72rem; color:var(--muted);">unid. →</span>
                    <input type="number" class="opt-tier-price" data-gi="${gi}" data-oi="${oi}" data-ti="${ti}" value="${t.price}" style="flex:1;">
                    <button class="btn-danger remove-opt-tier" data-gi="${gi}" data-oi="${oi}" data-ti="${ti}">✕</button>
                  </div>
                `).join("")}
                <div style="display:flex; gap:10px; margin-top:4px;">
                  <button class="btn-secondary add-opt-tier" data-gi="${gi}" data-oi="${oi}" style="font-size:0.75rem;">+ Agregar escalón</button>
                  <button class="btn-secondary clear-opt-tiers" data-gi="${gi}" data-oi="${oi}" style="font-size:0.75rem; color:var(--danger);">Usar precio general del producto</button>
                </div>
              </div>
            ` : ""}
          </div>`;
        }).join("")}
        <button class="btn-secondary add-option" data-gi="${gi}">+ Agregar opción</button>
        <p style="font-size:0.72rem; color:var(--muted); margin:6px 0 0;">Si una variante (ej: "7 colores" o "Combinado") vale distinto según la cantidad, ponele su propio precio. Si no, deja "sin precio propio" y usa el precio general de más abajo.</p>
      </div>
    `).join("");

    wrap.querySelectorAll(".group-name").forEach(inp => inp.addEventListener("input", e => {
      form.variantGroups[e.target.dataset.gi].name = e.target.value;
    }));
    wrap.querySelectorAll(".remove-group").forEach(b => b.addEventListener("click", () => {
      form.variantGroups.splice(Number(b.dataset.gi), 1); drawGroups();
    }));
    wrap.querySelectorAll(".add-option").forEach(b => b.addEventListener("click", () => {
      form.variantGroups[Number(b.dataset.gi)].options.push({ tempId: uid(), value: "", image: "", tiers: [] });
      drawGroups();
    }));
    wrap.querySelectorAll(".remove-option").forEach(b => b.addEventListener("click", () => {
      form.variantGroups[Number(b.dataset.gi)].options.splice(Number(b.dataset.oi), 1); drawGroups();
    }));
    wrap.querySelectorAll(".option-value").forEach(inp => inp.addEventListener("input", e => {
      form.variantGroups[e.target.dataset.gi].options[e.target.dataset.oi].value = e.target.value;
    }));
    wrap.querySelectorAll(".toggle-own-price").forEach(b => b.addEventListener("click", () => {
      const key = b.dataset.gi + "-" + b.dataset.oi;
      const opt = form.variantGroups[Number(b.dataset.gi)].options[Number(b.dataset.oi)];
      if (openOptionTiers.has(key)) {
        openOptionTiers.delete(key);
      } else {
        openOptionTiers.add(key);
        if (!opt.tiers || !opt.tiers.length) opt.tiers = [{ minQty: 1, price: 0 }];
      }
      drawGroups();
    }));
    wrap.querySelectorAll(".add-opt-tier").forEach(b => b.addEventListener("click", () => {
      const opt = form.variantGroups[Number(b.dataset.gi)].options[Number(b.dataset.oi)];
      opt.tiers.push({ minQty: 1, price: 0 });
      drawGroups();
    }));
    wrap.querySelectorAll(".remove-opt-tier").forEach(b => b.addEventListener("click", () => {
      const opt = form.variantGroups[Number(b.dataset.gi)].options[Number(b.dataset.oi)];
      opt.tiers.splice(Number(b.dataset.ti), 1);
      drawGroups();
    }));
    wrap.querySelectorAll(".clear-opt-tiers").forEach(b => b.addEventListener("click", () => {
      const key = b.dataset.gi + "-" + b.dataset.oi;
      const opt = form.variantGroups[Number(b.dataset.gi)].options[Number(b.dataset.oi)];
      opt.tiers = [];
      openOptionTiers.delete(key);
      drawGroups();
    }));
    wrap.querySelectorAll(".opt-tier-min").forEach(inp => inp.addEventListener("input", e => {
      form.variantGroups[e.target.dataset.gi].options[e.target.dataset.oi].tiers[e.target.dataset.ti].minQty = Number(e.target.value) || 1;
    }));
    wrap.querySelectorAll(".opt-tier-price").forEach(inp => inp.addEventListener("input", e => {
      form.variantGroups[e.target.dataset.gi].options[e.target.dataset.oi].tiers[e.target.dataset.ti].price = Number(e.target.value) || 0;
    }));
    wrap.querySelectorAll(".opt-img-btn").forEach(b => b.addEventListener("click", () => {
      wrap.querySelector(`.opt-img-input[data-gi="${b.dataset.gi}"][data-oi="${b.dataset.oi}"]`).click();
    }));
    wrap.querySelectorAll(".opt-img-input").forEach(inp => inp.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const opt = form.variantGroups[e.target.dataset.gi].options[e.target.dataset.oi];
      optionFiles[opt.tempId] = file;
      wrap.querySelector(`.opt-preview[data-gi="${e.target.dataset.gi}"][data-oi="${e.target.dataset.oi}"]`).innerHTML = `<img src="${URL.createObjectURL(file)}">`;
    }));
  }

  function drawTiers() {
    const wrap = document.getElementById("tiers-wrap");
    wrap.innerHTML = form.tiers.map((t, ti) => `
      <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
        <span style="font-size:0.78rem; color:var(--muted);">Desde</span>
        <input type="number" class="tier-min" data-ti="${ti}" value="${t.minQty}" style="width:70px;">
        <span style="font-size:0.78rem; color:var(--muted);">unid. →</span>
        <input type="number" class="tier-price" data-ti="${ti}" value="${t.price}" style="flex:1;">
        ${form.tiers.length > 1 ? `<button class="btn-danger remove-tier" data-ti="${ti}">✕</button>` : ""}
      </div>
    `).join("");
    wrap.querySelectorAll(".tier-min").forEach(inp => inp.addEventListener("input", e => form.tiers[e.target.dataset.ti].minQty = Number(e.target.value)));
    wrap.querySelectorAll(".tier-price").forEach(inp => inp.addEventListener("input", e => form.tiers[e.target.dataset.ti].price = Number(e.target.value)));
    wrap.querySelectorAll(".remove-tier").forEach(b => b.addEventListener("click", () => { form.tiers.splice(Number(b.dataset.ti), 1); drawTiers(); }));
  }

  async function saveProduct() {
    form.name = document.getElementById("pf-name").value.trim();
    if (!form.name) {
      const err = document.getElementById("pf-error");
      err.textContent = "El producto necesita un nombre."; err.classList.remove("hidden");
      return;
    }
    const fd = new FormData();
    fd.append("action", "save");
    if (form.id) fd.append("id", form.id);
    fd.append("name", form.name);
    fd.append("category", document.getElementById("pf-category").value);
    fd.append("description", document.getElementById("pf-desc").value);
    fd.append("is_offer", form.isOffer ? "1" : "0");
    fd.append("offer_price", document.getElementById("pf-offer-price")?.value || "");
    fd.append("stock", document.getElementById("pf-stock").value || "0");
    if (mainImageFile) fd.append("main_image", mainImageFile);

    const groupsPayload = form.variantGroups
      .filter(g => g.name.trim())
      .map(g => ({
        name: g.name,
        options: g.options.filter(o => o.value.trim()).map(o => ({ value: o.value, tempId: o.tempId, existingImage: o.image || "", tiers: (o.tiers && o.tiers.length ? o.tiers : []) })),
      }));
    fd.append("groups_json", JSON.stringify(groupsPayload));
    fd.append("tiers_json", JSON.stringify(form.tiers));

    groupsPayload.forEach(g => g.options.forEach(o => {
      if (optionFiles[o.tempId]) fd.append("opt_image_" + o.tempId, optionFiles[o.tempId]);
    }));

    try {
      STATE.products = await api("products.php", { method: "POST", form: fd });
      renderAdminProducts();
      renderGrid();
    } catch (e) {
      const err = document.getElementById("pf-error");
      err.textContent = e.message; err.classList.remove("hidden");
    }
  }

  draw();
}

/* ---- Admin: pedidos ---- */
async function renderAdminOrders() {
  const body = document.getElementById("admin-tab-body");
  body.innerHTML = `<p style="color:var(--muted); font-size:0.85rem;">Cargando…</p>`;
  const orders = await api("orders.php?scope=all");
  if (orders.length === 0) {
    body.innerHTML = `<p style="color:var(--muted); font-size:0.9rem;">Todavía no hay pedidos.</p>`;
    return;
  }
  body.innerHTML = orders.map(o => `
    <div class="order-card">
      <p style="margin:0 0 4px;">Pedido #${o.id} — ${escapeHtml(o.customerName)} (${escapeHtml(o.customerEmail)})</p>
      <p style="margin:0 0 6px; color:var(--muted); font-size:0.8rem;">${new Date(o.createdAt.replace(" ", "T")).toLocaleString("es-AR")} · ${escapeHtml(o.paymentMethod === "mercadopago" ? "Mercado Pago" : "Transferencia")}</p>
      ${o.items.map(it => `<p style="margin:2px 0; color:var(--muted);">${it.qty}x ${escapeHtml(it.name)} ${it.label ? `(${escapeHtml(it.label)})` : ""}</p>`).join("")}
      <p style="font-weight:600; margin:6px 0;">Total: ${fmt(o.total)}</p>
      <select class="status-select" data-id="${o.id}" style="margin-bottom:8px;">
        ${ORDER_STATUSES.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <div class="tracking-fields" data-id="${o.id}" style="display:flex; gap:6px; margin-bottom:6px;">
        <input type="text" class="tracking-code-input" data-id="${o.id}" placeholder="Código de seguimiento" value="${escapeHtml(o.trackingCode || "")}" style="flex:1;">
        <input type="text" class="carrier-input" data-id="${o.id}" placeholder="Empresa de envío o link" value="${escapeHtml(o.carrier || "")}" style="flex:1;">
      </div>
      <button class="btn-secondary save-order-btn" data-id="${o.id}">Guardar cambios</button>
      <button class="btn-secondary print-order-btn" data-id="${o.id}">🖨️ Imprimir ticket</button>
    </div>
  `).join("");

  body.querySelectorAll(".save-order-btn").forEach(btn => btn.addEventListener("click", async () => {
    const id = Number(btn.dataset.id);
    const status = document.querySelector(`.status-select[data-id="${id}"]`).value;
    const trackingCode = document.querySelector(`.tracking-code-input[data-id="${id}"]`).value;
    const carrier = document.querySelector(`.carrier-input[data-id="${id}"]`).value;
    try {
      await api("orders.php", { method: "POST", json: { action: "update_status", id, status, trackingCode, carrier } });
      showToast("Pedido actualizado.");
    } catch (e) { showToast(e.message); }
  }));

  body.querySelectorAll(".print-order-btn").forEach(btn => btn.addEventListener("click", () => {
    const order = orders.find(o => o.id === Number(btn.dataset.id));
    if (order) printOrderTicket(order);
  }));
}

function printOrderTicket(o) {
  const sh = o.shipping || {};
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) { showToast("El navegador bloqueó la ventana de impresión. Permití pop-ups para este sitio."); return; }

  win.document.write(`
    <!DOCTYPE html>
    <html lang="es"><head><meta charset="UTF-8"><title>Pedido #${o.id}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; color:#12324a; max-width: 380px; margin:0 auto; }
      h1 { font-size: 1.1rem; margin-bottom: 2px; }
      .muted { color:#5f8299; font-size:0.85rem; }
      table { width:100%; border-collapse: collapse; margin-top:12px; font-size:0.85rem; }
      td { padding: 4px 0; vertical-align: top; }
      .total { font-weight:bold; font-size:1rem; margin-top:10px; border-top:1px solid #ccc; padding-top:8px; }
      hr { border:none; border-top:1px dashed #999; margin:14px 0; }
    </style></head>
    <body>
      <h1>Pedido #${o.id}</h1>
      <p class="muted">${new Date(o.createdAt.replace(" ", "T")).toLocaleString("es-AR")}</p>
      <hr>
      <strong>Cliente</strong>
      <p style="margin:4px 0;">
        ${escapeHtml(sh.name || o.customerName || "")}<br>
        ${escapeHtml(sh.phone || "")}<br>
        ${escapeHtml(sh.address || "")}${sh.city ? ", " + escapeHtml(sh.city) : ""}${sh.province ? ", " + escapeHtml(sh.province) : ""}${sh.postal_code ? " (CP " + escapeHtml(sh.postal_code) + ")" : ""}
      </p>
      <hr>
      <strong>Productos</strong>
      <table>
        ${o.items.map(it => `<tr><td>${it.qty}x ${escapeHtml(it.name)}${it.label ? " (" + escapeHtml(it.label) + ")" : ""}</td><td style="text-align:right;">${fmt(it.unitPrice * it.qty)}</td></tr>`).join("")}
      </table>
      <p class="total">Total: ${fmt(o.total)}</p>
      <p class="muted">Pago: ${o.paymentMethod === "mercadopago" ? "Mercado Pago" : "Transferencia"}</p>
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

/* ---- Admin: configuración ---- */
function renderAdminSettings() {
  const body = document.getElementById("admin-tab-body");
  const s = STATE.settings;
  let logoFile = null, heroFile = null, catalogFile = null;

  body.innerHTML = `
    <label class="field-label">Logo de la tienda</label>
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
      <div class="upload-preview" id="logo-preview">${s.store_logo ? `<img src="${s.store_logo}">` : "🕊️"}</div>
      <button class="btn-secondary" id="logo-btn">📷 Subir</button>
      <input type="file" accept="image/*" id="logo-input" class="hidden">
    </div>

    <label class="field-label">Foto de cielo/nubes de fondo</label>
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
      <div class="upload-preview" id="hero-preview" style="width:96px;">${s.hero_image ? `<img src="${s.hero_image}">` : "🕊️"}</div>
      <button class="btn-secondary" id="hero-btn">📷 Subir</button>
      <input type="file" accept="image/*" id="hero-input" class="hidden">
    </div>

    <label class="field-label">Catálogo en PDF</label>
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
      <span style="font-size:0.85rem; color:var(--muted);">${s.catalog_pdf ? "Ya hay un catálogo cargado" : "Sin catálogo"}</span>
      <button class="btn-secondary" id="catalog-btn">📄 Subir PDF</button>
      <input type="file" accept="application/pdf" id="catalog-input" class="hidden">
    </div>

    <div class="field"><label class="field-label">Nombre de la tienda</label><input type="text" id="s-name" value="${escapeHtml(s.store_name || "")}"></div>
    <div class="field"><label class="field-label">Resumen para la portada (debajo del catálogo)</label><textarea id="s-summary" rows="2">${escapeHtml(s.about_summary || "")}</textarea></div>

    <div class="field"><label class="field-label">Texto para "Distribuidores"</label><textarea id="s-distribuidores" rows="4">${escapeHtml(s.distribuidores_text || "")}</textarea></div>
    <div class="field"><label class="field-label">Texto para "Código de ética"</label><textarea id="s-etica" rows="4">${escapeHtml(s.etica_text || "")}</textarea></div>

    <label class="field-label" style="display:block; margin-top:6px;">Datos de contacto</label>
    <div class="field"><label class="field-label">Dirección</label><input type="text" id="s-address" value="${escapeHtml(s.contact_address || "")}"></div>
    <div class="field"><label class="field-label">Teléfono</label><input type="text" id="s-phone" value="${escapeHtml(s.contact_phone || "")}"></div>
    <div class="field"><label class="field-label">Email</label><input type="text" id="s-email" value="${escapeHtml(s.contact_email || "")}"></div>
    <div class="field"><label class="field-label">Horario de atención</label><input type="text" id="s-hours" value="${escapeHtml(s.contact_hours || "")}"></div>

    <label class="field-label" style="display:block; margin-top:10px;">Avisos de pedidos nuevos (para vos, no lo ve el cliente)</label>
    <div class="field">
      <label class="field-label">Tu email para recibir el aviso</label>
      <input type="text" id="s-notify-email" value="${escapeHtml(s.notify_email || "")}" placeholder="tu@email.com">
    </div>
    <div class="field">
      <label class="field-label">Tu WhatsApp (con código de país, ej: 5491122334455)</label>
      <input type="text" id="s-notify-wa" value="${escapeHtml(s.notify_whatsapp_number || "")}">
    </div>
    <div class="field">
      <label class="field-label">Clave de CallMeBot (para el aviso automático de WhatsApp)</label>
      <input type="text" id="s-notify-wa-key" value="${escapeHtml(s.notify_whatsapp_apikey || "")}">
      <p style="font-size:0.72rem; color:var(--muted); margin-top:4px;">
        Es un servicio gratuito para uso personal. Para conseguir tu clave: agregá el contacto
        <strong>+34 611 01 16 37</strong> en tu WhatsApp, mandale el mensaje
        <em>"I allow callmebot to send me messages"</em>, y te va a responder con tu clave (puede demorar unos minutos).
        No es un servicio oficial de WhatsApp — es gratis y funciona bien, pero no tiene garantía de una empresa grande detrás.
      </p>
    </div>

    <label class="field-label">Fotos del local (se muestran en la página "Ver más")</label>
    <div id="gallery-list" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;"></div>
    <button class="btn-secondary" id="gallery-add-btn" style="margin-bottom:16px;">📷 Agregar foto</button>
    <input type="file" accept="image/*" id="gallery-input" class="hidden">
    <div class="field"><label class="field-label">WhatsApp (con código de país, ej: 5491122334455)</label><input type="text" id="s-wa" value="${escapeHtml(s.whatsapp || "")}"></div>
    <div class="field"><label class="field-label">Titular de la cuenta</label><input type="text" id="s-titular" value="${escapeHtml(s.titular || "")}"></div>
    <div class="field"><label class="field-label">Alias bancario</label><input type="text" id="s-alias" value="${escapeHtml(s.alias || "")}"></div>
    <div class="field"><label class="field-label">CBU</label><input type="text" id="s-cbu" value="${escapeHtml(s.cbu || "")}"></div>
    <div class="field"><label class="field-label">Link de pago de Mercado Pago</label><input type="text" id="s-mp" value="${escapeHtml(s.mp_link || "")}"></div>
    <div class="field"><label class="field-label">Usuario administrador</label><input type="text" id="s-user" value="${escapeHtml(s.admin_user || "")}"></div>
    <div class="field"><label class="field-label">Nueva contraseña (dejar vacío para no cambiarla)</label><input type="password" id="s-pass"></div>

    <button class="btn-primary" id="s-save-btn">Guardar configuración</button>
  `;

  document.getElementById("logo-btn").addEventListener("click", () => document.getElementById("logo-input").click());
  document.getElementById("logo-input").addEventListener("change", e => {
    logoFile = e.target.files[0];
    if (logoFile) document.getElementById("logo-preview").innerHTML = `<img src="${URL.createObjectURL(logoFile)}">`;
  });
  document.getElementById("hero-btn").addEventListener("click", () => document.getElementById("hero-input").click());
  document.getElementById("hero-input").addEventListener("change", e => {
    heroFile = e.target.files[0];
    if (heroFile) document.getElementById("hero-preview").innerHTML = `<img src="${URL.createObjectURL(heroFile)}">`;
  });
  document.getElementById("catalog-btn").addEventListener("click", () => document.getElementById("catalog-input").click());
  document.getElementById("catalog-input").addEventListener("change", e => {
    catalogFile = e.target.files[0];
    if (catalogFile) showToast("PDF listo para subir — no olvides Guardar configuración.");
  });

  document.getElementById("s-save-btn").addEventListener("click", async () => {
    const fd = new FormData();
    fd.append("store_name", document.getElementById("s-name").value);
    fd.append("about_summary", document.getElementById("s-summary").value);
    fd.append("distribuidores_text", document.getElementById("s-distribuidores").value);
    fd.append("etica_text", document.getElementById("s-etica").value);
    fd.append("contact_address", document.getElementById("s-address").value);
    fd.append("contact_phone", document.getElementById("s-phone").value);
    fd.append("contact_email", document.getElementById("s-email").value);
    fd.append("contact_hours", document.getElementById("s-hours").value);
    fd.append("notify_email", document.getElementById("s-notify-email").value);
    fd.append("notify_whatsapp_number", document.getElementById("s-notify-wa").value);
    fd.append("notify_whatsapp_apikey", document.getElementById("s-notify-wa-key").value);
    fd.append("whatsapp", document.getElementById("s-wa").value);
    fd.append("titular", document.getElementById("s-titular").value);
    fd.append("alias", document.getElementById("s-alias").value);
    fd.append("cbu", document.getElementById("s-cbu").value);
    fd.append("mp_link", document.getElementById("s-mp").value);
    fd.append("admin_user", document.getElementById("s-user").value);
    const pass = document.getElementById("s-pass").value;
    if (pass) fd.append("admin_pass", pass);
    if (logoFile) fd.append("store_logo", logoFile);
    if (heroFile) fd.append("hero_image", heroFile);
    if (catalogFile) fd.append("catalog_pdf", catalogFile);

    try {
      await api("settings.php", { method: "POST", form: fd });
      await loadSettings();
      showToast("Configuración guardada.");
    } catch (e) { showToast(e.message); }
  });

  loadGallery();

  async function loadGallery() {
    const listEl = document.getElementById("gallery-list");
    listEl.innerHTML = `<span style="font-size:0.8rem; color:var(--muted);">Cargando…</span>`;
    const images = await api("gallery.php");
    if (images.length === 0) {
      listEl.innerHTML = `<span style="font-size:0.8rem; color:var(--muted);">Todavía no subiste fotos del local.</span>`;
      return;
    }
    listEl.innerHTML = images.map(path => `
      <div style="position:relative;">
        <div class="upload-preview"><img src="${path}"></div>
        <button class="btn-danger gallery-remove" data-path="${escapeHtml(path)}" style="position:absolute; top:-6px; right:-6px; background:#fff; border-radius:999px; width:20px; height:20px; font-size:0.7rem;">✕</button>
      </div>
    `).join("");
    listEl.querySelectorAll(".gallery-remove").forEach(b => b.addEventListener("click", async () => {
      const fd = new FormData();
      fd.append("action", "remove");
      fd.append("path", b.dataset.path);
      await api("gallery.php", { method: "POST", form: fd });
      loadGallery();
    }));
  }

  document.getElementById("gallery-add-btn").addEventListener("click", () => document.getElementById("gallery-input").click());
  document.getElementById("gallery-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("action", "add");
    fd.append("photo", file);
    try {
      await api("gallery.php", { method: "POST", form: fd });
      loadGallery();
    } catch (err) { showToast(err.message); }
  });
}

/* ============================================================
   Inicio
============================================================ */
(async function init() {
  loadCart();
  renderCartBadge();

  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "novedades" || view === "ofertas") {
    STATE.viewFilter = view;
  }

  try { CSRF_TOKEN = (await api("csrf.php")).token; } catch (e) {}

  await loadSettings();
  await loadCategories();
  await loadProducts();
  await refreshCustomerSession();
  await refreshAdminSession();

  if (STATE.viewFilter) {
    const banner = document.getElementById("view-filter-banner");
    const label = STATE.viewFilter === "novedades" ? "Novedades" : "Ofertas";
    banner.innerHTML = `<span class="chip active">Viendo: ${label}</span> <a href="index.html" style="font-size:0.8rem; color:var(--accent);">Ver todo el catálogo</a>`;
    banner.classList.remove("hidden");
    document.getElementById("product-grid").scrollIntoView({ behavior: "smooth", block: "start" });
  }
})();
