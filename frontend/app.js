const API_BASE = '/api';
// AI Service URL: direct connection in local dev, proxied via nginx in Docker
const AI_SERVICE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://127.0.0.1:8000'
  : '/ai';

let currentUser = null;
let authToken = localStorage.getItem('bakery_jwt') || null;
let categoriesList = [];
let ingredientsList = [];
let productsList = [];
let employeesList = [];
let suppliersList = [];
let usersList = [];
let purchaseOrdersList = [];
let customerOrdersList = [];

// ===== RBAC UI Visibility (frontend-only) =====
// Backend authorization remains the single source of truth; these rules
// only control what the UI reveals to each role.
const ROLE_TABS = {
  ADMIN: ['catalog', 'ingredients', 'production', 'sales', 'employees', 'suppliers', 'categories', 'purchase-orders', 'customer-orders', 'forecast'],
  STOCK: ['ingredients', 'suppliers', 'purchase-orders', 'forecast'],
  CASHIER: ['sales', 'customer-orders', 'forecast'],
  PRODUCTION: ['catalog', 'ingredients', 'production', 'customer-orders', 'purchase-orders', 'forecast'],
  EMPLOYEE: ['employees', 'forecast']
};

// Static header action buttons -> roles allowed to see them.
const BUTTON_ROLES = {
  'open-create-product-btn': ['ADMIN', 'PRODUCTION'],
  'open-movement-btn': ['ADMIN', 'STOCK'],
  'open-create-ingredient-btn': ['ADMIN', 'STOCK'],
  'open-create-employee-btn': ['ADMIN'],
  'open-create-schedule-btn': ['ADMIN'],
  'open-create-leave-btn': ['ADMIN', 'EMPLOYEE'],
  'open-create-supplier-btn': ['ADMIN', 'STOCK'],
  'open-create-category-btn': ['ADMIN'],
  'open-create-po-btn': ['ADMIN', 'STOCK'],
  'open-create-co-btn': ['ADMIN', 'CASHIER']
};

function getRole() {
  return currentUser ? currentUser.role : '';
}

function hasAnyRole(...roles) {
  const role = getRole();
  return role !== '' && roles.includes(role);
}

function requireRoleFor(...roles) {
  if (!hasAnyRole(...roles)) {
    showToast('Accès refusé : votre rôle ne permet pas cette action.', true);
    return false;
  }
  return true;
}

function canViewSales() {
  return hasAnyRole('ADMIN', 'CASHIER', 'PRODUCTION');
}

// Applies tab + action-button visibility based on the current user's role.
// Called whenever the authenticated user (or their role) changes.
function applyRoleVisibility() {
  const role = getRole();
  const allowedTabs = role && ROLE_TABS[role] ? ROLE_TABS[role] : null; // null => all tabs

  const allTabs = Array.from(document.querySelectorAll('.tab-btn'));
  const allContents = Array.from(document.querySelectorAll('.tab-content'));

  allTabs.forEach((tab) => {
    const visible = !allowedTabs || allowedTabs.includes(tab.dataset.tab);
    tab.style.display = visible ? '' : 'none';
    if (!visible) {
      const content = document.getElementById('tab-' + tab.dataset.tab);
      if (content) content.classList.remove('active');
    }
  });

  // If the active tab became hidden, switch to the first visible tab.
  const activeTab = allTabs.find((t) => t.classList.contains('active'));
  const activeStillVisible = activeTab && activeTab.style.display !== 'none';
  if (!activeStillVisible && allTabs.length) {
    const firstVisible = allTabs.find((t) => t.style.display !== 'none');
    if (firstVisible) {
      allTabs.forEach((t) => t.classList.remove('active'));
      allContents.forEach((c) => c.classList.remove('active'));
      firstVisible.classList.add('active');
      const target = document.getElementById('tab-' + firstVisible.dataset.tab);
      if (target) target.classList.add('active');
    }
  }

  // Gate the static header action buttons.
  Object.entries(BUTTON_ROLES).forEach(([id, roles]) => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = roles.includes(role) ? '' : 'none';
  });

  // EMPLOYEE: hide the employee directory and the admin-only leave-form
  // controls so they only manage their own profile / schedules / leaves.
  if (currentUser) {
    const isEmployee = role === 'EMPLOYEE';
    const dir = document.getElementById('employee-directory-container');
    if (dir) dir.style.display = isEmployee ? 'none' : '';
    const empField = document.getElementById('leave-employee-field');
    if (empField) empField.style.display = isEmployee ? 'none' : '';
    const statusField = document.getElementById('leave-status-field');
    if (statusField) statusField.style.display = isEmployee ? 'none' : '';
  }
}


document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initAuth();
  await loadAllData();
  initSales();

  // Refresh Buttons
  document.getElementById('refresh-products').addEventListener('click', fetchProducts);
  document.getElementById('refresh-ingredients').addEventListener('click', fetchIngredients);
  document.getElementById('refresh-sales').addEventListener('click', loadSalesData);
  document.getElementById('refresh-employees').addEventListener('click', fetchEmployees);
  document.getElementById('refresh-schedules').addEventListener('click', fetchSchedules);
  document.getElementById('refresh-leaves').addEventListener('click', fetchLeaves);
  document.getElementById('refresh-suppliers').addEventListener('click', fetchSuppliers);
  document.getElementById('open-create-employee-btn').addEventListener('click', () => openEmployeeModal());
  document.getElementById('open-create-schedule-btn').addEventListener('click', openScheduleModal);
  document.getElementById('open-create-leave-btn').addEventListener('click', openLeaveModal);
  document.getElementById('open-create-supplier-btn').addEventListener('click', () => openSupplierModal());

  // Sales Events
  document.getElementById('open-new-sale-item-btn').addEventListener('click', () => addSaleItemRow());
  document.getElementById('add-sale-item-btn').addEventListener('click', () => addSaleItemRow());
  document.getElementById('sales-filter-period').addEventListener('change', loadSalesHistory);
  document.getElementById('sales-filter-product').addEventListener('change', loadSalesHistory);
  document.getElementById('sales-filter-start').addEventListener('change', loadSalesHistory);
  document.getElementById('sales-filter-end').addEventListener('change', loadSalesHistory);
  document.getElementById('sales-form').addEventListener('submit', handleSalesSubmit);
      document.getElementById('forecast-product-select').addEventListener('change', loadForecast);
  document.getElementById('refresh-forecast-btn').addEventListener('click', loadForecast);
  document.getElementById('run-etl-btn').addEventListener('click', runEtl);

  // Search & Filter Events
  document.getElementById('search-products').addEventListener('input', renderProducts);
  document.getElementById('filter-product-category').addEventListener('change', renderProducts);

  document.getElementById('search-ingredients').addEventListener('input', renderIngredients);
  document.getElementById('filter-stock-status').addEventListener('change', fetchIngredients);

  // Form Submissions
  document.getElementById('production-form').addEventListener('submit', handleProduction);
  document.getElementById('product-form').addEventListener('submit', handleSaveProduct);
  document.getElementById('category-form').addEventListener('submit', handleSaveCategory);
  document.getElementById('recipe-form').addEventListener('submit', handleSaveRecipe);
  document.getElementById('ingredient-form').addEventListener('submit', handleSaveIngredient);
  document.getElementById('movement-form').addEventListener('submit', handleSaveMovement);
  document.getElementById('prod-product-select').addEventListener('change', updateRecipePreview);

  // Open Modal Buttons
  document.getElementById('open-create-product-btn').addEventListener('click', () => openProductModal());
  document.getElementById('open-create-ingredient-btn').addEventListener('click', () => openIngredientModal());
  document.getElementById('open-create-category-btn').addEventListener('click', () => openCategoryModal());
  document.getElementById('open-movement-btn').addEventListener('click', () => openMovementModal());
  document.getElementById('add-recipe-row-btn').addEventListener('click', () => addRecipeRow());
  document.getElementById('employee-form').addEventListener('submit', handleSaveEmployee);
  document.getElementById('schedule-form').addEventListener('submit', handleSaveSchedule);
  document.getElementById('leave-form').addEventListener('submit', handleSaveLeave);
  document.getElementById('supplier-form').addEventListener('submit', handleSaveSupplier);

  // Sprint 4 Events
  document.getElementById('refresh-purchase-orders').addEventListener('click', fetchPurchaseOrders);
  document.getElementById('refresh-customer-orders').addEventListener('click', fetchCustomerOrders);
  document.getElementById('open-create-po-btn').addEventListener('click', () => openPurchaseOrderModal());
  document.getElementById('open-create-co-btn').addEventListener('click', () => openCustomerOrderModal());
  document.getElementById('filter-po-status').addEventListener('change', fetchPurchaseOrders);
  document.getElementById('filter-po-supplier').addEventListener('change', fetchPurchaseOrders);
  document.getElementById('filter-co-status').addEventListener('change', fetchCustomerOrders);
  document.getElementById('filter-co-delivery-date').addEventListener('change', fetchCustomerOrders);
  document.getElementById('add-po-item-btn').addEventListener('click', () => addPoItemRow());
  document.getElementById('add-co-item-btn').addEventListener('click', () => addCoItemRow());
  document.getElementById('po-form').addEventListener('submit', handleSavePurchaseOrder);
  document.getElementById('co-form').addEventListener('submit', handleSaveCustomerOrder);
});

// Toast notification helper
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#ef4444' : '#10b981';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

// Safe Fetch JSON Utility preventing Unexpected token '<' crashes
async function safeFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Erreur HTTP ${res.status}`);
    }
    return data;
  } else {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Erreur serveur (${res.status}): ${text.substring(0, 100)}...`);
    }
    throw new Error('Réponse serveur non JSON invalide.');
  }
}

// Safe text fetch helper for HTML ticket content
async function safeFetchText(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Erreur HTTP ${res.status}`);
  }
  return text;
}

// Load All Initial Data
async function loadAllData() {
  await fetchCategories();
  await fetchIngredients();
  await fetchProducts();
  await fetchAlerts();
  await loadSalesData();
  if (authToken) {
    await loadAuthDependentData();
  }
}

async function loadAuthDependentData() {
  const tasks = [];
  tasks.push(fetchEmployees());
  if (hasAnyRole('ADMIN', 'STOCK', 'PRODUCTION')) tasks.push(fetchSuppliers());
  if (hasAnyRole('ADMIN', 'EMPLOYEE')) {
    tasks.push(fetchSchedules());
    tasks.push(fetchLeaves());
  }
  if (hasAnyRole('ADMIN', 'STOCK', 'PRODUCTION')) tasks.push(fetchPurchaseOrders());
  if (hasAnyRole('ADMIN', 'CASHIER', 'PRODUCTION')) tasks.push(fetchCustomerOrders());
  if (hasAnyRole('ADMIN')) tasks.push(fetchAvailableUsers());
  try {
    await Promise.all(tasks);
  } catch (err) {
    console.warn('Chargement des données authentifiées échoué:', err);
  }
}

function initSales() {
  document.getElementById('sales-items-container').innerHTML = '';
  addSaleItemRow();
  populateSalesProductFilter();
  if (authToken && canViewSales()) {
    loadSalesMetrics();
    loadSalesHistory();
  } else {
    renderSalesMetricsPlaceholder();
    renderSalesHistoryPlaceholder();
  }
}

async function loadSalesData() {
  if (!authToken || !canViewSales()) {
    renderSalesMetricsPlaceholder();
    renderSalesHistoryPlaceholder();
    return;
  }
  await Promise.all([loadSalesMetrics(), loadSalesHistory()]);
}

function populateSalesProductFilter() {
  const productFilter = document.getElementById('sales-filter-product');
  productFilter.innerHTML = '<option value="">Tous les produits</option>';
  productsList.forEach((product) => {
    const opt = document.createElement('option');
    opt.value = product.id;
    opt.textContent = `${product.name}`;
    productFilter.appendChild(opt);
  });
}

function populateForecastProductSelect() {
  const select = document.getElementById('forecast-product-select');
  if (!select) return;
  select.innerHTML = '<option value="">Sélectionnez un produit</option>';
  productsList.forEach((product) => {
    const opt = document.createElement('option');
    opt.value = product.id;
    opt.textContent = product.name;
    select.appendChild(opt);
  });
  if (productsList.length > 0) {
    select.value = String(productsList[0].id);
  }
}

async function loadForecast() {
  const select = document.getElementById('forecast-product-select');
  const productId = select ? select.value : '';
  const valueEl = document.getElementById('forecast-value');
  const confidenceEl = document.getElementById('forecast-confidence');
  const statusEl = document.getElementById('forecast-status');
  const intervalEl = document.getElementById('forecast-interval');

  if (!productId) {
    if (valueEl) valueEl.textContent = '--';
    if (confidenceEl) confidenceEl.textContent = '--';
    if (statusEl) statusEl.textContent = '--';
    if (intervalEl) intervalEl.textContent = 'Intervalle: --';
    return;
  }

  try {
            const res = await fetch(`${AI_SERVICE_URL}/forecast?product_id=${productId}&horizon_days=7`);
    if (!res.ok) {
      throw new Error(`Erreur AI service ${res.status}`);
    }
    const data = await res.json();
    const value = data.value == null ? 'Données insuffisantes' : `${Number(data.value).toFixed(2)} unités`;
    const confidenceLevel = data.confidence && data.confidence.level ? data.confidence.level : 'faible';
    const intervalText = data.confidence && Array.isArray(data.confidence.interval)
      ? `Intervalle: ${data.confidence.interval[0]} à ${data.confidence.interval[1]} unités`
      : 'Intervalle: non disponible';

    if (valueEl) valueEl.textContent = value;
    if (confidenceEl) confidenceEl.textContent = `${confidenceLevel} / ${data.status || 'unknown'}`;
    if (statusEl) statusEl.textContent = data.status || 'unknown';
        if (intervalEl) intervalEl.textContent = intervalText;
  } catch (err) {
    console.error('Forecast load failed:', err);
    if (valueEl) valueEl.textContent = '--';
    if (confidenceEl) confidenceEl.textContent = 'service indisponible';
    if (statusEl) statusEl.textContent = 'insufficient_data';
    if (intervalEl) intervalEl.textContent = 'Intervalle: --';
  }
}

async function runEtl() {
  const etlBtn = document.getElementById('run-etl-btn');
  if (etlBtn) { etlBtn.disabled = true; etlBtn.textContent = '🔄 Extraction...'; }
  try {
        const res = await fetch(`${AI_SERVICE_URL}/etl/run`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`Erreur ETL ${res.status}`);
    }
    const data = await res.json();
    const meta = data.value || {};
    showToast(`ETL terminé : ${meta.rows || 0} lignes, ${meta.product_count || 0} produits`, false);
    // Invalidate cache and reload forecast
    await loadForecast();
  } catch (err) {
    console.error('ETL run failed:', err);
    showToast('Erreur ETL : le service IA est peut-être arrêté', true);
  } finally {
    if (etlBtn) { etlBtn.disabled = false; etlBtn.textContent = '🔄 Lancer ETL'; }
  }
}

function createSaleItemCard(productId = '', quantity = 1) {
  const card = document.createElement('div');
  card.className = 'sale-item-card';

  const productSelect = document.createElement('select');
  productSelect.className = 'form-control';
  productSelect.innerHTML = `<option value="">Sélectionnez un produit</option>`;
  productsList.forEach((product) => {
    const option = document.createElement('option');
    option.value = product.id;
    option.textContent = `${product.name} — ${parseFloat(product.price).toFixed(2)} € — Stock ${product.stock_quantity}`;
    if (product.id == productId) option.selected = true;
    productSelect.appendChild(option);
  });

  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.value = quantity;
  qtyInput.className = 'form-control';

  const subtotalDisplay = document.createElement('div');
  subtotalDisplay.style = 'color: var(--text-secondary); font-size: 0.9rem;';
  subtotalDisplay.textContent = 'Sous-total: 0.00 €';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn btn-danger btn-sm sale-item-remove';
  removeBtn.textContent = '✖';
  removeBtn.addEventListener('click', () => {
    card.remove();
    updateSaleSummary();
  });

  const updateSubtotal = () => {
    const selectedProduct = productsList.find((p) => p.id == productSelect.value);
    const qtyVal = parseInt(qtyInput.value, 10) || 0;
    if (selectedProduct && qtyVal > 0) {
      subtotalDisplay.textContent = `Sous-total: ${(selectedProduct.price * qtyVal).toFixed(2)} €`;
    } else {
      subtotalDisplay.textContent = 'Sous-total: 0.00 €';
    }
    updateSaleSummary();
  };

  productSelect.addEventListener('change', updateSubtotal);
  qtyInput.addEventListener('input', updateSubtotal);

  const productWrapper = document.createElement('div');
  productWrapper.style = 'display: grid; gap: 10px;';
  productWrapper.appendChild(productSelect);
  productWrapper.appendChild(subtotalDisplay);

  card.appendChild(productWrapper);
  card.appendChild(qtyInput);
  card.appendChild(removeBtn);

  return card;
}

function addSaleItemRow(productId = '', quantity = 1) {
  const container = document.getElementById('sales-items-container');
  const card = createSaleItemCard(productId, quantity);
  container.appendChild(card);
  updateSaleSummary();
}

function updateSaleSummary() {
  const saleItems = Array.from(document.querySelectorAll('.sale-item-card'));
  let total = 0;
  let count = 0;

  saleItems.forEach((card) => {
    const productSelect = card.querySelector('select');
    const qtyInput = card.querySelector('input');
    const selectedProduct = productsList.find((p) => p.id == productSelect.value);
    const qty = parseInt(qtyInput.value, 10) || 0;
    if (selectedProduct && qty > 0) {
      total += selectedProduct.price * qty;
      count += qty; // count total quantity, not number of lines
    }
  });

  document.getElementById('sale-items-count').textContent = count;
  document.getElementById('sale-total-amount').textContent = `${total.toFixed(2)} €`;
}

async function handleSalesSubmit(e) {
  e.preventDefault();
  if (!authToken) {
    showToast('Veuillez vous connecter.', true);
    document.getElementById('login-modal').classList.remove('hidden');
    return;
  }

  const saleItems = Array.from(document.querySelectorAll('.sale-item-card')).map((card) => {
    return {
      product_id: parseInt(card.querySelector('select').value, 10),
      quantity: parseInt(card.querySelector('input').value, 10)
    };
  }).filter((item) => item.product_id && item.quantity > 0);

  if (saleItems.length === 0) {
    showToast('Ajoutez au moins un produit avec une quantité valide.', true);
    return;
  }

  const payload = {
    items: saleItems,
    paymentMethod: document.getElementById('sale-payment-method').value,
    customerName: document.getElementById('sale-customer-name').value,
    customerPhone: document.getElementById('sale-customer-phone').value
  };

  try {
    const sale = await safeFetchJson(`${API_BASE}/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(`Vente enregistrée (#${sale.id})`);
    document.getElementById('sales-form').reset();
    document.getElementById('sales-items-container').innerHTML = '';
    addSaleItemRow();
    updateSaleSummary();
    fetchProducts();
    loadSalesData();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadSalesMetrics() {
  try {
    const metrics = await safeFetchJson(`${API_BASE}/sales/metrics`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    const grid = document.getElementById('sales-metrics-grid');
    grid.innerHTML = '';

    const cards = [
      { title: "Revenu du jour", value: `${metrics.day.total_revenue.toFixed(2)} €`, subtitle: `${metrics.day.sales_count} ventes` },
      { title: "Revenu semaine", value: `${metrics.week.total_revenue.toFixed(2)} €`, subtitle: `${metrics.week.sales_count} ventes` },
      { title: "Revenu mois", value: `${metrics.month.total_revenue.toFixed(2)} €`, subtitle: `${metrics.month.sales_count} ventes` },
      { title: "Panier moyen", value: `${metrics.month.average_ticket.toFixed(2)} €`, subtitle: `${metrics.top_products.length} produits vendus` }
    ];

    cards.forEach((cardData) => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.innerHTML = `<h4>${cardData.title}</h4><strong>${cardData.value}</strong><p>${cardData.subtitle}</p>`;
      grid.appendChild(card);
    });
  } catch (err) {
    console.error('Erreur metrics ventes', err);
  }
}

async function loadSalesHistory() {
  try {
    const productId = document.getElementById('sales-filter-product').value;
    const period = document.getElementById('sales-filter-period').value;
    const start = document.getElementById('sales-filter-start').value;
    const end = document.getElementById('sales-filter-end').value;

    let url = `${API_BASE}/sales/history?`;
    const params = new URLSearchParams();
    if (productId) params.append('product_id', productId);
    if (period) params.append('period', period);
    if (start) params.append('start_date', start);
    if (end) params.append('end_date', end);
    url += params.toString();

    // If custom date range provided, prefer it over the period
    const startInput = document.getElementById('sales-filter-start').value;
    const endInput = document.getElementById('sales-filter-end').value;
    let finalUrl = url;
    if (startInput || endInput) {
      const params2 = new URLSearchParams();
      if (productId) params2.append('product_id', productId);
      if (startInput) params2.append('start_date', startInput);
      if (endInput) params2.append('end_date', endInput);
      finalUrl = `${API_BASE}/sales/history?${params2.toString()}`;
    }

    const sales = await safeFetchJson(finalUrl, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    renderSalesHistory(sales);
  } catch (err) {
    showToast('Impossible de charger l\'historique des ventes.', true);
  }
}

function renderSalesHistory(sales) {
  const tbody = document.getElementById('sales-history-tbody');
  tbody.innerHTML = '';

  if (!Array.isArray(sales) || sales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">Aucune vente trouvée pour les filtres sélectionnés.</td></tr>';
    return;
  }

  sales.forEach((sale) => {
    const tr = document.createElement('tr');
    const itemsCount = sale.total_items || (sale.items ? sale.items.reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0) : 0);
    const dateStr = sale.created_at ? new Date(sale.created_at).toLocaleString('fr-FR') : (sale.completed_at ? new Date(sale.completed_at).toLocaleString('fr-FR') : '—');
    tr.innerHTML = `
      <td>${sale.id}</td>
      <td>${dateStr}</td>
      <td>${sale.customer_name || 'Walk-in'}</td>
      <td>${parseFloat(sale.total_amount).toFixed(2)} €</td>
      <td>${itemsCount}</td>
      <td>${sale.payment_method || '—'}</td>
      <td><button class="btn btn-secondary btn-sm" onclick="openSaleTicket(${sale.id})">🎟️ Ticket</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function openSaleTicket(saleId) {
  if (!authToken) {
    showToast('Veuillez vous connecter pour visualiser le ticket.', true);
    return;
  }

  safeFetchText(`${API_BASE}/sales/${saleId}/ticket/html`, {
    headers: { Authorization: `Bearer ${authToken}` }
  })
    .then((htmlText) => {
      const ticketWindow = window.open('', '_blank');
      if (ticketWindow) {
        ticketWindow.document.write(htmlText);
        ticketWindow.document.close();
      } else {
        showToast('Impossible d\'ouvrir le ticket dans une nouvelle fenêtre.', true);
      }
    })
    .catch((err) => {
      showToast(err.message, true);
    });
}

function renderSalesMetricsPlaceholder() {
  const grid = document.getElementById('sales-metrics-grid');
  grid.innerHTML = '<div class="metric-card"><h4>Revenu du jour</h4><strong>—</strong><p>Connectez-vous pour voir les KPI</p></div>'.repeat(4);
}

function renderSalesHistoryPlaceholder() {
  const tbody = document.getElementById('sales-history-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">Connectez-vous pour afficher l\'historique des ventes.</td></tr>';
}

// Tab navigation
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      const targetId = `tab-${tab.dataset.tab}`;
      document.getElementById(targetId).classList.add('active');
    });
  });
}

// Auth Logic
function initAuth() {
  const loginModalBtn = document.getElementById('login-modal-btn');
  const loginForm = document.getElementById('login-form');

  if (loginModalBtn) {
    loginModalBtn.addEventListener('click', () => document.getElementById('login-modal').classList.remove('hidden'));
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email-select').value;
    const password = document.getElementById('login-password').value;

    try {
      const data = await safeFetchJson(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('bakery_jwt', authToken);

      updateUserUI();
      closeModal('login-modal');
      showToast(`Bienvenue, ${currentUser.name} (${currentUser.role})`);
      await loadAuthDependentData();
      loadSalesData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  if (authToken) {
    safeFetchJson(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` }
    })
      .then((user) => {
        if (user && user.id) {
          currentUser = user;
          updateUserUI();
          loadAuthDependentData();
          loadSalesData();
        }
      })
      .catch(() => localStorage.removeItem('bakery_jwt'));
  }
}

function updateUserUI() {
  const profileContainer = document.getElementById('user-profile');
  if (currentUser) {
    profileContainer.innerHTML = `
      <span class="user-badge" style="font-size: 0.85rem; color: var(--accent-cyan); margin-right: 8px;">${currentUser.name} (${currentUser.role})</span>
      <button class="btn btn-secondary btn-sm" onclick="logout()">Déconnexion</button>
    `;
  }
  applyRoleVisibility();
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('bakery_jwt');
  document.getElementById('user-profile').innerHTML = `
    <button class="btn btn-secondary" id="login-modal-btn" onclick="document.getElementById('login-modal').classList.remove('hidden')">Se Connecter</button>
  `;
  showToast('Déconnecté.');
  applyRoleVisibility();
}

// Fetch Alerts
async function fetchAlerts() {
  try {
    const alerts = await safeFetchJson(`${API_BASE}/stocks/alerts`);

    const summaryBadge = document.getElementById('alerts-summary-badge');
    const badgeLow = document.getElementById('badge-low-stock');
    const badgeExp = document.getElementById('badge-expiring');

    if (alerts.low_stock_count > 0 || alerts.expiring_soon_count > 0) {
      summaryBadge.classList.remove('hidden');
      badgeLow.textContent = `⚠️ ${alerts.low_stock_count} Stock Faible`;
      badgeExp.textContent = `⏳ ${alerts.expiring_soon_count} Péremption`;
    } else {
      summaryBadge.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error fetching alerts:', err);
  }
}

async function fetchAvailableUsers() {
  if (!authToken) return;
  try {
    usersList = await safeFetchJson(`${API_BASE}/auth/users`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
  } catch (err) {
    console.warn('Impossible de charger les utilisateurs disponibles:', err);
    usersList = [];
  }
}

async function fetchEmployees() {
  if (!authToken) return;
  try {
    employeesList = await safeFetchJson(`${API_BASE}/employees`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderEmployees();
    populateEmployeeSelects();
  } catch (err) {
    showToast('Erreur chargement employés', true);
  }
}

async function fetchSuppliers() {
  if (!authToken) return;
  try {
    suppliersList = await safeFetchJson(`${API_BASE}/suppliers`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderSuppliers();
    populatePoSupplierFilter();
  } catch (err) {
    showToast('Erreur chargement fournisseurs', true);
  }
}

function populatePoSupplierFilter() {
  const select = document.getElementById('filter-po-supplier');
  if (!select) return;
  select.innerHTML = '<option value="">Tous les fournisseurs</option>';
  suppliersList.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
}

function renderEmployees() {
  const tbody = document.getElementById('employees-tbody');
  tbody.innerHTML = '';

  if (!Array.isArray(employeesList) || employeesList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color: var(--text-secondary);">Aucun employé trouvé.</td></tr>';
    return;
  }

  const canManageEmployees = hasAnyRole('ADMIN');

  employeesList.forEach((employee) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${employee.id}</td>
      <td>${employee.first_name} ${employee.last_name}</td>
      <td>${employee.user_email || '—'}</td>
      <td>${employee.user_role || '—'}</td>
      <td>${employee.job_title || '—'}</td>
      <td>${employee.phone || '—'}</td>
      <td>${employee.hire_date || '—'}</td>
      <td>${employee.address || '—'}</td>
      <td>${canManageEmployees ? `<button class="btn btn-secondary btn-sm" onclick="openEmployeeModal(${employee.id})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${employee.id})">🗑️</button>` : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Fetch & render schedules (requires auth)
async function fetchSchedules() {
  if (!authToken) return;
  try {
    const schedules = await safeFetchJson(`${API_BASE}/employees/schedules`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderSchedules(schedules);
  } catch (err) {
    console.warn('Erreur chargement plannings:', err);
  }
}

function renderSchedules(schedules) {
  const tbody = document.getElementById('schedules-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!Array.isArray(schedules) || schedules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-secondary);">Aucun planning trouvé.</td></tr>';
    return;
  }

  schedules.forEach((s) => {
    const tr = document.createElement('tr');
    const start = s.shift_start ? new Date(s.shift_start).toLocaleString('fr-FR') : '—';
    const end = s.shift_end ? new Date(s.shift_end).toLocaleString('fr-FR') : '—';
    tr.innerHTML = `
      <td>${s.id}</td>
      <td>${s.employee_first_name || ''} ${s.employee_last_name || ''}</td>
      <td>${start}</td>
      <td>${end}</td>
      <td>${s.notes || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Fetch & render leaves (requires auth, self-filtered for EMPLOYEE role)
async function fetchLeaves() {
  if (!authToken) return;
  try {
    const leaves = await safeFetchJson(`${API_BASE}/employees/leaves`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderLeaves(leaves);
  } catch (err) {
    console.warn('Erreur chargement congés:', err);
  }
}

function renderLeaves(leaves) {
  const tbody = document.getElementById('leaves-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!Array.isArray(leaves) || leaves.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">Aucun congé trouvé.</td></tr>';
    return;
  }

  const isAdmin = currentUser && currentUser.role === 'ADMIN';

  leaves.forEach((l) => {
    const tr = document.createElement('tr');
    let statusClass = 'stock-badge ok';
    if (l.status === 'PENDING') statusClass = 'stock-badge expiring';
    else if (l.status === 'REJECTED') statusClass = 'stock-badge warning';

    let actions = '—';
    if (isAdmin && l.status === 'PENDING') {
      actions = `
        <button class="btn btn-accent btn-sm" onclick="updateLeaveStatus(${l.id}, 'APPROVED')">✔ Approuver</button>
        <button class="btn btn-danger btn-sm" onclick="updateLeaveStatus(${l.id}, 'REJECTED')">✖ Rejeter</button>
      `;
    }

    tr.innerHTML = `
      <td>${l.id}</td>
      <td>${l.employee_first_name || ''} ${l.employee_last_name || ''}</td>
      <td>${l.start_date || '—'}</td>
      <td>${l.end_date || '—'}</td>
      <td>${l.reason || '—'}</td>
      <td><span class="${statusClass}">${l.status || 'PENDING'}</span></td>
      <td>${actions}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ADMIN-only: approve or reject a leave request
async function updateLeaveStatus(leaveId, status) {
  if (!authToken) return showToast('Veuillez vous connecter.', true);
  try {
    await safeFetchJson(`${API_BASE}/employees/leaves/${leaveId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status })
    });
    showToast(`Congé #${leaveId} ${status === 'APPROVED' ? 'approuvé' : 'rejeté'}`);
    fetchLeaves();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderSuppliers() {
  const tbody = document.getElementById('suppliers-tbody');
  tbody.innerHTML = '';

  if (!Array.isArray(suppliersList) || suppliersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color: var(--text-secondary);">Aucun fournisseur trouvé.</td></tr>';
    return;
  }

  const canEditSupplier = hasAnyRole('ADMIN', 'STOCK');
  const canDeleteSupplier = hasAnyRole('ADMIN');

  suppliersList.forEach((supplier) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${supplier.id}</td>
      <td>${supplier.name}</td>
      <td>${supplier.contact_person || '—'}</td>
      <td>${supplier.email || '—'}</td>
      <td>${supplier.phone || '—'}</td>
      <td>${supplier.address || '—'}</td>
      <td>${supplier.quality || '—'}</td>
      <td>${supplier.rating || '—'}</td>
      <td>${canEditSupplier ? `<button class="btn btn-secondary btn-sm" onclick="openSupplierModal(${supplier.id})">✏️</button>` : ''}${canDeleteSupplier ? `<button class="btn btn-danger btn-sm" onclick="deleteSupplier(${supplier.id})">🗑️</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function populateEmployeeSelects() {
  const scheduleEmployeeSelect = document.getElementById('schedule-employee-select');
  const leaveEmployeeSelect = document.getElementById('leave-employee-select');

  [scheduleEmployeeSelect, leaveEmployeeSelect].forEach((select) => {
    if (select) {
      select.innerHTML = '<option value="">Sélectionner un employé</option>' +
        employeesList.map((emp) => `<option value="${emp.id}">${emp.first_name} ${emp.last_name}</option>`).join('');
    }
  });
}

function openEmployeeModal(employeeId = null) {
  if (!requireRoleFor('ADMIN')) return;
  const modal = document.getElementById('employee-modal');
  const title = document.getElementById('employee-modal-title');
  document.getElementById('employee-form').reset();
  document.getElementById('employee-id').value = '';

  populateEmployeeSelects();

  const emailInput = document.getElementById('employee-email');
  const roleSelect = document.getElementById('employee-role');
  const passwordInput = document.getElementById('employee-password');

  if (employeeId) {
    const employee = employeesList.find((item) => item.id === employeeId);
    if (!employee) return;
    title.textContent = 'Modifier Employé';
    document.getElementById('employee-id').value = employee.id;
    document.getElementById('employee-first-name').value = employee.first_name || '';
    document.getElementById('employee-last-name').value = employee.last_name || '';
    emailInput.readOnly = true;
    roleSelect.disabled = true;
    passwordInput.required = false;
    passwordInput.value = '';
    document.getElementById('employee-email').value = employee.user_email || '';
    document.getElementById('employee-role').value = employee.user_role || 'EMPLOYEE';
    document.getElementById('employee-job-title').value = employee.job_title || '';
    document.getElementById('employee-phone').value = employee.phone || '';
    document.getElementById('employee-hire-date').value = employee.hire_date || '';
    document.getElementById('employee-address').value = employee.address || '';
  } else {
    title.textContent = 'Nouvel Employé';
    emailInput.readOnly = false;
    roleSelect.disabled = false;
    passwordInput.required = true;
    passwordInput.value = '';
  }

  modal.classList.remove('hidden');
}

function openScheduleModal() {
  if (!requireRoleFor('ADMIN')) return;
  if (!employeesList || employeesList.length === 0) {
    showToast('Chargez d’abord les employés.', true);
    return;
  }
  populateEmployeeSelects();
  document.getElementById('schedule-form').reset();
  document.getElementById('schedule-modal').classList.remove('hidden');
}

function openLeaveModal() {
  if (!requireRoleFor('ADMIN', 'EMPLOYEE')) return;
  if (!employeesList || employeesList.length === 0) {
    showToast('Chargez d’abord les employés.', true);
    return;
  }
  populateEmployeeSelects();
  document.getElementById('leave-form').reset();
  // EMPLOYEE: the employee selector is hidden for this role, so pre-select their
  // own profile. This both satisfies the field's `required` constraint (otherwise
  // native HTML5 validation silently blocks form submission) and guarantees the
  // request is created in the employee's own name.
  if (hasAnyRole('EMPLOYEE')) {
    const own = employeesList.find((emp) => emp.user_id === currentUser.id) || employeesList[0];
    const sel = document.getElementById('leave-employee-select');
    if (sel && own) sel.value = String(own.id);
  }
  document.getElementById('leave-modal').classList.remove('hidden');
}

function openSupplierModal(supplierId = null) {
  if (!requireRoleFor('ADMIN', 'STOCK')) return;
  const modal = document.getElementById('supplier-modal');
  const title = document.getElementById('supplier-modal-title');
  document.getElementById('supplier-form').reset();
  document.getElementById('supplier-id').value = '';

  if (supplierId) {
    const supplier = suppliersList.find((item) => item.id === supplierId);
    if (!supplier) return;
    title.textContent = 'Modifier Fournisseur';
    document.getElementById('supplier-id').value = supplier.id;
    document.getElementById('supplier-name').value = supplier.name || '';
    document.getElementById('supplier-contact').value = supplier.contact_person || '';
    document.getElementById('supplier-email').value = supplier.email || '';
    document.getElementById('supplier-phone').value = supplier.phone || '';
    document.getElementById('supplier-address').value = supplier.address || '';
    document.getElementById('supplier-lead-time').value = supplier.lead_time || '';
    document.getElementById('supplier-quality').value = supplier.quality || '';
    document.getElementById('supplier-rating').value = supplier.rating || '';
  } else {
    title.textContent = 'Nouveau Fournisseur';
  }

  modal.classList.remove('hidden');
}

async function handleSaveEmployee(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const id = document.getElementById('employee-id').value;
  const payload = {
    first_name: document.getElementById('employee-first-name').value,
    last_name: document.getElementById('employee-last-name').value,
    email: document.getElementById('employee-email').value,
    role: document.getElementById('employee-role').value,
    job_title: document.getElementById('employee-job-title').value,
    phone: document.getElementById('employee-phone').value,
    hire_date: document.getElementById('employee-hire-date').value || null,
    address: document.getElementById('employee-address').value || null
  };
  const password = document.getElementById('employee-password').value;
  if (password) {
    payload.password = password;
  }

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/employees/${id}` : `${API_BASE}/employees`;
    await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(id ? 'Employé mis à jour' : 'Employé créé');
    closeModal('employee-modal');
    await fetchEmployees();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleSaveSchedule(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const payload = {
    employee_id: parseInt(document.getElementById('schedule-employee-select').value, 10),
    shift_start: document.getElementById('schedule-start').value,
    shift_end: document.getElementById('schedule-end').value,
    notes: document.getElementById('schedule-notes').value || null
  };

  try {
    await safeFetchJson(`${API_BASE}/employees/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast('Planning enregistré');
    closeModal('schedule-modal');
    fetchSchedules();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleSaveLeave(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'EMPLOYEE')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  let employeeId = parseInt(document.getElementById('leave-employee-select').value, 10);
  let status = document.getElementById('leave-status').value;

  // EMPLOYEE always submits a leave request in their own name, forced to PENDING.
  if (hasAnyRole('EMPLOYEE')) {
    const own = employeesList.find((emp) => emp.user_id === currentUser.id) || employeesList[0];
    if (own) employeeId = own.id;
    status = 'PENDING';
  }

  const payload = {
    employee_id: employeeId,
    start_date: document.getElementById('leave-start').value,
    end_date: document.getElementById('leave-end').value,
    reason: document.getElementById('leave-reason').value || null,
    status
  };

  try {
    await safeFetchJson(`${API_BASE}/employees/leaves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast('Congé enregistré');
    closeModal('leave-modal');
    fetchLeaves();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleSaveSupplier(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'STOCK')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const id = document.getElementById('supplier-id').value;
  const payload = {
    name: document.getElementById('supplier-name').value,
    contact_person: document.getElementById('supplier-contact').value || null,
    email: document.getElementById('supplier-email').value || null,
    phone: document.getElementById('supplier-phone').value || null,
    address: document.getElementById('supplier-address').value || null,
    lead_time: document.getElementById('supplier-lead-time').value ? parseInt(document.getElementById('supplier-lead-time').value, 10) : null,
    quality: document.getElementById('supplier-quality').value || null,
    rating: document.getElementById('supplier-rating').value ? parseFloat(document.getElementById('supplier-rating').value) : null
  };

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/suppliers/${id}` : `${API_BASE}/suppliers`;
    await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(id ? 'Fournisseur mis à jour' : 'Fournisseur créé');
    closeModal('supplier-modal');
    fetchSuppliers();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteEmployee(id) {
  if (!confirm('Voulez-vous supprimer cet employé ?')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/employees/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    showToast('Employé supprimé');
    fetchEmployees();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteSupplier(id) {
  if (!confirm('Voulez-vous supprimer ce fournisseur ?')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/suppliers/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    showToast('Fournisseur supprimé');
    fetchSuppliers();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Fetch Categories
async function fetchCategories() {
  try {
    categoriesList = await safeFetchJson(`${API_BASE}/categories`);

    const prodCategorySelect = document.getElementById('product-category-select');
    const filterCategorySelect = document.getElementById('filter-product-category');
    const catTbody = document.getElementById('categories-tbody');

    prodCategorySelect.innerHTML = '<option value="">Aucune catégorie</option>';
    filterCategorySelect.innerHTML = '<option value="">Toutes les catégories</option>';
    if (catTbody) catTbody.innerHTML = '';

    const canEditCategory = hasAnyRole('ADMIN', 'PRODUCTION');
    const canDeleteCategory = hasAnyRole('ADMIN');

    categoriesList.forEach((cat) => {
      const opt1 = document.createElement('option');
      opt1.value = cat.id;
      opt1.textContent = cat.name;
      prodCategorySelect.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = cat.id;
      opt2.textContent = cat.name;
      filterCategorySelect.appendChild(opt2);

      if (catTbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${cat.id}</td>
          <td><strong>${cat.name}</strong></td>
          <td>${cat.description || ''}</td>
          <td>${canEditCategory ? `<button class="btn btn-secondary btn-sm" onclick="openCategoryModal(${cat.id})">✏️ Éditer</button>` : ''}${canDeleteCategory ? `<button class="btn btn-danger btn-sm" onclick="deleteCategory(${cat.id})">🗑️ Supprimer</button>` : ''}</td>
        `;
        catTbody.appendChild(tr);
      }
    });
  } catch (err) {
    showToast('Erreur chargement catégories', true);
  }
}

function openCategoryModal(categoryId = null) {
  if (!requireRoleFor('ADMIN', 'PRODUCTION')) return;
  const modal = document.getElementById('category-modal');
  const title = document.getElementById('category-modal-title');

  if (categoryId) {
    const cat = categoriesList.find((c) => c.id === categoryId);
    if (!cat) return;
    title.textContent = 'Modifier Catégorie';
    document.getElementById('category-id').value = cat.id;
    document.getElementById('category-name').value = cat.name;
    document.getElementById('category-description').value = cat.description || '';
  } else {
    title.textContent = 'Nouvelle Catégorie';
    document.getElementById('category-form').reset();
    document.getElementById('category-id').value = '';
  }

  modal.classList.remove('hidden');
}

async function handleSaveCategory(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'PRODUCTION')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const id = document.getElementById('category-id').value;
  const payload = {
    name: document.getElementById('category-name').value,
    description: document.getElementById('category-description').value
  };

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/categories/${id}` : `${API_BASE}/categories`;

    await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(id ? 'Catégorie mise à jour' : 'Catégorie créée');
    closeModal('category-modal');
    fetchCategories();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteCategory(id) {
  if (!confirm('Voulez-vous supprimer cette catégorie ?')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/categories/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    showToast('Catégorie supprimée');
    fetchCategories();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Fetch Products
async function fetchProducts() {
  try {
    productsList = await safeFetchJson(`${API_BASE}/products`);
    renderProducts();
    populateProductionSelect();
    populateSalesProductFilter();
    populateForecastProductSelect();
    loadForecast();
  } catch (err) {
    showToast('Erreur chargement produits', true);
  }
}

function renderProducts() {
  const search = document.getElementById('search-products').value.toLowerCase();
  const catFilter = document.getElementById('filter-product-category').value;

  const grid = document.getElementById('products-grid');
  grid.innerHTML = '';

  const filtered = productsList.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search) || (p.description && p.description.toLowerCase().includes(search));
    const matchesCat = !catFilter || p.category_id == catFilter;
    return matchesSearch && matchesCat;
  });

  const canEditProduct = hasAnyRole('ADMIN', 'PRODUCTION');
  const canDeleteProduct = hasAnyRole('ADMIN');

  filtered.forEach((product) => {
    const recipeStr = product.ingredients && product.ingredients.length > 0
      ? product.ingredients.map((i) => `• ${i.ingredient_name}: ${i.quantity_required} ${i.unit}`).join('<br>')
      : '<i>Aucune recette définie</i>';

    const card = document.createElement('div');
    card.className = 'card product-card';
    card.innerHTML = `
      <div>
        <div class="product-title">
          <h3>${product.name}</h3>
          <span class="price-tag">${parseFloat(product.price).toFixed(2)} €</span>
        </div>
        <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px;">${product.description || ''}</p>
        <div style="margin-top: 10px;">
          <span class="stock-badge ${product.stock_quantity > 0 ? 'ok' : 'warning'}">
            Stock Fini: ${product.stock_quantity} unités
          </span>
        </div>
        <div class="recipe-list" style="margin-top: 12px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
          <strong>Recette / Unité:</strong><br>
          ${recipeStr}
        </div>
      </div>
      <div class="card-actions">
        ${canEditProduct ? `<button class="btn btn-secondary btn-sm" onclick="openRecipeModal(${product.id})">📖 Recette</button>
        <button class="btn btn-secondary btn-sm" onclick="openProductModal(${product.id})">✏️ Éditer</button>` : ''}
        ${canDeleteProduct ? `<button class="btn btn-danger btn-sm" onclick="deleteProduct(${product.id})">🗑️</button>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });
}

function populateProductionSelect() {
  const select = document.getElementById('prod-product-select');
  select.innerHTML = '';
  productsList.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (Stock actuel: ${p.stock_quantity})`;
    select.appendChild(opt);
  });
  updateRecipePreview();
}

function updateRecipePreview() {
  const productId = document.getElementById('prod-product-select').value;
  const previewBox = document.getElementById('recipe-preview-box');
  const qty = parseInt(document.getElementById('prod-quantity').value, 10) || 1;

  if (!productId) {
    previewBox.innerHTML = '<p class="text-muted">Aucun produit sélectionné.</p>';
    return;
  }

  const product = productsList.find((p) => p.id == productId);
  if (!product || !product.ingredients || product.ingredients.length === 0) {
    previewBox.innerHTML = '<p class="text-muted">Ce produit n\'a pas de recette définie.</p>';
    return;
  }

  let html = `<h4>Besoins pour ${qty}x ${product.name} :</h4><ul style="margin-left: 20px; margin-top: 8px;">`;
  product.ingredients.forEach((ing) => {
    const requiredTotal = (parseFloat(ing.quantity_required) * qty).toFixed(3);
    const avail = parseFloat(ing.current_stock).toFixed(3);
    const isEnough = parseFloat(ing.current_stock) >= parseFloat(requiredTotal);
    html += `
      <li style="color: ${isEnough ? 'var(--text-primary)' : 'var(--accent-red)'}">
        ${ing.ingredient_name}: <strong>${requiredTotal} ${ing.unit}</strong> 
        (Disponible: ${avail} ${ing.unit}) ${isEnough ? '✅' : '❌ Stock insuffisant!'}
      </li>
    `;
  });
  html += '</ul>';
  previewBox.innerHTML = html;
}

// Fetch Ingredients
async function fetchIngredients() {
  try {
    const statusFilter = document.getElementById('filter-stock-status').value;
    let url = `${API_BASE}/ingredients`;
    if (statusFilter) url += `?status=${statusFilter}`;

    ingredientsList = await safeFetchJson(url);
    renderIngredients();
    fetchAlerts();
  } catch (err) {
    showToast('Erreur chargement ingrédients', true);
  }
}

function renderIngredients() {
  const search = document.getElementById('search-ingredients').value.toLowerCase();
  const tbody = document.getElementById('ingredients-tbody');
  tbody.innerHTML = '';

  const filtered = ingredientsList.filter((i) => i.name.toLowerCase().includes(search));

  const canEditIngredient = hasAnyRole('ADMIN', 'STOCK');
  const canDeleteIngredient = hasAnyRole('ADMIN');

  filtered.forEach((ing) => {
    let badgeClass = 'ok';
    let badgeText = '✅ Normal';

    if (ing.is_low_stock) {
      badgeClass = 'warning';
      badgeText = '⚠️ Stock Faible';
    } else if (ing.is_expiring_soon) {
      badgeClass = 'expiring';
      badgeText = '⏳ Péremption Proche';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ing.id}</td>
      <td><strong>${ing.name}</strong></td>
      <td><strong>${parseFloat(ing.current_stock).toFixed(2)}</strong> ${ing.unit}</td>
      <td>${parseFloat(ing.minimum_stock).toFixed(2)} ${ing.unit}</td>
      <td>${parseFloat(ing.cost_per_unit || 0).toFixed(2)} €</td>
      <td>${ing.expiration_date || 'Non spécifiée'}</td>
      <td>${ing.supplier_name || 'N/A'}</td>
      <td><span class="stock-badge ${badgeClass}">${badgeText}</span></td>
      <td>${canEditIngredient ? `<button class="btn btn-secondary btn-sm" onclick="openIngredientModal(${ing.id})">✏️</button>` : ''}${canDeleteIngredient ? `<button class="btn btn-danger btn-sm" onclick="deleteIngredient(${ing.id})">🗑️</button>` : ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Modals Product
function openProductModal(productId = null) {
  if (!requireRoleFor('ADMIN', 'PRODUCTION')) return;
  const modal = document.getElementById('product-modal');
  const title = document.getElementById('product-modal-title');

  if (productId) {
    const p = productsList.find((item) => item.id === productId);
    if (!p) return;
    title.textContent = 'Modifier Produit';
    document.getElementById('product-id').value = p.id;
    document.getElementById('product-name').value = p.name;
    document.getElementById('product-description').value = p.description || '';
    document.getElementById('product-price').value = p.price;
    document.getElementById('product-category-select').value = p.category_id || '';
  } else {
    title.textContent = 'Nouveau Produit';
    document.getElementById('product-form').reset();
    document.getElementById('product-id').value = '';
  }

  modal.classList.remove('hidden');
}

async function handleSaveProduct(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'PRODUCTION')) return;
  if (!authToken) {
    showToast('Veuillez vous connecter.', true);
    return;
  }

  const id = document.getElementById('product-id').value;
  const payload = {
    name: document.getElementById('product-name').value,
    description: document.getElementById('product-description').value,
    price: parseFloat(document.getElementById('product-price').value),
    category_id: document.getElementById('product-category-select').value || null
  };

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/products/${id}` : `${API_BASE}/products`;

    await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(id ? 'Produit mis à jour' : 'Produit créé');
    closeModal('product-modal');
    fetchProducts();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteProduct(id) {
  if (!confirm('Voulez-vous supprimer ce produit ?')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/products/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    showToast('Produit supprimé');
    fetchProducts();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Recipe Modal
function openRecipeModal(productId) {
  const p = productsList.find((item) => item.id === productId);
  if (!p) return;

  document.getElementById('recipe-product-title').textContent = p.name;
  document.getElementById('recipe-product-id').value = p.id;

  const container = document.getElementById('recipe-items-container');
  container.innerHTML = '';

  if (p.ingredients && p.ingredients.length > 0) {
    p.ingredients.forEach((ing) => addRecipeRow(ing.ingredient_id, ing.quantity_required));
  } else {
    addRecipeRow();
  }

  document.getElementById('recipe-modal').classList.remove('hidden');
}

function addRecipeRow(ingredientId = '', quantityRequired = '') {
  const container = document.getElementById('recipe-items-container');
  const row = document.createElement('div');
  row.className = 'recipe-row';

  let optionsHtml = '<option value="">Sélectionner Ingrédient</option>';
  ingredientsList.forEach((ing) => {
    const sel = ing.id == ingredientId ? 'selected' : '';
    optionsHtml += `<option value="${ing.id}" ${sel}>${ing.name} (${ing.unit})</option>`;
  });

  row.innerHTML = `
    <select class="form-control recipe-ing-select" style="flex: 2;" required>${optionsHtml}</select>
    <input type="number" step="0.001" class="form-control recipe-qty-input" placeholder="Qté requise" value="${quantityRequired}" style="flex: 1;" required>
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">❌</button>
  `;
  container.appendChild(row);
}

async function handleSaveRecipe(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'PRODUCTION')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const productId = document.getElementById('recipe-product-id').value;
  const rows = document.querySelectorAll('.recipe-row');

  const items = [];
  rows.forEach((row) => {
    const ingId = row.querySelector('.recipe-ing-select').value;
    const qty = parseFloat(row.querySelector('.recipe-qty-input').value);
    if (ingId && !isNaN(qty)) {
      items.push({ ingredient_id: parseInt(ingId, 10), quantity_required: qty });
    }
  });

  try {
    await safeFetchJson(`${API_BASE}/products/${productId}/recipe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ items })
    });

    showToast('Recette enregistrée avec succès!');
    closeModal('recipe-modal');
    fetchProducts();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Ingredient Modal
function openIngredientModal(ingredientId = null) {
  if (!requireRoleFor('ADMIN', 'STOCK')) return;
  const modal = document.getElementById('ingredient-modal');
  const title = document.getElementById('ingredient-modal-title');

  if (ingredientId) {
    const ing = ingredientsList.find((i) => i.id === ingredientId);
    if (!ing) return;
    title.textContent = 'Modifier Ingrédient';
    document.getElementById('ingredient-id').value = ing.id;
    document.getElementById('ingredient-name').value = ing.name;
    document.getElementById('ingredient-unit').value = ing.unit;
    document.getElementById('ingredient-min-stock').value = ing.minimum_stock;
    document.getElementById('ingredient-cost').value = ing.cost_per_unit || 0;
    document.getElementById('ingredient-expiration').value = ing.expiration_date || '';
  } else {
    title.textContent = 'Nouvel Ingrédient';
    document.getElementById('ingredient-form').reset();
    document.getElementById('ingredient-id').value = '';
  }

  modal.classList.remove('hidden');
}

async function handleSaveIngredient(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'STOCK')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const id = document.getElementById('ingredient-id').value;
  const payload = {
    name: document.getElementById('ingredient-name').value,
    unit: document.getElementById('ingredient-unit').value,
    minimum_stock: parseFloat(document.getElementById('ingredient-min-stock').value),
    cost_per_unit: parseFloat(document.getElementById('ingredient-cost').value),
    expiration_date: document.getElementById('ingredient-expiration').value || null
  };

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/ingredients/${id}` : `${API_BASE}/ingredients`;

    await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(id ? 'Ingrédient mis à jour' : 'Ingrédient créé');
    closeModal('ingredient-modal');
    fetchIngredients();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteIngredient(id) {
  if (!confirm('Voulez-vous supprimer cet ingrédient ?')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/ingredients/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });
    showToast('Ingrédient supprimé');
    fetchIngredients();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Stock Movement Modal
function openMovementModal() {
  if (!requireRoleFor('ADMIN', 'STOCK')) return;
  const select = document.getElementById('movement-ingredient-select');
  select.innerHTML = '';
  ingredientsList.forEach((ing) => {
    const opt = document.createElement('option');
    opt.value = ing.id;
    opt.textContent = `${ing.name} (Stock actuel: ${ing.current_stock} ${ing.unit})`;
    select.appendChild(opt);
  });
  document.getElementById('movement-modal').classList.remove('hidden');
}

async function handleSaveMovement(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'STOCK')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const ingredientId = document.getElementById('movement-ingredient-select').value;
  const payload = {
    movement_type: document.getElementById('movement-type-select').value,
    quantity: parseFloat(document.getElementById('movement-quantity').value),
    reason: document.getElementById('movement-reason').value,
    expiration_date: document.getElementById('movement-expiration').value || null
  };

  try {
    await safeFetchJson(`${API_BASE}/ingredients/${ingredientId}/movement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast('Mouvement de stock enregistré avec succès!');
    closeModal('movement-modal');
    fetchIngredients();
  } catch (err) {
    showToast(err.message, true);
  }
}

// Production Form Submission
async function handleProduction(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'PRODUCTION')) return;
  if (!authToken) {
    showToast('Veuillez vous connecter.', true);
    document.getElementById('login-modal').classList.remove('hidden');
    return;
  }

  const productId = document.getElementById('prod-product-select').value;
  const quantity = parseInt(document.getElementById('prod-quantity').value, 10);

  try {
    const data = await safeFetchJson(`${API_BASE}/products/${productId}/produce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ quantity })
    });

    showToast(data.message);
    fetchProducts();
    fetchIngredients();

    const resultBox = document.getElementById('production-result');
    resultBox.classList.remove('hidden');
    resultBox.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--accent-green); padding: 18px; border-radius: 12px;">
        <h4 style="color: var(--accent-green); margin-bottom: 8px;">✅ Production Effectuée avec Succès!</h4>
        <p>Produit: <strong>${data.result.product.name}</strong> (+${data.result.produced_quantity} unités)</p>
        <p style="margin-top: 8px;"><strong>Mises à jour du stock d'ingrédients :</strong></p>
        <ul style="margin-left: 20px; font-size: 0.9rem;">
          ${data.result.updated_ingredients.map((i) => `<li>${i.name}: Nouveau stock = ${parseFloat(i.current_stock).toFixed(2)} ${i.unit}</li>`).join('')}
        </ul>
        ${data.result.alerts.length > 0 ? `<p style="color: var(--accent-red); margin-top: 10px; font-weight: bold;">⚠️ Alertes Déclenchées : ${data.result.alerts.map((a) => a.name).join(', ')} (Stock ≤ Seuil min)</p>` : ''}
      </div>
    `;
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Sprint 4: Purchase Orders ----------

async function fetchPurchaseOrders() {
  if (!authToken) return;
  try {
    const status = document.getElementById('filter-po-status').value;
    const supplierId = document.getElementById('filter-po-supplier').value;

    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (supplierId) params.append('supplier_id', supplierId);

    const query = params.toString() ? `?${params.toString()}` : '';
    purchaseOrdersList = await safeFetchJson(`${API_BASE}/purchase-orders${query}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderPurchaseOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderPurchaseOrders() {
  const tbody = document.getElementById('purchase-orders-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!Array.isArray(purchaseOrdersList) || purchaseOrdersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-secondary);">Aucune commande fournisseur trouvée.</td></tr>';
    return;
  }

  const role = currentUser ? currentUser.role : '';
  const isStockOrAdmin = ['ADMIN', 'STOCK'].includes(role);
  const isAdmin = role === 'ADMIN';

  purchaseOrdersList.forEach((po) => {
    let badgeClass = 'status-draft';
    if (po.status === 'ORDERED') badgeClass = 'status-ordered';
    else if (po.status === 'RECEIVED') badgeClass = 'status-received';
    else if (po.status === 'CANCELLED') badgeClass = 'status-cancelled';

    const createdAt = po.created_at ? new Date(po.created_at).toLocaleString('fr-FR') : '—';
    const receivedAt = po.received_at ? new Date(po.received_at).toLocaleString('fr-FR') : '—';

    let actionBtns = `<button class="btn btn-secondary btn-sm" onclick="openPurchaseOrderDetailModal(${po.id})">🔍 Détails</button> `;

    if (po.status === 'DRAFT' && isStockOrAdmin) {
      actionBtns += `<button class="btn btn-secondary btn-sm" onclick="openPurchaseOrderModal(${po.id})">✏️ Modifier</button> `;
      actionBtns += `<button class="btn btn-accent btn-sm" onclick="updatePurchaseOrderStatus(${po.id}, 'ORDERED')">📦 Valider (ORDERED)</button> `;
      if (isAdmin) {
        actionBtns += `<button class="btn btn-danger btn-sm" onclick="deletePurchaseOrder(${po.id})">🗑️ Supprimer</button> `;
      }
    } else if (po.status === 'ORDERED' && isStockOrAdmin) {
      actionBtns += `<button class="btn btn-accent btn-sm" onclick="updatePurchaseOrderStatus(${po.id}, 'RECEIVED')">✅ Réceptionner (RECEIVED)</button> `;
      actionBtns += `<button class="btn btn-danger btn-sm" onclick="updatePurchaseOrderStatus(${po.id}, 'CANCELLED')">✖ Annuler</button> `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${po.id}</td>
      <td><strong>${po.supplier_name || 'Fournisseur #' + po.supplier_id}</strong></td>
      <td><strong>${parseFloat(po.total_cost || 0).toFixed(2)} €</strong></td>
      <td><span class="stock-badge ${badgeClass}">${po.status}</span></td>
      <td>${createdAt}</td>
      <td>${receivedAt}</td>
      <td>${actionBtns}</td>
    `;
    tbody.appendChild(tr);
  });
}

function openPurchaseOrderModal(poId = null) {
  if (!authToken) return showToast('Veuillez vous connecter.', true);
  if (!requireRoleFor('ADMIN', 'STOCK')) return;

  const modal = document.getElementById('po-modal');
  const title = document.getElementById('po-modal-title');
  const supplierSelect = document.getElementById('po-supplier-select');
  const container = document.getElementById('po-items-container');

  supplierSelect.innerHTML = '<option value="">Sélectionnez un fournisseur</option>';
  suppliersList.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    selectSupplierChild(opt, supplierSelect);
  });

  container.innerHTML = '';

  if (poId) {
    const po = purchaseOrdersList.find((p) => p.id === poId);
    if (!po) return;
    title.textContent = `Modifier Commande Fournisseur #${po.id}`;
    document.getElementById('po-id').value = po.id;
    supplierSelect.value = po.supplier_id;

    safeFetchJson(`${API_BASE}/purchase-orders/${poId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    }).then((fullPo) => {
      if (fullPo.items && fullPo.items.length > 0) {
        fullPo.items.forEach((item) => addPoItemRow(item.ingredient_id, item.quantity_ordered, item.unit_cost));
      } else {
        addPoItemRow();
      }
      updatePoSummary();
    }).catch(() => addPoItemRow());
  } else {
    title.textContent = 'Nouvelle Commande Fournisseur';
    document.getElementById('po-form').reset();
    document.getElementById('po-id').value = '';
    addPoItemRow();
    updatePoSummary();
  }

  modal.classList.remove('hidden');
}

function selectSupplierChild(opt, select) {
  select.appendChild(opt);
}

function addPoItemRow(ingredientId = '', quantityOrdered = '', unitCost = '') {
  const container = document.getElementById('po-items-container');
  const row = document.createElement('div');
  row.className = 'recipe-row po-item-row';

  let optionsHtml = '<option value="">Sélectionner un ingrédient</option>';
  ingredientsList.forEach((ing) => {
    const sel = ing.id == ingredientId ? 'selected' : '';
    const cost = ing.cost_per_unit || 0;
    optionsHtml += `<option value="${ing.id}" data-cost="${cost}" ${sel}>${ing.name} (${ing.unit}) — Ref cost: ${parseFloat(cost).toFixed(2)} €</option>`;
  });

  row.innerHTML = `
    <select class="form-control po-ing-select" style="flex: 2;" required>${optionsHtml}</select>
    <input type="number" step="0.001" min="0.001" class="form-control po-qty-input" placeholder="Qté" value="${quantityOrdered}" style="flex: 1;" required>
    <input type="number" step="0.01" min="0" class="form-control po-cost-input" placeholder="Coût Unitaire (€)" value="${unitCost}" style="flex: 1;" required>
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove(); updatePoSummary();">❌</button>
  `;

  const ingSelect = row.querySelector('.po-ing-select');
  const costInput = row.querySelector('.po-cost-input');
  const qtyInput = row.querySelector('.po-qty-input');

  ingSelect.addEventListener('change', () => {
    const selectedOpt = ingSelect.options[ingSelect.selectedIndex];
    if (selectedOpt && selectedOpt.dataset.cost && !costInput.value) {
      costInput.value = selectedOpt.dataset.cost;
    }
    updatePoSummary();
  });
  costInput.addEventListener('input', updatePoSummary);
  qtyInput.addEventListener('input', updatePoSummary);

  container.appendChild(row);
}

function updatePoSummary() {
  const rows = document.querySelectorAll('.po-item-row');
  let total = 0;
  rows.forEach((row) => {
    const qty = parseFloat(row.querySelector('.po-qty-input').value) || 0;
    const cost = parseFloat(row.querySelector('.po-cost-input').value) || 0;
    total += qty * cost;
  });
  const summaryEl = document.getElementById('po-total-cost-display');
  if (summaryEl) summaryEl.textContent = `${total.toFixed(2)} €`;
}

async function handleSavePurchaseOrder(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'STOCK')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const poId = document.getElementById('po-id').value;
  const supplierId = parseInt(document.getElementById('po-supplier-select').value, 10);
  const rows = document.querySelectorAll('.po-item-row');

  const items = [];
  rows.forEach((row) => {
    const ingId = parseInt(row.querySelector('.po-ing-select').value, 10);
    const qty = parseFloat(row.querySelector('.po-qty-input').value);
    const cost = parseFloat(row.querySelector('.po-cost-input').value);
    if (ingId && !isNaN(qty) && !isNaN(cost)) {
      items.push({ ingredient_id: ingId, quantity_ordered: qty, unit_cost: cost });
    }
  });

  if (items.length === 0) {
    return showToast('Ajoutez au moins une ligne d\'ingrédient valide.', true);
  }

  const payload = { supplier_id: supplierId, items };

  try {
    const method = poId ? 'PUT' : 'POST';
    const url = poId ? `${API_BASE}/purchase-orders/${poId}` : `${API_BASE}/purchase-orders`;

    const po = await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(poId ? `Commande fournisseur #${po.id} modifiée.` : `Commande fournisseur #${po.id} créée (DRAFT).`);
    closeModal('po-modal');
    fetchPurchaseOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openPurchaseOrderDetailModal(poId) {
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    const po = await safeFetchJson(`${API_BASE}/purchase-orders/${poId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    document.getElementById('po-detail-id').textContent = po.id;
    const body = document.getElementById('po-detail-body');
    const actions = document.getElementById('po-detail-actions');

    let badgeClass = 'status-draft';
    if (po.status === 'ORDERED') badgeClass = 'status-ordered';
    else if (po.status === 'RECEIVED') badgeClass = 'status-received';
    else if (po.status === 'CANCELLED') badgeClass = 'status-cancelled';

    let itemsHtml = `
      <div class="card margin-top-10">
        <p>Fournisseur: <strong>${po.supplier_name || 'Fournisseur #' + po.supplier_id}</strong></p>
        <p>Statut: <span class="stock-badge ${badgeClass}">${po.status}</span></p>
        <p>Total Coût: <strong>${parseFloat(po.total_cost || 0).toFixed(2)} €</strong></p>
        <p>Créé le: ${po.created_at ? new Date(po.created_at).toLocaleString('fr-FR') : '—'}</p>
        <p>Réceptionné le: ${po.received_at ? new Date(po.received_at).toLocaleString('fr-FR') : '—'}</p>
      </div>

      <h3 class="margin-top-20">Lignes d'Ingrédients</h3>
      <table class="data-table margin-top-10">
        <thead>
          <tr>
            <th>Ingrédient</th>
            <th>Quantité Commandée</th>
            <th>Quantité Reçue</th>
            <th>Coût Unitaire</th>
            <th>Sous-total</th>
          </tr>
        </thead>
        <tbody>
          ${(po.items || []).map((it) => `
            <tr>
              <td><strong>${it.ingredient_name || 'Ingrédient #' + it.ingredient_id}</strong></td>
              <td>${parseFloat(it.quantity_ordered).toFixed(2)} ${it.unit || ''}</td>
              <td>${parseFloat(it.quantity_received || 0).toFixed(2)} ${it.unit || ''}</td>
              <td>${parseFloat(it.unit_cost).toFixed(2)} €</td>
              <td><strong>${(parseFloat(it.quantity_ordered) * parseFloat(it.unit_cost)).toFixed(2)} €</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    body.innerHTML = itemsHtml;

    const role = currentUser ? currentUser.role : '';
    const isStockOrAdmin = ['ADMIN', 'STOCK'].includes(role);

    let actionBtns = `<button type="button" class="btn btn-secondary" onclick="closeModal('po-detail-modal')">Fermer</button>`;
    if (po.status === 'DRAFT' && isStockOrAdmin) {
      actionBtns += ` <button type="button" class="btn btn-accent" onclick="closeModal('po-detail-modal'); updatePurchaseOrderStatus(${po.id}, 'ORDERED')">📦 Valider (ORDERED)</button>`;
    } else if (po.status === 'ORDERED' && isStockOrAdmin) {
      actionBtns += ` <button type="button" class="btn btn-accent" onclick="closeModal('po-detail-modal'); updatePurchaseOrderStatus(${po.id}, 'RECEIVED')">✅ Réceptionner Stock (RECEIVED)</button>`;
      actionBtns += ` <button type="button" class="btn btn-danger" onclick="closeModal('po-detail-modal'); updatePurchaseOrderStatus(${po.id}, 'CANCELLED')">✖ Annuler Commande</button>`;
    }

    actions.innerHTML = actionBtns;
    document.getElementById('po-detail-modal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function updatePurchaseOrderStatus(id, status) {
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/purchase-orders/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status })
    });

    if (status === 'RECEIVED') {
      showToast(`Commande #${id} réceptionnée! Le stock d'ingrédients a été augmenté.`, false);
      fetchIngredients();
    } else {
      showToast(`Statut de la commande #${id} changé en ${status}.`);
    }

    fetchPurchaseOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deletePurchaseOrder(id) {
  if (!confirm(`Supprimer la commande fournisseur #${id} ?`)) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/purchase-orders/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });

    showToast(`Commande fournisseur #${id} supprimée.`);
    fetchPurchaseOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------- Sprint 4: Customer Orders ----------

async function fetchCustomerOrders() {
  if (!authToken) return;
  try {
    const status = document.getElementById('filter-co-status').value;
    const deliveryDate = document.getElementById('filter-co-delivery-date').value;

    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (deliveryDate) params.append('delivery_date', deliveryDate);

    const query = params.toString() ? `?${params.toString()}` : '';
    customerOrdersList = await safeFetchJson(`${API_BASE}/customer-orders${query}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderCustomerOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderCustomerOrders() {
  const tbody = document.getElementById('customer-orders-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!Array.isArray(customerOrdersList) || customerOrdersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color: var(--text-secondary);">Aucune commande client trouvée.</td></tr>';
    return;
  }

  const role = currentUser ? currentUser.role : '';
  const isCashierOrAdmin = ['ADMIN', 'CASHIER'].includes(role);
  const isProdOrAdmin = ['ADMIN', 'PRODUCTION'].includes(role);
  const isAdmin = role === 'ADMIN';

  customerOrdersList.forEach((co) => {
    let badgeClass = 'status-pending';
    if (co.status === 'IN_PRODUCTION') badgeClass = 'status-in_production';
    else if (co.status === 'READY') badgeClass = 'status-ready';
    else if (co.status === 'DELIVERED') badgeClass = 'status-delivered';
    else if (co.status === 'CANCELLED') badgeClass = 'status-cancelled';

    let actionBtns = `<button class="btn btn-secondary btn-sm" onclick="openCustomerOrderDetailModal(${co.id})">🔍 Détails</button> `;

    if (co.status === 'PENDING') {
      if (isCashierOrAdmin) {
        actionBtns += `<button class="btn btn-secondary btn-sm" onclick="openCustomerOrderModal(${co.id})">✏️ Modifier</button> `;
      }
      if (isProdOrAdmin) {
        actionBtns += `<button class="btn btn-accent btn-sm" onclick="updateCustomerOrderStatus(${co.id}, 'IN_PRODUCTION')">👨‍🍳 Lancer Fabrication</button> `;
      }
      if (isAdmin) {
        actionBtns += `<button class="btn btn-danger btn-sm" onclick="deleteCustomerOrder(${co.id})">🗑️ Supprimer</button> `;
      }
    } else if (co.status === 'IN_PRODUCTION' && isProdOrAdmin) {
      actionBtns += `<button class="btn btn-accent btn-sm" onclick="updateCustomerOrderStatus(${co.id}, 'READY')">✨ Prête (READY)</button> `;
    } else if (co.status === 'READY' && isProdOrAdmin) {
      actionBtns += `<button class="btn btn-accent btn-sm" onclick="updateCustomerOrderStatus(${co.id}, 'DELIVERED')">🎁 Livrer (DELIVERED)</button> `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${co.id}</td>
      <td><strong>${co.customer_name}</strong></td>
      <td>${co.customer_phone || '—'}</td>
      <td><strong>${co.delivery_date}</strong></td>
      <td><strong>${parseFloat(co.total_price || 0).toFixed(2)} €</strong></td>
      <td>${co.special_instructions || '—'}</td>
      <td><span class="stock-badge ${badgeClass}">${co.status}</span></td>
      <td>${actionBtns}</td>
    `;
    tbody.appendChild(tr);
  });
}

function openCustomerOrderModal(coId = null) {
  if (!authToken) return showToast('Veuillez vous connecter.', true);
  if (!requireRoleFor('ADMIN', 'CASHIER')) return;

  const modal = document.getElementById('co-modal');
  const title = document.getElementById('co-modal-title');
  const container = document.getElementById('co-items-container');

  container.innerHTML = '';

  if (coId) {
    const co = customerOrdersList.find((c) => c.id === coId);
    if (!co) return;
    title.textContent = `Modifier Commande Client #${co.id}`;
    document.getElementById('co-id').value = co.id;
    document.getElementById('co-customer-name').value = co.customer_name;
    document.getElementById('co-customer-phone').value = co.customer_phone || '';
    document.getElementById('co-delivery-date').value = co.delivery_date;
    document.getElementById('co-special-instructions').value = co.special_instructions || '';

    safeFetchJson(`${API_BASE}/customer-orders/${coId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    }).then((fullCo) => {
      if (fullCo.items && fullCo.items.length > 0) {
        fullCo.items.forEach((item) => addCoItemRow(item.product_id, item.quantity));
      } else {
        addCoItemRow();
      }
      updateCoSummary();
    }).catch(() => addCoItemRow());
  } else {
    title.textContent = 'Nouvelle Commande Client';
    document.getElementById('co-form').reset();
    document.getElementById('co-id').value = '';
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 2);
    document.getElementById('co-delivery-date').value = defaultDate.toISOString().split('T')[0];

    addCoItemRow();
    updateCoSummary();
  }

  modal.classList.remove('hidden');
}

function addCoItemRow(productId = '', quantity = 1) {
  const container = document.getElementById('co-items-container');
  const row = document.createElement('div');
  row.className = 'recipe-row co-item-row';

  let optionsHtml = '<option value="">Sélectionner un produit</option>';
  productsList.forEach((prod) => {
    const sel = prod.id == productId ? 'selected' : '';
    const price = prod.price || 0;
    optionsHtml += `<option value="${prod.id}" data-price="${price}" ${sel}>${prod.name} — ${parseFloat(price).toFixed(2)} €</option>`;
  });

  row.innerHTML = `
    <select class="form-control co-prod-select" style="flex: 2;" required>${optionsHtml}</select>
    <input type="number" min="1" class="form-control co-qty-input" placeholder="Qté" value="${quantity}" style="flex: 1;" required>
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove(); updateCoSummary();">❌</button>
  `;

  const prodSelect = row.querySelector('.co-prod-select');
  const qtyInput = row.querySelector('.co-qty-input');

  prodSelect.addEventListener('change', updateCoSummary);
  qtyInput.addEventListener('input', updateCoSummary);

  container.appendChild(row);
}

function updateCoSummary() {
  const rows = document.querySelectorAll('.co-item-row');
  let total = 0;
  rows.forEach((row) => {
    const select = row.querySelector('.co-prod-select');
    const selectedOpt = select.options[select.selectedIndex];
    const qty = parseInt(row.querySelector('.co-qty-input').value, 10) || 0;
    const price = selectedOpt && selectedOpt.dataset.price ? parseFloat(selectedOpt.dataset.price) : 0;
    total += qty * price;
  });
  const summaryEl = document.getElementById('co-total-price-display');
  if (summaryEl) summaryEl.textContent = `${total.toFixed(2)} €`;
}

async function handleSaveCustomerOrder(e) {
  e.preventDefault();
  if (!requireRoleFor('ADMIN', 'CASHIER')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const coId = document.getElementById('co-id').value;
  const customerName = document.getElementById('co-customer-name').value;
  const customerPhone = document.getElementById('co-customer-phone').value;
  const deliveryDate = document.getElementById('co-delivery-date').value;
  const specialInstructions = document.getElementById('co-special-instructions').value;
  const rows = document.querySelectorAll('.co-item-row');

  const items = [];
  rows.forEach((row) => {
    const prodId = parseInt(row.querySelector('.co-prod-select').value, 10);
    const qty = parseInt(row.querySelector('.co-qty-input').value, 10);
    if (prodId && !isNaN(qty) && qty > 0) {
      items.push({ product_id: prodId, quantity: qty });
    }
  });

  if (items.length === 0) {
    return showToast('Ajoutez au moins un produit avec une quantité valide.', true);
  }

  const payload = {
    customer_name: customerName,
    customer_phone: customerPhone,
    delivery_date: deliveryDate,
    special_instructions: specialInstructions,
    items
  };

  try {
    const method = coId ? 'PUT' : 'POST';
    const url = coId ? `${API_BASE}/customer-orders/${coId}` : `${API_BASE}/customer-orders`;

    const co = await safeFetchJson(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast(coId ? `Commande client #${co.id} modifiée.` : `Commande client #${co.id} créée (PENDING).`);
    closeModal('co-modal');
    fetchCustomerOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function openCustomerOrderDetailModal(coId) {
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    const co = await safeFetchJson(`${API_BASE}/customer-orders/${coId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });

    document.getElementById('co-detail-id').textContent = co.id;
    const body = document.getElementById('co-detail-body');
    const actions = document.getElementById('co-detail-actions');

    let badgeClass = 'status-pending';
    if (co.status === 'IN_PRODUCTION') badgeClass = 'status-in_production';
    else if (co.status === 'READY') badgeClass = 'status-ready';
    else if (co.status === 'DELIVERED') badgeClass = 'status-delivered';
    else if (co.status === 'CANCELLED') badgeClass = 'status-cancelled';

    let itemsHtml = `
      <div class="card margin-top-10">
        <p>Client: <strong>${co.customer_name}</strong> (${co.customer_phone || 'Pas de téléphone'})</p>
        <p>Date de Livraison: <strong>${co.delivery_date}</strong></p>
        <p>Statut: <span class="stock-badge ${badgeClass}">${co.status}</span></p>
        <p>Total Prix: <strong>${parseFloat(co.total_price || 0).toFixed(2)} €</strong></p>
        ${co.special_instructions ? `<p style="margin-top: 8px;"><em>Note: ${co.special_instructions}</em></p>` : ''}
      </div>

      <h3 class="margin-top-20">Produits Commandés</h3>
      <table class="data-table margin-top-10">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Quantité</th>
            <th>Prix Unitaire</th>
            <th>Sous-total</th>
          </tr>
        </thead>
        <tbody>
          ${(co.items || []).map((it) => `
            <tr>
              <td><strong>${it.product_name || 'Produit #' + it.product_id}</strong></td>
              <td>${it.quantity}</td>
              <td>${parseFloat(it.unit_price).toFixed(2)} €</td>
              <td><strong>${parseFloat(it.subtotal).toFixed(2)} €</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    body.innerHTML = itemsHtml;

    const role = currentUser ? currentUser.role : '';
    const isCashierOrAdmin = ['ADMIN', 'CASHIER'].includes(role);
    const isProdOrAdmin = ['ADMIN', 'PRODUCTION'].includes(role);

    let actionBtns = `<button type="button" class="btn btn-secondary" onclick="closeModal('co-detail-modal')">Fermer</button>`;
    if (co.status === 'PENDING' && isProdOrAdmin) {
      actionBtns += ` <button type="button" class="btn btn-accent" onclick="closeModal('co-detail-modal'); updateCustomerOrderStatus(${co.id}, 'IN_PRODUCTION')">👨‍🍳 Lancer Fabrication</button>`;
    } else if (co.status === 'IN_PRODUCTION' && isProdOrAdmin) {
      actionBtns += ` <button type="button" class="btn btn-accent" onclick="closeModal('co-detail-modal'); updateCustomerOrderStatus(${co.id}, 'READY')">✨ Marquer Prête (READY)</button>`;
    } else if (co.status === 'READY' && isProdOrAdmin) {
      actionBtns += ` <button type="button" class="btn btn-accent" onclick="closeModal('co-detail-modal'); updateCustomerOrderStatus(${co.id}, 'DELIVERED')">🎁 Marquer Livrée (DELIVERED)</button>`;
    }

    if (['PENDING', 'IN_PRODUCTION'].includes(co.status) && isProdOrAdmin) {
      actionBtns += ` <button type="button" class="btn btn-danger" onclick="closeModal('co-detail-modal'); updateCustomerOrderStatus(${co.id}, 'CANCELLED')">✖ Annuler Commande</button>`;
    }

    actions.innerHTML = actionBtns;
    document.getElementById('co-detail-modal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function updateCustomerOrderStatus(id, status) {
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/customer-orders/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ status })
    });

    showToast(`Commande client #${id} passée au statut ${status}.`);
    fetchCustomerOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deleteCustomerOrder(id) {
  if (!confirm(`Supprimer la commande client #${id} ?`)) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  try {
    await safeFetchJson(`${API_BASE}/customer-orders/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` }
    });

    showToast(`Commande client #${id} supprimée.`);
    fetchCustomerOrders();
  } catch (err) {
    showToast(err.message, true);
  }
}

