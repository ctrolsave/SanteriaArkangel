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
  visibleCount: 12, // cuántos se muestran ahora; crece con "Ver más"
  viewFilter: null, // "novedades" | "ofertas" | null
  cart: [],
  customer: null, // { name, email, phone, address, city, province, postal_code } o null
  isAdmin: false,
};

/* ---------------- API helper ---------------- */
let CSRF_TOKEN = null;
let RESET_TOKEN = null; // token de "olvidé mi contraseña" leído de la URL (?reset=...)

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

function monthLabel(date) {
  const label = date.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function statusClass(status) {
  if (status === "Pendiente") return "status-pending";
  if (status === "Cancelado") return "status-cancelled";
  if (status === "Despachado" || status === "Entregado") return "status-done";
  return ""; // Confirmado, Listo para despachar: color por defecto
}

// El "YYYY-MM-DD HH:MM:SS" que manda PHP no es válido para el constructor Date
// de Safari/iOS sin cambiar el espacio por una "T" (formato ISO).
function parseServerDate(str) {
  return new Date(str.replace(" ", "T"));
}

function bankInfoHtml(s) {
  return `
    <p>Titular: ${escapeHtml(s.titular || "— a configurar —")}</p>
    <p>Alias: ${escapeHtml(s.alias || "— a configurar —")}</p>
    <p>CBU: ${escapeHtml(s.cbu || "— a configurar —")}</p>`;
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

// Campo de contraseña con botón de ver/ocultar. attrs va tal cual dentro del <input>.
function pwFieldHtml(id, attrs = "") {
  return `<div class="pw-wrap">
    <input type="password" id="${id}" ${attrs}>
    <button type="button" class="pw-toggle" data-target="${id}" title="Mostrar contraseña">👁</button>
  </div>`;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".pw-toggle");
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  btn.textContent = showing ? "👁" : "🙈";
  btn.title = showing ? "Mostrar contraseña" : "Ocultar contraseña";
});

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

/* ---------------- Vistas de página completa (cuenta / admin) ---------------- */
// Reemplazan a los popups para "Mi cuenta" y "Administrar": ocupan la página
// completa (como historia.html o contacto.html) en vez de un modal angosto,
// más cómodo para el dashboard, las tablas de productos y los pedidos.
function showView(id) {
  document.getElementById("store-view").classList.add("hidden");
  document.querySelectorAll(".page-view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  // El nav de la tienda y los botones flotantes (WhatsApp, engranaje de
  // admin) son atajos de la tienda: no tienen sentido arriba de la página
  // de cuenta/admin.
  document.querySelector(".site-nav").classList.add("hidden");
  document.getElementById("wa-float").classList.add("hidden");
  document.getElementById("btn-admin").classList.add("hidden");
  window.scrollTo({ top: 0 });
}
function showStore() {
  document.querySelectorAll(".page-view").forEach(v => v.classList.add("hidden"));
  document.getElementById("store-view").classList.remove("hidden");
  document.querySelector(".site-nav").classList.remove("hidden");
  document.getElementById("btn-admin").classList.remove("hidden");
  if (STATE.settings?.whatsapp) document.getElementById("wa-float").classList.remove("hidden");
  window.scrollTo({ top: 0 });
}
document.getElementById("account-back-link").addEventListener("click", (e) => { e.preventDefault(); showStore(); });
document.getElementById("admin-back-link").addEventListener("click", (e) => { e.preventDefault(); showStore(); });

// "Inicio" y "Productos" del nav ya apuntan a la página actual: si estamos
// viendo Mi cuenta / Administrar, los volvemos a la tienda sin recargar.
document.querySelectorAll('.site-nav a[href="index.html"], .site-nav a[href="#filters-bar"]').forEach(a => {
  a.addEventListener("click", (e) => {
    if (a.getAttribute("href") === "index.html") e.preventDefault();
    showStore();
  });
});

/* ============================================================
   Carga inicial
============================================================ */
async function loadSettings() {
  STATE.settings = await api("settings.php");
  const s = STATE.settings;
  document.getElementById("brand-name").textContent = s.store_name || "Santería Arkangel";
  document.getElementById("footer-name").textContent = s.store_name || "Santería Arkangel";
  document.getElementById("footer-brand-name").textContent = s.store_name || "Santería Arkangel";
  document.getElementById("footer-year").textContent = new Date().getFullYear();
  if (s.store_logo) {
    document.getElementById("brand-logo").src = s.store_logo;
    document.getElementById("footer-logo").src = s.store_logo;
  }
  document.getElementById("about-summary").textContent = s.about_summary || "";

  // Las url() dentro de una variable CSS se resuelven relativas a donde se
  // USA (style.css), no a donde se define — por eso hace falta una ruta
  // absoluta con "/" adelante, o quedaría buscando el archivo dentro de
  // assets/css/.
  const hero = document.getElementById("hero");
  if (s.hero_image) {
    hero.classList.add("has-image");
    hero.style.setProperty("--hero-img-desktop", `url(/${s.hero_image})`);
  } else {
    hero.classList.remove("has-image");
    hero.style.removeProperty("--hero-img-desktop");
  }
  if (s.hero_image_mobile) {
    hero.classList.add("has-mobile-image");
    hero.style.setProperty("--hero-img-mobile", `url(/${s.hero_image_mobile})`);
  } else {
    hero.classList.remove("has-mobile-image");
    hero.style.removeProperty("--hero-img-mobile");
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
    STATE.visibleCount = STATE.pageSize;
    renderCategories();
    renderGrid();
    dropdownWrap.classList.remove("open");
    document.getElementById("filters-bar").scrollIntoView({ behavior: "smooth", block: "start" });
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
  const days = (Date.now() - parseServerDate(createdAt).getTime()) / (1000 * 60 * 60 * 24);
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
      STATE.visibleCount = STATE.pageSize;
      renderCategories();
      renderGrid();
    });
  });
}

document.getElementById("search-input").addEventListener("input", (e) => {
  STATE.query = e.target.value;
  STATE.visibleCount = STATE.pageSize;
  renderGrid();
});

document.getElementById("page-size-select").addEventListener("change", (e) => {
  STATE.pageSize = e.target.value === "all" ? Infinity : Number(e.target.value);
  STATE.visibleCount = STATE.pageSize;
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

  const shown = filtered.slice(0, STATE.visibleCount);

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
    grid.insertAdjacentHTML("beforeend", `
      <div class="load-more-wrap">
        <button class="btn-secondary" id="load-more-btn">Ver más (${shown.length} de ${filtered.length})</button>
      </div>`);
    document.getElementById("load-more-btn").addEventListener("click", () => {
      const step = STATE.pageSize === Infinity ? filtered.length : STATE.pageSize;
      STATE.visibleCount += step;
      renderGrid();
    });
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
let CHECKOUT_DELIVERY_METHOD = "envio";
let CHECKOUT_RESUME = false; // si viene desde "Ir a pagar", retoma el checkout apenas se loguea/registra

function openCheckout() {
  CHECKOUT_PAY_METHOD = "transferencia";
  CHECKOUT_DELIVERY_METHOD = "envio";
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
      CHECKOUT_RESUME = true;
      openAccount("register");
    });
    return;
  }

  const deliveryInfoHtml = CHECKOUT_DELIVERY_METHOD === "retiro"
    ? `<p style="font-size:0.85rem; color: var(--muted);">Vas a retirar en:</p>
       <p style="font-size:0.9rem; margin-top:2px;">${escapeHtml(s.contact_address || "— dirección del local a configurar —")}</p>
       <p style="font-size:0.8rem; color:var(--muted); margin-bottom:14px;">${s.contact_hours ? "Horario: " + escapeHtml(s.contact_hours) : ""}</p>`
    : `<p style="font-size:0.85rem; color: var(--muted);">Se va a enviar a:</p>
       <p style="font-size:0.9rem; margin-top:2px;">${escapeHtml(STATE.customer.name)} — ${escapeHtml(STATE.customer.address || "sin dirección cargada")}, ${escapeHtml(STATE.customer.city || "")}</p>
       <p style="font-size:0.8rem; color:var(--muted); margin-bottom:14px;"><a href="#" id="edit-shipping-link" style="color:var(--accent);">Editar datos de envío</a></p>`;

  document.getElementById("checkout-content").innerHTML = `
    <h3 class="display" style="font-size:1.5rem; margin-bottom:12px;">Finalizar pedido</h3>

    <label class="field-label" style="display:block; margin-bottom:8px;">Tu pedido</label>
    <div id="checkout-items" style="margin-bottom:16px;"></div>

    <label class="field-label">Entrega</label>
    <div style="display:flex; gap:8px; margin-bottom:10px;">
      <button class="chip delivery-opt ${CHECKOUT_DELIVERY_METHOD === "envio" ? "active" : ""}" data-delivery="envio" style="flex:1;">🚚 Envío a domicilio</button>
      <button class="chip delivery-opt ${CHECKOUT_DELIVERY_METHOD === "retiro" ? "active" : ""}" data-delivery="retiro" style="flex:1;">🏬 Retiro en el local</button>
    </div>
    ${deliveryInfoHtml}

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

  document.querySelectorAll(".delivery-opt").forEach(btn => {
    btn.addEventListener("click", () => { CHECKOUT_DELIVERY_METHOD = btn.dataset.delivery; renderCheckout(); });
  });
  document.querySelectorAll(".pay-opt").forEach(btn => {
    btn.addEventListener("click", () => { CHECKOUT_PAY_METHOD = btn.dataset.pay; renderCheckout(); });
  });
  document.getElementById("edit-shipping-link")?.addEventListener("click", (e) => {
    e.preventDefault(); close("modal-checkout"); openAccount("profile");
  });
  document.getElementById("confirm-order-btn").addEventListener("click", submitOrder);

  function renderPayDetails() {
    const box = document.getElementById("pay-details");
    if (CHECKOUT_PAY_METHOD === "transferencia") {
      box.innerHTML = bankInfoHtml(s);
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
      json: { action: "create", items: STATE.cart, paymentMethod: CHECKOUT_PAY_METHOD, deliveryMethod: CHECKOUT_DELIVERY_METHOD },
    });
    STATE.cart = [];
    saveCart();
    close("modal-checkout");
    showToast(`¡Pedido #${result.orderId} creado! Podés verlo en Mi cuenta > Mis pedidos.`);

    if (STATE.settings.whatsapp) {
      const text = [
        `Hola! Acabo de hacer el pedido #${result.orderId} en ${STATE.settings.store_name || "la tienda"}.`,
        `Total: ${fmt(total)}`,
        `Entrega: ${CHECKOUT_DELIVERY_METHOD === "retiro" ? "Retiro en el local" : "Envío a domicilio"}`,
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

// Después de loguearse/registrarse: si venía de "Ir a pagar", retoma el checkout
// con el carrito intacto; si no, lo lleva al resumen de su cuenta.
function afterAuthSuccess() {
  if (CHECKOUT_RESUME) {
    CHECKOUT_RESUME = false;
    showStore();
    openCheckout();
  } else {
    renderAccount("summary");
  }
}

document.getElementById("btn-account").addEventListener("click", () => openAccount(STATE.customer ? "summary" : "login"));

function openAccount(tab) {
  renderAccount(tab);
  showView("account-view");
}

function renderAccount(tab) {
  const el = document.getElementById("account-content");

  if (!STATE.customer) {
    if (tab === "forgot" || tab === "reset") {
      el.innerHTML = `<div id="account-tab-body"></div>`;
    } else {
      el.innerHTML = `
        <div class="account-header">
          <div class="account-header-icon">${tab === "register" ? "✨" : "👋"}</div>
          <h3 class="display">${tab === "register" ? "Creá tu cuenta" : "Bienvenido de nuevo"}</h3>
          <p class="account-header-sub">${tab === "register" ? "Es gratis y te sirve para hacer seguimiento de tus pedidos." : "Iniciá sesión para ver tus pedidos y comprar más rápido."}</p>
        </div>
        <div class="tabs">
          <button class="tab-btn ${tab === "login" ? "active" : ""}" data-tab="login">Iniciar sesión</button>
          <button class="tab-btn ${tab === "register" ? "active" : ""}" data-tab="register">Crear cuenta</button>
        </div>
        <div id="account-tab-body"></div>
      `;
      el.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => renderAccount(b.dataset.tab)));
    }

    const body = document.getElementById("account-tab-body");
    if (tab === "forgot") {
      body.innerHTML = `
        <h3 class="display" style="font-size:1.3rem; margin-bottom:6px;">Recuperar contraseña</h3>
        <p style="color:var(--muted); font-size:0.85rem; margin-bottom:14px;">Ingresá tu email y te mandamos un link para elegir una contraseña nueva.</p>
        <div class="field"><label class="field-label">Email</label><input type="email" id="forgot-email"></div>
        <p class="error-text hidden" id="forgot-error"></p>
        <p class="hidden" id="forgot-success" style="color:var(--muted); font-size:0.85rem; margin-bottom:10px;">Si ese email está registrado, te va a llegar un correo con el link (revisá también la carpeta de spam).</p>
        <button class="btn-primary" id="forgot-submit">Enviar link</button>
        <p style="text-align:center; margin-top:12px; font-size:0.82rem;"><a href="#" id="back-to-login" style="color:var(--accent);">← Volver a iniciar sesión</a></p>
      `;
      document.getElementById("back-to-login").addEventListener("click", (e) => { e.preventDefault(); renderAccount("login"); });
      document.getElementById("forgot-submit").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        try {
          await api("forgot_password.php", { method: "POST", json: { email: document.getElementById("forgot-email").value } });
          document.getElementById("forgot-error").classList.add("hidden");
          document.getElementById("forgot-success").classList.remove("hidden");
          btn.disabled = true;
        } catch (err) {
          const errEl = document.getElementById("forgot-error");
          errEl.textContent = err.message; errEl.classList.remove("hidden");
        }
      });
      return;
    }
    if (tab === "reset") {
      body.innerHTML = `
        <h3 class="display" style="font-size:1.3rem; margin-bottom:6px;">Elegí tu nueva contraseña</h3>
        <div class="field"><label class="field-label">Contraseña nueva</label>${pwFieldHtml("reset-pass", 'minlength="8" placeholder="Mínimo 8 caracteres"')}</div>
        <p class="error-text hidden" id="reset-error"></p>
        <button class="btn-primary" id="reset-submit">Guardar contraseña</button>
      `;
      document.getElementById("reset-submit").addEventListener("click", async () => {
        try {
          await api("reset_password.php", { method: "POST", json: {
            token: RESET_TOKEN,
            pass: document.getElementById("reset-pass").value,
          }});
          RESET_TOKEN = null;
          showToast("Contraseña actualizada. Ya podés iniciar sesión.");
          renderAccount("login");
        } catch (err) {
          const errEl = document.getElementById("reset-error");
          errEl.textContent = err.message; errEl.classList.remove("hidden");
        }
      });
      return;
    }
    if (tab === "register") {
      body.innerHTML = `
        <div class="field"><label class="field-label">Nombre y apellido</label><input type="text" id="reg-name"></div>
        <div class="field"><label class="field-label">Email</label><input type="email" id="reg-email"></div>
        <div class="field"><label class="field-label">Teléfono</label><input type="tel" id="reg-phone"></div>
        <div class="field"><label class="field-label">Contraseña</label>${pwFieldHtml("reg-pass", 'minlength="8" placeholder="Mínimo 8 caracteres"')}</div>
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
          afterAuthSuccess();
        } catch (e) {
          const err = document.getElementById("reg-error");
          err.textContent = e.message; err.classList.remove("hidden");
        }
      });
    } else {
      body.innerHTML = `
        <div class="field"><label class="field-label">Email</label><input type="email" id="login-email"></div>
        <div class="field"><label class="field-label">Contraseña</label>${pwFieldHtml("login-pass")}</div>
        <p style="text-align:right; margin:-4px 0 10px;"><a href="#" id="forgot-link" style="color:var(--accent); font-size:0.8rem;">¿Olvidaste tu contraseña?</a></p>
        <p class="error-text hidden" id="login-error"></p>
        <button class="btn-primary" id="login-submit">Entrar</button>
      `;
      document.getElementById("forgot-link").addEventListener("click", (e) => { e.preventDefault(); renderAccount("forgot"); });
      document.getElementById("login-submit").addEventListener("click", async () => {
        try {
          await api("customer_login.php", { method: "POST", json: {
            email: document.getElementById("login-email").value,
            pass: document.getElementById("login-pass").value,
          }});
          await refreshCustomerSession();
          afterAuthSuccess();
        } catch (e) {
          const err = document.getElementById("login-error");
          err.textContent = e.message; err.classList.remove("hidden");
        }
      });
    }
    return;
  }

  // Cliente logueado: resumen / perfil / pedidos
  el.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${tab === "summary" ? "active" : ""}" data-tab="summary">Resumen</button>
      <button class="tab-btn ${tab === "profile" ? "active" : ""}" data-tab="profile">Mi perfil</button>
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
  if (tab === "summary") {
    body.innerHTML = `<p style="color:var(--muted); font-size:0.85rem;">Cargando…</p>`;
    api("orders.php?scope=mine").then(orders => {
      const porPagar = orders.filter(o => !o.paymentConfirmed && o.status !== "Cancelado");
      const realizados = orders.filter(o => o.paymentConfirmed);
      const totalGastado = realizados.reduce((s, o) => s + o.total, 0);
      body.innerHTML = `
        <div class="stat-grid">
          <div class="stat-card accent">
            <div class="stat-value">${porPagar.length}</div>
            <div class="stat-label">⏳ Pedidos por pagar</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${realizados.length}</div>
            <div class="stat-label">✅ Pedidos realizados</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${fmt(totalGastado)}</div>
            <div class="stat-label">💰 Total en pedidos realizados</div>
          </div>
        </div>
        ${orders.length === 0
          ? `<p style="color:var(--muted); font-size:0.9rem;">Todavía no hiciste ningún pedido.</p>`
          : `<button class="btn-secondary" id="summary-go-orders">Ver mis pedidos →</button>`}
      `;
      document.getElementById("summary-go-orders")?.addEventListener("click", () => renderAccount("orders"));
    });
    return;
  }
  if (tab === "orders") {
    body.innerHTML = `<p style="color:var(--muted); font-size:0.85rem;">Cargando…</p>`;
    api("orders.php?scope=mine").then(orders => {
      if (orders.length === 0) {
        body.innerHTML = `<p style="color:var(--muted); font-size:0.9rem;">Todavía no hiciste ningún pedido.</p>`;
        return;
      }
      const s = STATE.settings;
      const inProcess = ["Pendiente", "Confirmado", "Listo para despachar"];
      let lastMonth = null;
      const parts = [];

      orders.forEach(o => {
        const orderDate = parseServerDate(o.createdAt);
        const month = monthLabel(orderDate);
        if (month !== lastMonth) {
          parts.push(`<p class="order-group-header">${month}</p>`);
          lastMonth = month;
        }

        const methodLabel = o.paymentMethod === "mercadopago" ? "Mercado Pago" : "Transferencia bancaria";
        let extra = "";

        if (o.status === "Pendiente") {
          extra += `<div style="margin-top:8px; padding:8px; border-radius:8px; background:#fff4e0; color:#8a5a00; font-size:0.8rem; font-weight:600;">⏳ Pendiente de confirmación de pago</div>`;
          if (o.paymentMethod !== "mercadopago") {
            extra += `<div style="margin-top:6px; padding:8px; border-radius:8px; background:var(--bg-alt); font-size:0.8rem;">${bankInfoHtml(s)}</div>`;
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

        parts.push(`
        <details class="order-card">
          <summary class="order-summary">
            <div class="order-summary-top">
              <span class="status ${statusClass(o.status)}">${escapeHtml(o.status)}</span>
              <span class="order-summary-total">${fmt(o.total)}</span>
            </div>
            <div class="order-summary-bottom">
              <span>Pedido #${o.id}</span>
              <span>${orderDate.toLocaleDateString("es-AR")}</span>
            </div>
          </summary>
          <div class="order-details">
            ${o.items.map(it => `<p style="margin:2px 0; color:var(--muted);">${it.qty}x ${escapeHtml(it.name)} ${it.label ? `(${escapeHtml(it.label)})` : ""}</p>`).join("")}
            <p style="font-size:0.78rem; color:var(--muted); margin-top:6px;">Entrega: ${o.deliveryMethod === "retiro" ? "🏬 Retiro en el local" : "🚚 Envío a domicilio"}</p>
            <p style="font-size:0.78rem; color:var(--muted);">Método de pago: ${methodLabel}</p>
            ${extra}
          </div>
        </details>
      `);
      });

      body.innerHTML = parts.join("");
    });
  } else {
    const c = STATE.customer;
    body.innerHTML = `
      <p class="field-group-title">Datos personales</p>
      <div class="field"><label class="field-label">Nombre y apellido</label><input type="text" id="pf-name" value="${escapeHtml(c.name)}"></div>
      <div class="field"><label class="field-label">Email</label><input type="email" value="${escapeHtml(c.email)}" disabled></div>
      <div class="field"><label class="field-label">Teléfono</label><input type="tel" id="pf-phone" value="${escapeHtml(c.phone || "")}"></div>

      <p class="field-group-title">Dirección de envío</p>
      <div class="field"><label class="field-label">Dirección</label><input type="text" id="pf-address" value="${escapeHtml(c.address || "")}"></div>
      <div class="field-row">
        <div class="field"><label class="field-label">Ciudad</label><input type="text" id="pf-city" value="${escapeHtml(c.city || "")}"></div>
        <div class="field"><label class="field-label">Provincia</label><input type="text" id="pf-province" value="${escapeHtml(c.province || "")}"></div>
        <div class="field"><label class="field-label">Código postal</label><input type="text" id="pf-postal" value="${escapeHtml(c.postal_code || "")}"></div>
      </div>
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
document.getElementById("btn-admin").addEventListener("click", () => { renderAdmin(STATE.isAdmin ? "dashboard" : "login"); showView("admin-view"); });

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
      <div class="account-header account-header-admin">
        <div class="account-header-icon">🔒</div>
        <h3 class="display">Administrar</h3>
        <p class="account-header-sub">Acceso solo para el equipo de Santería Arkangel.</p>
      </div>
      <div class="field"><label class="field-label">Usuario</label><input type="text" id="adm-user"></div>
      <div class="field"><label class="field-label">Contraseña</label>${pwFieldHtml("adm-pass")}</div>
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
        renderAdmin("dashboard");
      } catch (e) {
        const err = document.getElementById("adm-error");
        err.textContent = e.message; err.classList.remove("hidden");
      }
    });
    return;
  }

  el.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${tab === "dashboard" ? "active" : ""}" data-tab="dashboard">Dashboard</button>
      <button class="tab-btn ${tab === "productos" ? "active" : ""}" data-tab="productos">Productos</button>
      <button class="tab-btn ${tab === "categorias" ? "active" : ""}" data-tab="categorias">Categorías</button>
      <button class="tab-btn ${tab === "pedidos" ? "active" : ""}" data-tab="pedidos">Pedidos</button>
      <button class="tab-btn ${tab === "config" ? "active" : ""}" data-tab="config">Configuración</button>
    </div>
    <div id="admin-tab-body"></div>
  `;
  el.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => renderAdmin(b.dataset.tab)));

  if (tab === "dashboard") renderAdminDashboard();
  else if (tab === "pedidos") renderAdminOrders();
  else if (tab === "config") renderAdminSettings();
  else if (tab === "categorias") renderAdminCategories();
  else renderAdminProducts();
}

async function renderAdminDashboard() {
  const body = document.getElementById("admin-tab-body");
  body.innerHTML = `<p style="color:var(--muted); font-size:0.85rem;">Cargando…</p>`;
  const orders = await api("orders.php?scope=all");

  const porPagar = orders.filter(o => !o.paymentConfirmed && o.status !== "Cancelado");
  const realizados = orders.filter(o => o.paymentConfirmed);
  const totalFacturado = realizados.reduce((s, o) => s + o.total, 0);

  const byStatus = {};
  ORDER_STATUSES.forEach(s => { byStatus[s] = 0; });
  orders.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });

  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent">
        <div class="stat-value">${porPagar.length}</div>
        <div class="stat-label">⏳ Pedidos por pagar</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${realizados.length}</div>
        <div class="stat-label">✅ Pedidos realizados</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmt(totalFacturado)}</div>
        <div class="stat-label">💰 Total facturado (pagados)</div>
      </div>
    </div>
    <p class="field-group-title" style="margin-top:0;">Pedidos por estado</p>
    <div class="status-breakdown">
      ${ORDER_STATUSES.map(s => `<span class="status-breakdown-item">${escapeHtml(s)}: ${byStatus[s]}</span>`).join("")}
    </div>
    <button class="btn-secondary" id="dash-go-orders">Ver pedidos por pagar →</button>
  `;

  document.getElementById("dash-go-orders").addEventListener("click", () => {
    ADMIN_ORDERS_FILTER = "pending";
    renderAdmin("pedidos");
  });
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
    <p style="font-size:0.78rem; color:var(--muted); margin:0 0 10px;">Arrastrá ⠿ (o usá las flechas) para cambiar el orden — es el mismo orden en que se ven en la tienda.</p>
    <div id="admin-product-list"></div>
  `;
  document.getElementById("new-product-btn").addEventListener("click", () => renderProductForm(null));
  const list = document.getElementById("admin-product-list");
  list.innerHTML = STATE.products.map((p, i) => `
    <div class="admin-row reorder-row" data-id="${p.id}">
      <span class="drag-handle" title="Arrastrar para reordenar">⠿</span>
      <div class="thumb-sm">${p.image ? `<img src="${p.image}">` : "🕊️"}</div>
      <div class="grow"><p>${escapeHtml(p.name)}</p><p class="muted">${escapeHtml(p.category)}</p></div>
      <div class="reorder-arrows">
        <button class="reorder-btn move-up" data-id="${p.id}" ${i === 0 ? "disabled" : ""} title="Subir">▲</button>
        <button class="reorder-btn move-down" data-id="${p.id}" ${i === STATE.products.length - 1 ? "disabled" : ""} title="Bajar">▼</button>
      </div>
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
  list.querySelectorAll(".move-up").forEach(b => b.addEventListener("click", () => moveProduct(Number(b.dataset.id), -1)));
  list.querySelectorAll(".move-down").forEach(b => b.addEventListener("click", () => moveProduct(Number(b.dataset.id), 1)));
  wireProductDragReorder(list);
}

// Reordena de a una posición: fallback simple y 100% táctil para cuando
// arrastrar no es cómodo (listas largas, pantallas chicas).
function moveProduct(id, delta) {
  const idx = STATE.products.findIndex(p => p.id === id);
  const newIdx = idx + delta;
  if (idx < 0 || newIdx < 0 || newIdx >= STATE.products.length) return;
  const arr = STATE.products;
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  renderAdminProducts();
  saveProductOrder();
}

async function saveProductOrder() {
  const fd = new FormData();
  fd.append("action", "reorder");
  fd.append("ids", JSON.stringify(STATE.products.map(p => p.id)));
  try {
    STATE.products = await api("products.php", { method: "POST", form: fd });
  } catch (e) { showToast(e.message); }
}

// Drag & drop genérico con Pointer Events (funciona con mouse y con dedo en
// el celular, a diferencia del drag-and-drop nativo de HTML que no anda bien
// en pantallas táctiles). Reordena los hijos de `container` visualmente;
// al soltar llama a onDrop(container) para que quien lo use lea el nuevo
// orden (vía los data-* de cada fila) y lo guarde donde corresponda.
function makeDragReorderable(container, rowSelector, handleSelector, onDrop) {
  let dragEl = null;

  function onPointerMove(e) {
    if (!dragEl) return;
    const y = e.clientY;
    for (const row of container.children) {
      if (row === dragEl) continue;
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dragIsAfter = !!(row.compareDocumentPosition(dragEl) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (dragIsAfter && y < mid) { container.insertBefore(dragEl, row); break; }
      if (!dragIsAfter && y > mid) { container.insertBefore(dragEl, row.nextSibling); break; }
    }
  }

  function onPointerUp() {
    if (!dragEl) return;
    dragEl.classList.remove("dragging");
    dragEl = null;
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    onDrop(container);
  }

  container.querySelectorAll(handleSelector).forEach(handle => {
    handle.addEventListener("pointerdown", (e) => {
      dragEl = handle.closest(rowSelector);
      if (!dragEl) return;
      dragEl.classList.add("dragging");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      e.preventDefault();
      e.stopPropagation();
    });
  });
}

function wireProductDragReorder(list) {
  makeDragReorderable(list, ".reorder-row", ".drag-handle", () => {
    const newIds = [...list.children].map(row => Number(row.dataset.id));
    const byId = new Map(STATE.products.map(p => [p.id, p]));
    STATE.products = newIds.map(id => byId.get(id)).filter(Boolean);
    renderAdminProducts();
    saveProductOrder();
  });
}

function renderProductForm(product) {
  const body = document.getElementById("admin-tab-body");
  const form = product ? JSON.parse(JSON.stringify(product)) : {
    id: null, name: "", category: CATEGORIES[0], description: "", image: "",
    isOffer: false, offerPrice: null, stock: 20, variantGroups: [], tiers: [{ minQty: 1, price: 0 }],
  };
  // tempId para relacionar inputs de imagen de opciones nuevas. Los grupos
  // que ya existían arrancan colapsados (menos lío visual con muchos
  // grupos/opciones); uno recién agregado arranca abierto.
  form.variantGroups.forEach(g => {
    g._open = false;
    g.options.forEach(o => { if (!o.tempId) o.tempId = uid(); });
  });
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
      form.variantGroups.push({ id: uid(), name: "", options: [{ tempId: uid(), value: "", image: "", tiers: [] }], _open: true });
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

  const openOptionTiers = new Set(); // tempId de opciones con su editor de precio propio abierto (solo UI, no se guarda)

  function drawGroups() {
    const wrap = document.getElementById("groups-wrap");
    wrap.innerHTML = form.variantGroups.map((g, gi) => `
      <div class="variant-group-box" data-gi="${gi}">
        <div class="variant-group-header">
          <span class="drag-handle group-drag-handle" title="Arrastrar para reordenar">⠿</span>
          <span class="variant-group-title"><span class="title-name" data-gi="${gi}">${escapeHtml(g.name) || "Nuevo grupo"}</span> <span class="muted">(${g.options.length} ${g.options.length === 1 ? "opción" : "opciones"})</span></span>
          <div class="reorder-arrows">
            <button class="reorder-btn move-group-up" data-gi="${gi}" ${gi === 0 ? "disabled" : ""} title="Subir">▲</button>
            <button class="reorder-btn move-group-down" data-gi="${gi}" ${gi === form.variantGroups.length - 1 ? "disabled" : ""} title="Bajar">▼</button>
          </div>
          <button class="btn-danger remove-group" data-gi="${gi}">🗑</button>
        </div>
        <div class="center-tab-wrap">
          <button class="center-tab group-toggle-tab" data-gi="${gi}">
            <span class="chevron ${g._open ? "open" : ""}"></span>
          </button>
        </div>
        <div class="variant-group-body ${g._open ? "" : "hidden"}">
          <div style="display:flex; gap:8px; margin-bottom:8px;">
            <input type="text" class="group-name" data-gi="${gi}" placeholder="Nombre (ej: Color)" value="${escapeHtml(g.name)}" style="flex:1;">
          </div>
          <div class="options-list" data-gi="${gi}">
            ${g.options.map((o, oi) => {
              const hasOwnPrice = o.tiers && o.tiers.length > 0;
              const isOpen = openOptionTiers.has(o.tempId) || hasOwnPrice;
              return `
              <div class="variant-option-block" data-gi="${gi}" data-oi="${oi}">
                <div class="variant-option-row" data-gi="${gi}" data-oi="${oi}">
                  <span class="drag-handle option-drag-handle" title="Arrastrar para reordenar">⠿</span>
                  <div class="upload-preview sm opt-preview" data-gi="${gi}" data-oi="${oi}">${o.image ? `<img src="${o.image}">` : "🕊️"}</div>
                  <input type="text" class="option-value" data-gi="${gi}" data-oi="${oi}" placeholder="Ej: Rojo" value="${escapeHtml(o.value)}" style="flex:1;">
                  <div class="reorder-arrows">
                    <button class="reorder-btn move-opt-up" data-gi="${gi}" data-oi="${oi}" ${oi === 0 ? "disabled" : ""} title="Subir">▲</button>
                    <button class="reorder-btn move-opt-down" data-gi="${gi}" data-oi="${oi}" ${oi === g.options.length - 1 ? "disabled" : ""} title="Bajar">▼</button>
                  </div>
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
                </div>
              </div>`;
            }).join("")}
          </div>
          <button class="btn-secondary add-option" data-gi="${gi}">+ Agregar opción</button>
          <p style="font-size:0.72rem; color:var(--muted); margin:6px 0 0;">Si una variante (ej: "7 colores" o "Combinado") vale distinto según la cantidad, ponele su propio precio. Si no, deja "sin precio propio" y usa el precio general de más abajo.</p>
        </div>
      </div>
    `).join("");

    wrap.querySelectorAll(".group-toggle-tab").forEach(b => b.addEventListener("click", () => {
      form.variantGroups[Number(b.dataset.gi)]._open = !form.variantGroups[Number(b.dataset.gi)]._open;
      drawGroups();
    }));
    wrap.querySelectorAll(".move-group-up").forEach(b => b.addEventListener("click", () => moveGroup(Number(b.dataset.gi), -1)));
    wrap.querySelectorAll(".move-group-down").forEach(b => b.addEventListener("click", () => moveGroup(Number(b.dataset.gi), 1)));
    wrap.querySelectorAll(".move-opt-up").forEach(b => b.addEventListener("click", () => moveOption(Number(b.dataset.gi), Number(b.dataset.oi), -1)));
    wrap.querySelectorAll(".move-opt-down").forEach(b => b.addEventListener("click", () => moveOption(Number(b.dataset.gi), Number(b.dataset.oi), 1)));
    makeDragReorderable(wrap, ".variant-group-box", ".group-drag-handle", () => {
      const newGis = [...wrap.children].map(el => Number(el.dataset.gi));
      form.variantGroups = newGis.map(i => form.variantGroups[i]);
      drawGroups();
    });
    wrap.querySelectorAll(".options-list").forEach(listEl => {
      const gi = Number(listEl.dataset.gi);
      makeDragReorderable(listEl, ".variant-option-block", ".option-drag-handle", () => {
        const newOis = [...listEl.children].map(el => Number(el.dataset.oi));
        const g = form.variantGroups[gi];
        g.options = newOis.map(i => g.options[i]);
        drawGroups();
      });
    });

    wrap.querySelectorAll(".group-name").forEach(inp => inp.addEventListener("input", e => {
      const gi = e.target.dataset.gi;
      form.variantGroups[gi].name = e.target.value;
      const titleEl = wrap.querySelector(`.title-name[data-gi="${gi}"]`);
      if (titleEl) titleEl.textContent = e.target.value || "Nuevo grupo";
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
      const opt = form.variantGroups[Number(b.dataset.gi)].options[Number(b.dataset.oi)];
      if (openOptionTiers.has(opt.tempId)) {
        openOptionTiers.delete(opt.tempId);
      } else {
        openOptionTiers.add(opt.tempId);
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
      const opt = form.variantGroups[Number(b.dataset.gi)].options[Number(b.dataset.oi)];
      opt.tiers = [];
      openOptionTiers.delete(opt.tempId);
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

  // Reordenar de a una posición con flechas: alternativa siempre confiable
  // al arrastre, sobre todo en pantallas chicas o con muchos grupos/opciones.
  function moveGroup(gi, delta) {
    const newGi = gi + delta;
    if (newGi < 0 || newGi >= form.variantGroups.length) return;
    const arr = form.variantGroups;
    [arr[gi], arr[newGi]] = [arr[newGi], arr[gi]];
    drawGroups();
  }
  function moveOption(gi, oi, delta) {
    const arr = form.variantGroups[gi].options;
    const newOi = oi + delta;
    if (newOi < 0 || newOi >= arr.length) return;
    [arr[oi], arr[newOi]] = [arr[newOi], arr[oi]];
    drawGroups();
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
let ADMIN_ORDERS_FILTER = "pending"; // "pending" (por pagar) | "paid" (realizados/archivo)

async function renderAdminOrders() {
  const body = document.getElementById("admin-tab-body");
  body.innerHTML = `<p style="color:var(--muted); font-size:0.85rem;">Cargando…</p>`;
  const allOrders = await api("orders.php?scope=all");

  const filterBarHtml = `
    <div class="order-filter">
      <button class="chip order-filter-opt ${ADMIN_ORDERS_FILTER === "pending" ? "active" : ""}" data-filter="pending">⏳ Por pagar</button>
      <button class="chip order-filter-opt ${ADMIN_ORDERS_FILTER === "paid" ? "active" : ""}" data-filter="paid">✅ Realizados</button>
      <button class="chip order-filter-opt ${ADMIN_ORDERS_FILTER === "cancelled" ? "active" : ""}" data-filter="cancelled">❌ Cancelados</button>
    </div>
  `;

  // Un pedido cancelado no queda "por pagar" aunque nunca se haya cobrado:
  // no hay nada que cobrar, así que tiene su propio filtro en vez de
  // ensuciar la cola de pedidos pendientes de pago.
  const orders = allOrders.filter(o => {
    if (ADMIN_ORDERS_FILTER === "paid") return o.paymentConfirmed;
    if (ADMIN_ORDERS_FILTER === "cancelled") return o.status === "Cancelado";
    return !o.paymentConfirmed && o.status !== "Cancelado";
  });

  const emptyMsg = { pending: "No hay pedidos por pagar.", paid: "Todavía no hay pedidos realizados.", cancelled: "No hay pedidos cancelados." }[ADMIN_ORDERS_FILTER];
  if (orders.length === 0) {
    body.innerHTML = filterBarHtml + `<p style="color:var(--muted); font-size:0.9rem;">${emptyMsg}</p>`;
  } else {
    body.innerHTML = filterBarHtml + orders.map(o => {
      const phone = (o.shipping && o.shipping.phone) || "";
      return `
      <details class="order-card">
        <summary class="order-summary">
          <div class="order-summary-top">
            <span class="status ${statusClass(o.status)}">${escapeHtml(o.status)}</span>
            <span class="order-summary-total">${fmt(o.total)}</span>
          </div>
          <div class="order-summary-bottom">
            <span>Pedido #${o.id} — ${escapeHtml(o.customerName)}</span>
            <span>${parseServerDate(o.createdAt).toLocaleDateString("es-AR")}</span>
          </div>
        </summary>
        <div class="order-details">
          <p style="margin:0 0 4px; color:var(--muted); font-size:0.8rem;">${escapeHtml(o.customerEmail)}</p>
          ${phone ? `<p style="margin:0 0 8px; font-size:0.85rem;">📞 <a href="https://wa.me/${phone.replace(/\D/g, "")}" target="_blank" rel="noreferrer" style="color:var(--accent);">${escapeHtml(phone)}</a></p>` : ""}
          <p style="margin:0 0 6px; color:var(--muted); font-size:0.8rem;">${parseServerDate(o.createdAt).toLocaleString("es-AR")} · ${escapeHtml(o.paymentMethod === "mercadopago" ? "Mercado Pago" : "Transferencia")}</p>
          <p style="margin:0 0 8px; font-size:0.8rem; font-weight:600;">${o.deliveryMethod === "retiro" ? "🏬 Retiro en el local" : "🚚 Envío a domicilio"}</p>
          ${o.items.map(it => `<p style="margin:2px 0; color:var(--muted);">${it.qty}x ${escapeHtml(it.name)} ${it.label ? `(${escapeHtml(it.label)})` : ""}</p>`).join("")}
          <select class="status-select" data-id="${o.id}" style="margin:8px 0;">
            ${ORDER_STATUSES.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          ${o.deliveryMethod === "retiro" ? "" : `
          <div class="tracking-fields" data-id="${o.id}" style="display:flex; gap:6px; margin-bottom:6px;">
            <input type="text" class="tracking-code-input" data-id="${o.id}" placeholder="Código de seguimiento" value="${escapeHtml(o.trackingCode || "")}" style="flex:1;">
            <input type="text" class="carrier-input" data-id="${o.id}" placeholder="Empresa de envío o link" value="${escapeHtml(o.carrier || "")}" style="flex:1;">
          </div>`}
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-secondary save-order-btn" data-id="${o.id}">Guardar cambios</button>
            <button class="btn-secondary print-order-btn" data-id="${o.id}">🖨️ Imprimir ticket</button>
            <button class="btn-secondary mark-paid-btn" data-id="${o.id}" data-paid="${o.paymentConfirmed ? "1" : "0"}">${o.paymentConfirmed ? "↩️ Marcar como no pagado" : "💰 Marcar como pagado"}</button>
          </div>
        </div>
      </details>
    `;
    }).join("");
  }

  body.querySelectorAll(".order-filter-opt").forEach(btn => btn.addEventListener("click", () => {
    ADMIN_ORDERS_FILTER = btn.dataset.filter;
    renderAdminOrders();
  }));

  body.querySelectorAll(".save-order-btn").forEach(btn => btn.addEventListener("click", async () => {
    const id = Number(btn.dataset.id);
    const status = document.querySelector(`.status-select[data-id="${id}"]`).value;
    const trackingCode = document.querySelector(`.tracking-code-input[data-id="${id}"]`)?.value || "";
    const carrier = document.querySelector(`.carrier-input[data-id="${id}"]`)?.value || "";
    try {
      await api("orders.php", { method: "POST", json: { action: "update_status", id, status, trackingCode, carrier } });
      showToast("Pedido actualizado.");
    } catch (e) { showToast(e.message); }
  }));

  body.querySelectorAll(".print-order-btn").forEach(btn => btn.addEventListener("click", () => {
    const order = orders.find(o => o.id === Number(btn.dataset.id));
    if (order) printOrderTicket(order);
  }));

  body.querySelectorAll(".mark-paid-btn").forEach(btn => btn.addEventListener("click", async () => {
    const id = Number(btn.dataset.id);
    const paid = btn.dataset.paid !== "1";
    try {
      await api("orders.php", { method: "POST", json: { action: "set_payment", id, paid } });
      showToast(paid ? "Pedido marcado como pagado." : "Pedido marcado como no pagado.");
      renderAdminOrders();
    } catch (e) { showToast(e.message); }
  }));
}

function printOrderTicket(o) {
  const sh = o.shipping || {};
  const html = `
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
      <p class="muted">${parseServerDate(o.createdAt).toLocaleString("es-AR")}</p>
      <p style="font-weight:bold; margin:4px 0;">${o.deliveryMethod === "retiro" ? "🏬 RETIRA EN EL LOCAL" : "🚚 ENVÍO A DOMICILIO"}</p>
      <hr>
      <strong>Cliente</strong>
      <p style="margin:4px 0;">
        ${escapeHtml(sh.name || o.customerName || "")}<br>
        ${escapeHtml(sh.phone || "")}${o.deliveryMethod === "retiro" ? "" : `<br>
        ${escapeHtml(sh.address || "")}${sh.city ? ", " + escapeHtml(sh.city) : ""}${sh.province ? ", " + escapeHtml(sh.province) : ""}${sh.postal_code ? " (CP " + escapeHtml(sh.postal_code) + ")" : ""}`}
      </p>
      <hr>
      <strong>Productos</strong>
      <table>
        ${o.items.map(it => `<tr><td>${it.qty}x ${escapeHtml(it.name)}${it.label ? " (" + escapeHtml(it.label) + ")" : ""}</td><td style="text-align:right;">${fmt(it.unitPrice * it.qty)}</td></tr>`).join("")}
      </table>
      <p class="total">Total: ${fmt(o.total)}</p>
      <p class="muted">Pago: ${o.paymentMethod === "mercadopago" ? "Mercado Pago" : "Transferencia"}</p>
    </body></html>
  `;

  // Se usa un iframe oculto en vez de una ventana emergente: así no depende
  // del bloqueador de pop-ups, y el diálogo de impresión del navegador deja
  // elegir "Guardar como PDF" como destino para generar el archivo.
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;";
  document.body.appendChild(iframe);

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.onload = doPrint;
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(doPrint, 400); // respaldo si el navegador no dispara "load" con document.write
}

/* ---- Admin: configuración ---- */
function renderAdminSettings() {
  const body = document.getElementById("admin-tab-body");
  const s = STATE.settings;
  let logoFile = null, heroFile = null, heroMobileFile = null, catalogFile = null;

  body.innerHTML = `
    <label class="field-label">Logo de la tienda</label>
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
      <div class="upload-preview" id="logo-preview">${s.store_logo ? `<img src="${s.store_logo}">` : "🕊️"}</div>
      <button class="btn-secondary" id="logo-btn">📷 Subir</button>
      <input type="file" accept="image/*" id="logo-input" class="hidden">
    </div>

    <label class="field-label">Foto de fondo — horizontal (desktop)</label>
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
      <div class="upload-preview" id="hero-preview" style="width:96px;">${s.hero_image ? `<img src="${s.hero_image}">` : "🕊️"}</div>
      <button class="btn-secondary" id="hero-btn">📷 Subir</button>
      <input type="file" accept="image/*" id="hero-input" class="hidden">
    </div>
    <p style="font-size:0.72rem; color:var(--muted); margin:0 0 14px;">Se usa en pantallas anchas (computadora, tablet).</p>

    <label class="field-label">Foto de fondo — vertical (celular)</label>
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
      <div class="upload-preview" id="hero-mobile-preview" style="width:70px; height:110px;">${s.hero_image_mobile ? `<img src="${s.hero_image_mobile}">` : "🕊️"}</div>
      <button class="btn-secondary" id="hero-mobile-btn">📷 Subir</button>
      <input type="file" accept="image/*" id="hero-mobile-input" class="hidden">
    </div>
    <p style="font-size:0.72rem; color:var(--muted); margin:0 0 14px;">Opcional — una foto en formato vertical (más alta que ancha) que se muestra solo en el celular, en vez de recortar la horizontal. Si no cargás una, se usa la horizontal en todas las pantallas.</p>

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
      <label class="field-label">Tu WhatsApp personal, para recibir el aviso (con código de país, ej: 5491122334455)</label>
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
    <div class="field"><label class="field-label">WhatsApp del local, el que ven tus clientes (con código de país, ej: 5491122334455)</label><input type="text" id="s-wa" value="${escapeHtml(s.whatsapp || "")}"></div>
    <div class="field"><label class="field-label">Titular de la cuenta</label><input type="text" id="s-titular" value="${escapeHtml(s.titular || "")}"></div>
    <div class="field"><label class="field-label">Alias bancario</label><input type="text" id="s-alias" value="${escapeHtml(s.alias || "")}"></div>
    <div class="field"><label class="field-label">CBU</label><input type="text" id="s-cbu" value="${escapeHtml(s.cbu || "")}"></div>
    <div class="field"><label class="field-label">Link de pago de Mercado Pago</label><input type="text" id="s-mp" value="${escapeHtml(s.mp_link || "")}"></div>
    <div class="field"><label class="field-label">Usuario administrador</label><input type="text" id="s-user" value="${escapeHtml(s.admin_user || "")}"></div>
    <div class="field"><label class="field-label">Nueva contraseña (dejar vacío para no cambiarla)</label>${pwFieldHtml("s-pass")}</div>

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
  document.getElementById("hero-mobile-btn").addEventListener("click", () => document.getElementById("hero-mobile-input").click());
  document.getElementById("hero-mobile-input").addEventListener("change", e => {
    heroMobileFile = e.target.files[0];
    if (heroMobileFile) document.getElementById("hero-mobile-preview").innerHTML = `<img src="${URL.createObjectURL(heroMobileFile)}">`;
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
    if (heroMobileFile) fd.append("hero_image_mobile", heroMobileFile);
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
  const resetToken = params.get("reset");
  if (resetToken) {
    RESET_TOKEN = resetToken;
    history.replaceState(null, "", window.location.pathname); // saca el token de la URL visible
  }

  try { CSRF_TOKEN = (await api("csrf.php")).token; } catch (e) {}

  await loadSettings();
  await loadCategories();
  await loadProducts();
  await refreshCustomerSession();
  await refreshAdminSession();

  if (RESET_TOKEN && !STATE.customer) {
    openAccount("reset");
  }

  if (STATE.viewFilter) {
    const banner = document.getElementById("view-filter-banner");
    const label = STATE.viewFilter === "novedades" ? "Novedades" : "Ofertas";
    banner.innerHTML = `<span class="chip active">Viendo: ${label}</span> <a href="index.html" style="font-size:0.8rem; color:var(--accent);">Ver todo el catálogo</a>`;
    banner.classList.remove("hidden");
    document.getElementById("filters-bar").scrollIntoView({ behavior: "smooth", block: "start" });
  }
})();
