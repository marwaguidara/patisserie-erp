const API_BASE = '/api';
// The frontend ONLY ever talks to the AI service through the same-origin "/ai" path
// (reverse-proxied). It never needs to know the AI service's real host/port — that
// mapping is owned by the proxy: nginx in Docker, or an Express proxy in local dev
// (see backend/src/app.js + frontend/nginx.conf).
const AI_BASE_URL = '/ai';

// Build a URL for any AI endpoint (forecast, etl/run, health,
// production-recommendations, anomalies, segmentation, insights).
function aiUrl(path) {
  return `${AI_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

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
//
// Every non-ADMIN role now has access to the RH self-service module:
//   employees  (self profile / directory / schedules / leaves / hours)
// 'profile' (Mon Profil) and 'hours' (Mes Heures) are self-service tabs visible
// to EVERY authenticated role — keep them in each role's ROLE_TABS entry.
const ROLE_TABS = {
  ADMIN: ['catalog', 'ingredients', 'production', 'sales', 'employees', 'profile', 'hours', 'suppliers', 'categories', 'purchase-orders', 'customer-orders', 'forecast', 'ai-technical', 'segmentation', 'dashboard'],

  // Non-admin RH self-service tabs (replaces 'employees' with role-specific RH modules)
  STOCK: ['catalog', 'categories', 'ingredients', 'suppliers', 'purchase-orders', 'forecast', 'profile', 'hours'],
  CASHIER: ['sales', 'customer-orders', 'profile', 'hours'],
  PRODUCTION: ['catalog', 'categories', 'ingredients', 'production', 'sales', 'forecast', 'profile', 'hours'],
  EMPLOYEE: ['profile', 'hours']
};

// Centralized permission check (frontend mirror of backend requirePermission).
// ADMIN always passes; other roles are checked against DEFAULT_ROLE_PERMISSIONS.
const ROLE_PERMISSIONS = {
  ADMIN: ['view_ai_forecast', 'run_ai_etl', 'view_ai_anomalies', 'view_ai_segmentation',
          'view_ingredients', 'manage_ingredients', 'view_stock_alerts',
          'view_sales', 'create_sale', 'view_suppliers', 'manage_suppliers',
          'view_purchase_orders', 'manage_purchase_orders', 'view_customer_orders',
          'manage_customer_orders', 'view_products', 'manage_products',
          'view_dashboard', 'crud_employee', 'view_profile', 'view_schedule',
          'view_leave', 'view_hours', 'create_leave', 'create_schedule',
          'approve_leave', 'reject_leave'],
  STOCK: ['view_products', 'view_ingredients', 'manage_ingredients', 'view_stock_alerts',
          'view_suppliers', 'manage_suppliers', 'view_purchase_orders', 'manage_purchase_orders',
          'view_ai_forecast', 'view_ai_anomalies',
          'view_profile', 'view_schedule', 'view_leave', 'view_hours', 'create_leave'],
  CASHIER: ['view_sales', 'create_sale', 'view_customer_orders', 'manage_customer_orders',
            'view_products',
            'view_profile', 'view_schedule', 'view_leave', 'view_hours', 'create_leave'],
  PRODUCTION: ['view_products', 'view_ingredients', 'manage_ingredients',
               'view_ai_forecast', 'view_sales',
               'view_profile', 'view_schedule', 'view_leave', 'view_hours', 'create_leave'],
  EMPLOYEE: ['view_products',
             'view_profile', 'view_schedule', 'view_leave', 'view_hours', 'create_leave']
};

// ===== SIDEBAR NAVIGATION (2026 UI/UX refactor) =====
// Chaque groupe regroupe des onglets existants (réutilise switchToTab, aucune
// logique métier dupliquée). "single" rend un lien direct (sans sous-menu).
const SIDEBAR_GROUPS = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠', single: true, tab: 'dashboard' },
  { id: 'catalogue', label: 'Catalogue', icon: '📦', items: [
    { tab: 'catalog', label: 'Produits' },
    { tab: 'categories', label: 'Catégories' },
    { tab: 'ingredients', label: 'Stocks & Ingrédients' }
  ]},
  { id: 'operations', label: 'Opérations', icon: '🏭', items: [
    { tab: 'production', label: 'Atelier de Fabrication' },
    { tab: 'sales', label: 'Ventes' }
  ]},
    { id: 'rh', label: 'RH', icon: '👥', items: [
    { tab: 'employees', label: 'Employés' },
    { tab: 'profile', label: 'Mon Profil' },
    { tab: 'hours', label: 'Mes Heures' }
  ]},
  { id: 'achats', label: 'Achats', icon: '🚚', items: [
    { tab: 'suppliers', label: 'Fournisseurs' },
    { tab: 'purchase-orders', label: 'Commandes Fournisseurs' }
  ]},
  { id: 'clients', label: 'Clients', icon: '🛒', items: [
    { tab: 'customer-orders', label: 'Commandes Clients' }
  ]},
  { id: 'ia', label: 'IA & Reporting', icon: '🤖', items: [
    { tab: 'forecast', label: 'Prévision IA' },
    { tab: 'segmentation', label: 'Segmentation' }
  ]},
  { id: 'admin', label: 'Administration', icon: '⚙', items: [
    { tab: 'ai-technical', label: 'Informations Techniques' }
  ]}
];

function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  nav.innerHTML = '';
  SIDEBAR_GROUPS.forEach((group) => {
    const grpEl = document.createElement('div');
    grpEl.className = 'sidebar-group';
    grpEl.dataset.group = group.id;

    if (group.single) {
      const link = document.createElement('a');
      link.className = 'sidebar-link';
      link.dataset.tab = group.tab;
      link.href = '#';
      link.setAttribute('role', 'button');
      link.innerHTML = `<span class="nav-icon">${group.icon}</span><span class="nav-label">${escapeHtml(group.label)}</span>`;
      link.addEventListener('click', (e) => { e.preventDefault(); switchToTab(group.tab); });
      grpEl.appendChild(link);
      nav.appendChild(grpEl);
      return;
    }

    const btn = document.createElement('button');
    btn.className = 'sidebar-group-btn';
    btn.type = 'button';
    btn.innerHTML = `<span class="nav-icon">${group.icon}</span><span class="nav-label">${escapeHtml(group.label)}</span><span class="chevron">▾</span>`;
    btn.addEventListener('click', () => {
      const sn = document.getElementById('sidenav');
      if (sn && sn.classList.contains('collapsed')) {
        const cb = document.getElementById('sidebar-collapse');
        if (cb) cb.click();
        openSidebarGroup(group.id);
      } else {
        grpEl.classList.toggle('open');
      }
    });

    const sub = document.createElement('div');
    sub.className = 'sidebar-submenu';
    group.items.forEach((item) => {
      const link = document.createElement('a');
      link.className = 'sidebar-link';
      link.dataset.tab = item.tab;
      link.href = '#';
      link.setAttribute('role', 'button');
      link.innerHTML = `<span class="nav-label">${escapeHtml(item.label)}</span>`;
      link.addEventListener('click', (e) => { e.preventDefault(); switchToTab(item.tab); });
      sub.appendChild(link);
    });

    grpEl.appendChild(btn);
    grpEl.appendChild(sub);
    nav.appendChild(grpEl);
  });
  openActiveSidebarLink();
}

function openSidebarGroup(id) {
  document.querySelectorAll('.sidebar-group').forEach((g) => {
    g.classList.toggle('open', g.dataset.group === id);
  });
}

function openActiveSidebarLink() {
  const activeContent = document.querySelector('.tab-content.active');
  if (!activeContent) return;
  const tabName = activeContent.id.replace('tab-', '');
  const link = document.querySelector(`.sidebar-link[data-tab="${tabName}"]`);
  if (link) {
    link.classList.add('active');
    const grp = link.closest('.sidebar-group');
    if (grp) grp.classList.add('open');
  }
}

function toggleSidebar() {
  if (window.innerWidth <= 991) {
    document.body.classList.toggle('sidebar-open');
  } else {
    const sn = document.getElementById('sidenav');
    if (!sn) return;
    sn.classList.toggle('collapsed');
    const cb = document.getElementById('sidebar-collapse');
    if (cb) cb.textContent = sn.classList.contains('collapsed') ? '⤡' : '⤢';
  }
}

function initSidebarControls() {
  const toggle = document.getElementById('sidebar-toggle');
  const overlay = document.getElementById('sidebar-overlay');
  const collapseBtn = document.getElementById('sidebar-collapse');
  if (toggle) toggle.addEventListener('click', toggleSidebar);
  if (overlay) overlay.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
  if (collapseBtn) collapseBtn.addEventListener('click', () => {
    const sn = document.getElementById('sidenav');
    sn.classList.toggle('collapsed');
    collapseBtn.textContent = sn.classList.contains('collapsed') ? '⤡' : '⤢';
  });
}

// Static header action buttons -> roles allowed to see them.
const BUTTON_ROLES = {
  'open-create-product-btn': ['ADMIN', 'PRODUCTION'],
  'open-movement-btn': ['ADMIN', 'STOCK'],
  'open-create-ingredient-btn': ['ADMIN', 'STOCK'],
  'open-create-employee-btn': ['ADMIN'],
  'open-create-schedule-btn': ['ADMIN'],
  'open-create-leave-btn': ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'],
  'open-create-supplier-btn': ['ADMIN', 'STOCK'],
  'open-create-category-btn': ['ADMIN'],
  'open-create-po-btn': ['ADMIN', 'STOCK'],
  'open-create-co-btn': ['ADMIN', 'CASHIER']
};

function getRole() {
  return currentUser ? currentUser.role : '';
}

// Centralized RBAC permission evaluation helper (frontend mirror of backend).
function can(permission) {
  const role = getRole();
  if (!role) return false;
  if (role === 'ADMIN') return true;
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
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

  // 1) Sidebar links visibility by role
  document.querySelectorAll('.sidebar-link').forEach((link) => {
    const tab = link.dataset.tab;
    let visible = !allowedTabs || allowedTabs.includes(tab);
    if (tab === 'forecast') visible = can('view_ai_forecast');
    link.style.display = visible ? '' : 'none';
    if (!visible) link.classList.remove('active');
  });

  // 2) Hide groups whose sub-links are all hidden by role-based visibility
  document.querySelectorAll('.sidebar-group').forEach((grp) => {
    const hasVisible = Array.from(grp.querySelectorAll('.sidebar-link'))
      .some((l) => l.style.display !== 'none');
    grp.style.display = hasVisible ? '' : 'none';
    if (!hasVisible) grp.classList.remove('open', 'active');
  });

  // 3) Deactivate sections whose tab is no longer visible
  document.querySelectorAll('.sidebar-link').forEach((link) => {
    if (link.style.display === 'none') {
      const content = document.getElementById('tab-' + link.dataset.tab);
      if (content) content.classList.remove('active');
    }
  });

  // 4) If the visible active route disappeared, switch to the first visible link
  const activeLink = document.querySelector('.sidebar-link.active');
  const activeVisible = activeLink && activeLink.style.display !== 'none';
  if (!activeVisible) {
    const firstVisible = Array.from(document.querySelectorAll('.sidebar-link'))
      .find((l) => l.style.display !== 'none');
    if (firstVisible) {
      switchToTab(firstVisible.dataset.tab);
    }
  }

  // 5) Gate the static header action buttons (unchanged behaviour)
  Object.entries(BUTTON_ROLES).forEach(([id, roles]) => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = roles.includes(role) ? '' : 'none';
  });

  // 6) Non-ADMIN: hide employee directory and admin-only form controls
  // so they only manage their own profile / schedules / leaves.
  // All non-ADMIN roles are now covered (EMPLOYEE, CASHIER, STOCK, PRODUCTION).
  if (currentUser) {
    const isNotAdmin = role !== 'ADMIN';
    const dir = document.getElementById('employee-directory-container');
    if (dir) dir.style.display = isNotAdmin ? 'none' : '';
    // The "Nouvel Employé" button is already hidden via BUTTON_ROLES for non-admin.
    const createEmpBtn = document.getElementById('open-create-employee-btn');
    if (createEmpBtn) createEmpBtn.style.display = isNotAdmin ? 'none' : '';
    // Leaves form: non-ADMIN cannot set status
    const leaveEmployeeField = document.getElementById('leave-employee-field');
    if (leaveEmployeeField) leaveEmployeeField.style.display = isNotAdmin ? 'none' : '';
    const leaveStatusField = document.getElementById('leave-status-field');
    if (leaveStatusField) leaveStatusField.style.display = isNotAdmin ? 'none' : '';
  }

  // 7) Consolidated page-level refresh button (replaces 6 separate refresh buttons)
  const refreshBtn = document.getElementById('refresh-page');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Reload relevant data based on current tab
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab) {
        const tab = activeTab.dataset.tab;
        switch (tab) {
          case 'profile':
            fetchProfile();
            break;
          case 'hours':
            fetchHours();
            break;
          case 'schedules':
            fetchSchedules();
            break;
          case 'leaves':
            fetchLeaves();
            break;
          default:
            // Reload all RH-related data
            fetchProfile();
            fetchHours();
            fetchSchedules();
            fetchLeaves();
        }
      }
    });
  }
}


document.addEventListener('DOMContentLoaded', async () => {
  buildSidebar();
  initTabs();
  initSidebarControls();
  initNotifications();
  initAuth();
  await loadAllData();
  initSales();

  // Refresh Buttons
  document.getElementById('refresh-products').addEventListener('click', fetchProducts);
  document.getElementById('refresh-ingredients').addEventListener('click', fetchIngredients);
  document.getElementById('refresh-sales').addEventListener('click', loadSalesData);
  document.getElementById('refresh-employees').addEventListener('click', fetchEmployees);
  document.getElementById('refresh-profile').addEventListener('click', fetchProfile);
  document.getElementById('refresh-hours').addEventListener('click', fetchHours);
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

  // Sale details drawer wiring
  document.getElementById('sd-close').addEventListener('click', closeSaleDetail);
  document.getElementById('sd-close-bottom').addEventListener('click', closeSaleDetail);
  document.getElementById('sd-ticket').addEventListener('click', () => {
    if (currentSaleId) openSaleTicket(currentSaleId);
  });
  document.getElementById('sale-detail-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSaleDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSaleDetail();
  });
      document.getElementById('forecast-product-select').addEventListener('change', loadForecast);
      document.getElementById('forecast-horizon-select').addEventListener('change', loadForecast);
  document.getElementById('refresh-forecast-btn').addEventListener('click', refreshForecastData);

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
  // Self-service « Demander un congé » (écran Mes Heures)
  const requestMyLeaveBtn = document.getElementById('request-my-leave-btn');
  if (requestMyLeaveBtn) requestMyLeaveBtn.addEventListener('click', openMyLeaveModal);
  const myLeaveForm = document.getElementById('my-leave-form');
  if (myLeaveForm) myLeaveForm.addEventListener('submit', handleSaveMyLeave);
  // Self-service « Modifier mes informations » (phone / address)
  const editProfileForm = document.getElementById('edit-profile-form');
  if (editProfileForm) editProfileForm.addEventListener('submit', handleSaveEditProfile);
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
  await loadAnomalies();
  await loadSalesData();
  if (authToken) {
    await loadAuthDependentData();
  }
}

async function loadAuthDependentData() {
  const tasks = [];
  if (hasAnyRole('ADMIN')) {
    tasks.push(fetchEmployees()); // ADMIN sees full directory
  } else {
    // Non-ADMIN: still fetch employees (the API self-filters to own record)
    // so that populateEmployeeSelects() has the 1 record for leave/schedule forms.
    tasks.push(fetchEmployees());
  }
  if (hasAnyRole('ADMIN', 'STOCK', 'PRODUCTION')) tasks.push(fetchSuppliers());
  // All authenticated roles can view their own schedules and leaves
  tasks.push(fetchSchedules());
  tasks.push(fetchLeaves());
  // All authenticated roles can view their own profile and hours
  tasks.push(fetchProfile());
  tasks.push(fetchHours());
  if (hasAnyRole('ADMIN', 'STOCK', 'PRODUCTION')) tasks.push(fetchPurchaseOrders());
  if (hasAnyRole('ADMIN', 'CASHIER', 'PRODUCTION')) tasks.push(fetchCustomerOrders());
  if (hasAnyRole('ADMIN')) tasks.push(fetchAvailableUsers());
  try {
    await Promise.all(tasks);
  } catch (err) {
    console.warn('Chargement des données authentifiées échoué:', err);
  }
  // Once the user role is known, refresh the production-declaration recommendation
  // for the currently selected product so the AI advice auto-displays when the
  // user opens the Atelier de Fabrication screen.
  loadProductionRecommendation();
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
  if (!can('view_ai_forecast')) {
    renderForecastForbidden();
    return;
  }

  const select = document.getElementById('forecast-product-select');
  const horizonSelect = document.getElementById('forecast-horizon-select');
  const productId = select ? select.value : '';
  const horizon = horizonSelect ? horizonSelect.value : '7';

  if (!productId) {
    renderForecastUnavailable();
    return;
  }

  const headers = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch(aiUrl(`/forecast?product_id=${productId}&horizon_days=${horizon}`), { headers });
    if (res.status === 403 || res.status === 401) {
      renderForecastForbidden();
      return;
    }
    if (!res.ok) {
      // HTTP-level failure (proxy could not reach the AI service).
      throw new Error(`Erreur AI service ${res.status}`);
    }
    const data = await res.json();
    // Valid business response only: { value, confidence:{level,interval}, status }.
    renderForecast(data);
  } catch (err) {
    // Network/proxy error (AI stopped, timeout, DNS, proxy). Distinct from any
    // business state — never conflated with "historique insuffisant".
    console.error('Forecast network error:', err);
    renderForecastUnavailable();
  }
}

// Business-friendly labels for the underlying technical model_version.
// The raw identifier (ridge-v2 / baseline-v1) is kept only in data-model-version
// (attribute) for debugging — it is not the primary visible text.
const FORECAST_METHOD_LABELS = {
  'ridge-v2': 'Méthode : analyse avancée',
  'baseline-v1': 'Méthode : estimation simple'
};

// Refreshes the forecast. For ADMIN this also refreshes the underlying data
// (ETL, which invalidates the forecast cache) before reloading; for the other
// forecast roles (PRODUCTION/STOCK) it simply reloads the current forecast.
async function refreshForecastData() {
  if (can('run_ai_etl')) {
    await runEtl();
  } else {
    await loadForecast();
  }
}

// Sets the visible method label and keeps the raw model_version for debug.
function renderForecastMethod(modelVersion) {
  const modelEl = document.getElementById('forecast-model-version');
  if (!modelEl) return;
  const raw = modelVersion || '';
  modelEl.dataset.modelVersion = raw;
  modelEl.textContent = raw
    ? (FORECAST_METHOD_LABELS[raw] || `Méthode : ${raw}`)
    : 'Méthode : --';
}

// Displays when the forecast data was last refreshed on screen.
function renderForecastUpdated() {
  const updatedEl = document.getElementById('forecast-updated');
  if (updatedEl) updatedEl.textContent = new Date().toLocaleString('fr-FR') + ' (heure locale)';
}

// Renders a VALID business response from the AI service.
function renderForecast(data) {
  const valueEl = document.getElementById('forecast-value');
  const confidenceEl = document.getElementById('forecast-confidence');
  const statusEl = document.getElementById('forecast-status');
  const intervalEl = document.getElementById('forecast-interval');
  const intervalInfoEl = document.getElementById('forecast-info-interval');

  const isInsufficient = data.status === 'insufficient_data';
  const value = isInsufficient
    ? 'Historique insuffisant'
    : (data.value == null ? '--' : `${Number(data.value).toFixed(2)} unités`);
  const confidenceLevel = data.confidence && data.confidence.level ? data.confidence.level : 'faible';
  const interval = data.confidence && Array.isArray(data.confidence.interval) ? data.confidence.interval : null;
  const intervalText = interval
    ? `Intervalle: ${interval[0]} à ${interval[1]} unités`
    : 'Intervalle: --';
  const businessInterval = interval
    ? `Vous pouvez vous attendre à vendre entre ${interval[0]} et ${interval[1]} unités.`
    : 'Vous pouvez vous attendre à vendre entre — et — unités.';

  if (valueEl) valueEl.textContent = value;
  if (confidenceEl) confidenceEl.textContent = `${confidenceLevel} / ${data.status || 'unknown'}`;
  if (statusEl) statusEl.textContent = data.status || 'unknown';
  if (intervalEl) intervalEl.textContent = intervalText;
  if (intervalInfoEl) intervalInfoEl.textContent = isInsufficient ? 'Non disponible — il manque encore des ventes passées sur ce produit.' : businessInterval;
  renderForecastMethod(data.model_version);
  renderForecastUpdated();
}

function renderForecastForbidden() {
  const valueEl = document.getElementById('forecast-value');
  const confidenceEl = document.getElementById('forecast-confidence');
  const statusEl = document.getElementById('forecast-status');
  const intervalEl = document.getElementById('forecast-interval');
  if (valueEl) valueEl.textContent = 'Accès Refusé';
  if (confidenceEl) confidenceEl.textContent = '403 Forbidden';
  if (statusEl) statusEl.textContent = 'Accès non autorisé pour votre rôle';
  if (intervalEl) intervalEl.textContent = 'Intervalle: --';
  renderForecastMethod('');
}

// Network-level failure: AI service unreachable through the proxy.
function renderForecastUnavailable() {
  const valueEl = document.getElementById('forecast-value');
  const confidenceEl = document.getElementById('forecast-confidence');
  const statusEl = document.getElementById('forecast-status');
  const intervalEl = document.getElementById('forecast-interval');
  if (valueEl) valueEl.textContent = '--';
  if (confidenceEl) confidenceEl.textContent = '--';
  if (statusEl) statusEl.textContent = 'Service IA injoignable';
  if (intervalEl) intervalEl.textContent = 'Intervalle: --';
  renderForecastMethod('');
}

async function runEtl() {
  if (!can('run_ai_etl')) {
    showToast('Accès refusé : votre rôle ne permet pas d\'exécuter l\'ETL.', true);
    return;
  }

  const etlBtn = document.getElementById('refresh-forecast-btn');
  if (etlBtn) { etlBtn.disabled = true; etlBtn.textContent = '🔄 Mise à jour des données...'; }

  const headers = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const res = await fetch(aiUrl('/etl/run'), { method: 'POST', headers });
    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        throw new Error('Accès refusé par le serveur (403)');
      }
      throw new Error(`Erreur ETL ${res.status}`);
    }
    const data = await res.json();
    const meta = data.value || {};
    showToast(`Actualisation : ${meta.rows || 0} lignes, ${meta.product_count || 0} produits`, false);
    // Invalidate cache and reload forecast
    await loadForecast();
  } catch (err) {
    console.error('ETL run network error:', err);
    showToast(err.message || 'Erreur ETL : service IA injoignable', true);
  } finally {
    if (etlBtn) { etlBtn.disabled = false; etlBtn.textContent = '🔄 Actualiser les données'; }
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
    option.textContent = `${product.name} — ${parseFloat(product.price).toFixed(2)} DT — Stock ${product.stock_quantity}`;
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
  subtotalDisplay.textContent = 'Sous-total: 0.00 DT';

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
      subtotalDisplay.textContent = `Sous-total: ${(selectedProduct.price * qtyVal).toFixed(2)} DT`;
    } else {
      subtotalDisplay.textContent = 'Sous-total: 0.00 DT';
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
  document.getElementById('sale-total-amount').textContent = `${total.toFixed(2)} DT`;
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
      { title: "Revenu du jour", value: `${metrics.day.total_revenue.toFixed(2)} DT`, subtitle: `${metrics.day.sales_count} ventes` },
      { title: "Revenu semaine", value: `${metrics.week.total_revenue.toFixed(2)} DT`, subtitle: `${metrics.week.sales_count} ventes` },
      { title: "Revenu mois", value: `${metrics.month.total_revenue.toFixed(2)} DT`, subtitle: `${metrics.month.sales_count} ventes` },
      { title: "Panier moyen", value: `${metrics.month.average_ticket.toFixed(2)} DT`, subtitle: `${metrics.top_products.length} produits vendus` }
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-secondary);">Aucune vente trouvée pour les filtres sélectionnés.</td></tr>';
    return;
  }

  sales.forEach((sale) => {
    const tr = document.createElement('tr');
    const itemsCount = sale.total_items || (sale.items ? sale.items.reduce((s, it) => s + (parseInt(it.quantity, 10) || 0), 0) : 0);
    const dateStr = sale.created_at ? new Date(sale.created_at).toLocaleString('fr-FR') : (sale.completed_at ? new Date(sale.completed_at).toLocaleString('fr-FR') : '—');
    const itemsLabel = `${itemsCount} produit${itemsCount > 1 ? 's' : ''}`;
    tr.innerHTML = `
      <td>${sale.id}</td>
      <td>${dateStr}</td>
      <td>${escapeHtml(sale.customer_name || 'Walk-in')}</td>
      <td>${parseFloat(sale.total_amount).toFixed(2)} DT</td>
      <td>${itemsLabel}</td>
      <td class="sales-detail-cell">
        <button type="button" class="btn btn-sm btn-details" onclick="openSaleDetail(${sale.id})" title="Voir le détail complet de la vente">
          👁 Détails
        </button>
      </td>
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

// ===== Sale details drawer (ERP) — réutilise GET /api/sales/:id existant =====
let currentSaleId = null;

function saleProductName(productId) {
  const product = productsList.find((p) => Number(p.id) === Number(productId));
  return product ? product.name : `Produit #${productId}`;
}

function closeSaleDetail() {
  const overlay = document.getElementById('sale-detail-modal');
  if (overlay) overlay.classList.add('hidden');
}

async function openSaleDetail(saleId) {
  if (!authToken) {
    showToast('Veuillez vous connecter pour voir le détail de la vente.', true);
    return;
  }
  const overlay = document.getElementById('sale-detail-modal');
  const body = document.getElementById('sale-detail-body');
  if (!overlay || !body) return;

  document.getElementById('sd-sale-id').textContent = saleId;
  currentSaleId = saleId;
  body.innerHTML = '<div class="sale-drawer-loading">Chargement du détail…</div>';
  overlay.classList.remove('hidden');

  try {
    const sale = await safeFetchJson(`${API_BASE}/sales/${saleId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderSaleDetail(sale);
  } catch (err) {
    console.error('Erreur chargement détail vente:', err);
    body.innerHTML = '<div class="sale-drawer-error">Impossible de charger le détail de la vente.</div>';
  }
}

function renderSaleDetail(sale) {
  const body = document.getElementById('sale-detail-body');
  if (!body) return;

  const items = Array.isArray(sale.items) ? sale.items : [];
  const payment = sale.payment_method
    || (Array.isArray(sale.payments) && sale.payments[0] ? sale.payments[0].payment_method : null)
    || '—';
  const dateStr = sale.completed_at || sale.created_at;
  const dateLabel = dateStr ? new Date(dateStr).toLocaleString('fr-FR') : '—';
  const subtotal = items.reduce((sum, it) => sum + (parseFloat(it.subtotal) || 0), 0);
  const total = (sale.total_amount !== null && sale.total_amount !== undefined) ? parseFloat(sale.total_amount) : subtotal;

  const itemsHtml = items.length
    ? items.map((it) => `
        <li class="sd-item">
          <span class="sd-item-name">${escapeHtml(saleProductName(it.product_id))}</span>
          <span class="sd-item-qty">× ${parseInt(it.quantity, 10) || 0}</span>
          <span class="sd-item-subtotal">${(parseFloat(it.subtotal) || 0).toFixed(2)} DT</span>
        </li>`).join('')
    : '<li class="sd-empty">Aucun article enregistré.</li>';

  body.innerHTML = `
    <div class="sd-meta">
      <div class="sd-meta-row"><span>Client</span><strong>${escapeHtml(sale.customer_name || 'Walk-in')}</strong></div>
      <div class="sd-meta-row"><span>Téléphone</span><strong>${escapeHtml(sale.customer_phone || '—')}</strong></div>
      <div class="sd-meta-row"><span>Date</span><strong>${escapeHtml(dateLabel)}</strong></div>
      <div class="sd-meta-row"><span>Mode de paiement</span><strong>${escapeHtml(payment)}</strong></div>
    </div>
    <h4 class="sd-subtitle">Produits achetés</h4>
    <ul class="sd-items">${itemsHtml}</ul>
    <div class="sd-totals">
      <div class="sd-total-row"><span>Sous-total</span><strong>${subtotal.toFixed(2)} DT</strong></div>
      <div class="sd-total-row sd-total-grand"><span>Total</span><strong>${total.toFixed(2)} DT</strong></div>
    </div>`;
}

function renderSalesMetricsPlaceholder() {
  const grid = document.getElementById('sales-metrics-grid');
  grid.innerHTML = '<div class="metric-card"><h4>Revenu du jour</h4><strong>—</strong><p>Connectez-vous pour voir les KPI</p></div>'.repeat(4);
}

function renderSalesHistoryPlaceholder() {
  const tbody = document.getElementById('sales-history-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-secondary);">Connectez-vous pour afficher l\'historique des ventes.</td></tr>';
}

// Tab navigation — shared implementation, also reused by the anomaly
// "open concerned screen" links (no second navigation system is created).
// --- Section Segmentation IA & Suggestions (ADMIN only) ---
// Quadrant labels in business-language (never expose raw technical quadrant codes).
const QUADRANT_LABELS = {
  star: { title: 'Étoiles — Meilleures ventes & rentables',        color: '--accent-yellow',  bg: 'rgba(245,158,11,0.12)' },
  cash_cow: { title: 'Vaches à lait — Rentables mais demande modérée', color: '--accent-green',   bg: 'rgba(16,185,129,0.12)' },
  en_observation: { title: 'À surveiller — Demande basse, à revoir',    color: '--text-secondary', bg: 'rgba(148,163,184,0.12)' },
  to_remove: { title: 'À retirer — Moins rentable et moins demandé',   color: '--accent-red',    bg: 'rgba(239,68,68,0.12)' }
};
const QUADRANT_ORDER = ['star', 'cash_cow', 'en_observation', 'to_remove'];

// Fetch /ai/segmentation + /ai/insights for the current ADMIN user and render
// the 4-quadrant grid + the business-language insights list. 403 → tab hidden.
async function loadSegmentation() {
  const wrap = document.getElementById('segmentation-quadrants');
  const insightsEl = document.getElementById('segmentation-insights');
  if (!wrap || !insightsEl) return;

  wrap.innerHTML = '<p class="text-muted">Chargement de la segmentation IA…</p>';
  insightsEl.innerHTML = '<p class="text-muted">Chargement des suggestions…</p>';

  try {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

    // Segmentation
    const segRes = await fetch(aiUrl('/segmentation'), { headers });
    if (segRes.status === 401 || segRes.status === 403) {
      // RBAC: non-ADMIN cannot see this screen. Hide the tab entirely.
      const tabBtn = document.querySelector('.tab-btn[data-tab="segmentation"]');
      if (tabBtn) tabBtn.style.display = 'none';
      wrap.innerHTML = '';
      insightsEl.innerHTML = '';
      return;
    }
    if (!segRes.ok) throw new Error(`Segmentation ${segRes.status}`);
    const segData = await segRes.json();
    const segments = Array.isArray(segData.segments) ? segData.segments : [];

    // Build quadrant buckets (empty allowed — no hardcoded data)
    const buckets = { star: [], cash_cow: [], en_observation: [], to_remove: [] };
    segments.forEach((p) => {
      if (p && p.quadrant && buckets[p.quadrant]) buckets[p.quadrant].push(p);
    });

    // Render grid (always 4 cards, even if empty — "Cas limite" handling)
    wrap.innerHTML = QUADRANT_ORDER.map((q) => {
      const cfg = QUADRANT_LABELS[q];
      const items = buckets[q];
      return `
      <div class="quadrant-card" style="background:${cfg.bg};border-color:rgba(var(--border-rgb,255,255,255),0.12);">
        <div class="quadrant-header" style="color:var(${cfg.color});">
          <span class="quadrant-icon">${q === 'star' ? '⭐' : q === 'cash_cow' ? '🐄' : q === 'en_observation' ? '🔍' : '🚫'}</span>
          <strong>${cfg.title}</strong>
        </div>
        ${items.length === 0
          ? '<p class="text-muted" style="font-size:0.85rem;">Aucun produit pour le moment.</p>'
          : items.map((p) => `
            <div class="quadrant-item">
              <span class="quadrant-item-name">${escapeHtml(p.product_name || ('Produit #' + (p.product_id ?? '')))}</span>
                            <span class="quadrant-meta">Marge ${p.margin !== undefined ? Number(p.margin).toFixed(2) + 'DT/u' : '—'} · Fréquence ${p.sales_frequency !== undefined ? Number(p.sales_frequency).toFixed(1) : '—'} /mois
                <span class="confidence">${p.confidence && p.confidence.level ? ' (confiance ' + escapeHtml(String(p.confidence.level)) + ')' : ''}</span></span>
            </div>`).join('')
        }
      </div>`;
    }).join('');

    // Insights (business-language — render the message as-is, no jargon added)
    const insRes = await fetch(aiUrl('/insights'), { headers });
    if (insRes.status === 401 || insRes.status === 403) {
      insightsEl.innerHTML = '';
      return;
    }
    if (!insRes.ok) throw new Error(`Insights ${insRes.status}`);
    const insData = await insRes.json();
    const insights = Array.isArray(insData.insights) ? insData.insights : [];

    insightsEl.innerHTML = insights.length === 0
      ? '<p class="text-muted">Aucune suggestion pour le moment.</p>'
      : insights.map((i) => `
        <div class="insight-item">
          <span class="insight-type">${escapeHtml(i.type || 'suggestion')}</span>
          <p class="insight-message">${escapeHtml(i.message || '')}</p>
          ${i.confidence && i.confidence.level ? `<span class="confidence">Confiance : ${escapeHtml(String(i.confidence.level))}</span>` : ''}
        </div>`).join('');
  } catch (err) {
    console.error('Segmentation load error:', err);
    wrap.innerHTML = '<p class="text-muted">Impossible de charger la segmentation IA pour le moment.</p>';
    insightsEl.innerHTML = '<p class="text-muted">Suggestions temporairement inaccessibles.</p>';
  }
}

// --- Tab switching ---
function switchToTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach((l) => l.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

  const tab = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (tab) tab.classList.add('active');

  // Activate the matching sidebar link and open its parent group
  const link = document.querySelector(`.sidebar-link[data-tab="${tabName}"]`);
  if (link) {
    link.classList.add('active');
    const grp = link.closest('.sidebar-group');
    if (grp) {
      document.querySelectorAll('.sidebar-group').forEach((g) => g.classList.remove('open'));
      grp.classList.add('open');
      const btn = grp.querySelector('.sidebar-group-btn');
      if (btn) btn.classList.add('active');
      const sb = document.getElementById('sidenav');
      if (sb && sb.classList.contains('collapsed')) {
        const cb = document.getElementById('sidebar-collapse');
        if (cb) cb.click();
      }
    }
  }

  const target = document.getElementById(`tab-${tabName}`);
  if (target) target.classList.add('active');

  // On mobile, close the off-canvas sidebar after navigation
  document.body.classList.remove('sidebar-open');
}

// Wiring for the Segmentation tab: load on open + button refresh. Also defines
// escapeHtml if not already present (used by loadSegmentation for XSS-safe render).
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('refresh-segmentation');
  if (btn) btn.addEventListener('click', () => loadSegmentation());
});

// Patch switchToTab so opening the Segmentation tab auto-loads data.
const _origSwitchToTab = switchToTab;
switchToTab = function (tabName) {
  const r = _origSwitchToTab(tabName);
  if (tabName === 'segmentation' && hasAnyRole('ADMIN')) {
    loadSegmentation();
  }
  if (tabName === 'dashboard' && hasAnyRole('ADMIN')) {
    loadAdminDashboard();
  }
  if (tabName === 'profile') {
    if (!currentProfile) fetchProfile();
    if (!currentHours) fetchHours();
  }
  if (tabName === 'hours') {
    if (!currentHours) fetchHours();
  }
  return r;
};

// (L'activation de la catégorie/groupe parent est gérée dans switchToTab.)

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((tab) => {
    tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
  });
}

// Les helpers initCategoryTabs() / updateCategoryVisibility() ont été retirés :
// la visibilité des groupes est désormais gérée par applyRoleVisibility() +
// buildSidebar() (navigation par sidebar latérale).

// ===== Landing Page Gate =====
// The ERP (header + sidebar + dashboard tabs) is hidden behind a public
// landing page until the visitor authenticates. The login modal sits
// outside #erp-app so it stays reachable from the landing page.
function setAppVisibility(authenticated) {
  const erp = document.getElementById('erp-app');
  const landing = document.getElementById('landing-page');
  if (erp) erp.classList.toggle('hidden', !authenticated);
  if (landing) landing.classList.toggle('hidden', authenticated);
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
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      showToast('Veuillez saisir votre email et votre mot de passe.', true);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.status !== 200) {
        let msg = `Erreur de connexion (HTTP ${res.status}).`;
        try {
          const data = await res.json();
          if (data && data.error) msg = data.error;
        } catch (_) { /* corps non-JSON exploitable */ }
        // Message clair pour des identifiants invalides (la route renvoie 401).
        if (res.status === 401) {
          showToast('Email ou mot de passe incorrect.', true);
        } else {
          showToast(msg, true);
        }
        return;
      }

      const data = await res.json();
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('bakery_jwt', authToken);

      updateUserUI();
      closeModal('login-modal');
      setAppVisibility(true);
      showToast(`Bienvenue, ${currentUser.name} (${currentUser.role})`);
      await loadAuthDependentData();
      loadSalesData();
      loadAnomalies();
      if (currentUser && currentUser.role === 'ADMIN') {
        loadAdminDashboard();
      }
    } catch (err) {
      showToast('Impossible de contacter le serveur.', true);
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
          setAppVisibility(true);
          loadAuthDependentData();
          loadSalesData();
          loadAnomalies();
        }
      })
      .catch(() => localStorage.removeItem('bakery_jwt'));
  }

  // Hook du formulaire « Modifier mon mot de passe » (self-service)
  const changePasswordForm = document.getElementById('change-password-form');
  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await submitChangePassword();
    });
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
  // Reset notification state so no stale server notification from the previous
  // session leaks into the panel after a user change / logout.
  __serverNotifications = [];
  __notifications = [];
  __notifRead = new Set();
  __persistNotifRead();
  updateNotifBadge();
  document.getElementById('user-profile').innerHTML = `
        <button class="btn btn-secondary" id="login-modal-btn" onclick="document.getElementById('login-modal').classList.remove('hidden')">Se Connecter</button>
  `;
  showToast('Déconnecté.');
  setAppVisibility(false);
  applyRoleVisibility();
  loadAnomalies();
}

// Dashboard alerts visibility: the header badge is shown when at least one
// alert pill is visible (low stock / expiry / AI anomalies).
function updateAlertsBadgeVisibility() {
  const badge = document.getElementById('alerts-summary-badge');
  if (!badge) return;
  const anyVisible = Array.from(badge.querySelectorAll('.alert-pill'))
    .some((pill) => !pill.classList.contains('hidden'));
  badge.classList.toggle('hidden', !anyVisible);
}

// Fetch Alerts (existing dashboard alert panel — also reused by the anomalies)
async function fetchAlerts() {
  try {
    const alerts = await safeFetchJson(`${API_BASE}/stocks/alerts`);

    const badgeLow = document.getElementById('badge-low-stock');
    const badgeExp = document.getElementById('badge-expiring');

    badgeLow.textContent = `⚠️ ${alerts.low_stock_count} Stock Faible`;
    badgeExp.textContent = `⏳ ${alerts.expiring_soon_count} Péremption`;
    badgeLow.classList.toggle('hidden', (alerts.low_stock_count || 0) <= 0);
    badgeExp.classList.toggle('hidden', (alerts.expiring_soon_count || 0) <= 0);
    __stockAlerts = alerts;
    refreshNotifications();

    updateAlertsBadgeVisibility();
  } catch (err) {
    console.error('Error fetching alerts:', err);
  }
}

// Sprint 5 — ADMIN Dashboard consolidated view
// Reuses existing source endpoints (sales/metrics, stocks/alerts, /ai/*),
// never duplicates widget logic nor hardcodes business data.
let __dashboardSummaryCache = null; // snapshot of /dashboard/summary used by both render + export
async function loadAdminDashboard() {
  const summaryBox = document.getElementById('dashboard-kpi-cards');
  const iaBox = document.getElementById('dashboard-ia-summary');
  const linksBox = document.getElementById('dashboard-links');
  if (!summaryBox) return;

  try {
    // Single authoritative source for this screen; KPIs core + IA summary already composed by backend.
    const data = await safeFetchJson(`${API_BASE}/dashboard/summary`, { headers: { Authorization: `Bearer ${authToken}` } });
    __dashboardSummaryCache = data; // cache for export — exact same snapshot shown on screen

    // --- KPI CORE (reuse /api/sales/metrics + /api/stocks/alerts fields) ---
    const { kpis } = data;
    summaryBox.innerHTML = `
      <div class="card"><div class="card-body"><h3>CA mensuel</h3><p class="kpi-value">${Number(kpis.revenue || 0).toFixed(2)} DT</p></div></div>
      <div class="card"><div class="card-body"><h3>Stock critique</h3><p class="kpi-value">${kpis.critical_stock_count || 0}</p></div></div>
      <div class="card"><div class="card-body"><h3>Meilleures ventes</h3>
        <ul class="kpi-list">${(kpis.top_products || []).map((p) =>
          `<li>${p.name} — ${(p.units_sold || 0)} u</li>`).join('')}</ul></div></div>`;

    // --- IA SUMMARY (reuse /ai forecast|anomalies|segmentation summaries) ---
    const fc = data.forecast_summary || {};
    iaBox.innerHTML = `
      <div class="card"><div class="card-body"><h3>Résumé prévision</h3>
        <p class="kpi-value">${fc.product_name || '—'} → ${(fc.forecast_next || 0).toFixed(1)} u / ${(fc.horizon_days || 7)}j</p></div></div>
      <div class="card"><div class="card-body"><h3>Anomalies actives</h3>
        <p class="kpi-value">${data.active_anomalies_count || 0}</p></div></div>
      <div class="card"><div class="card-body"><h3>Segmentation IA</h3>
        <p class="kpi-value">${(data.segmentation_summary || {}).segments_count || 0} segments</p></div></div>`;

    // --- Liens rapides vers écrans détaillés EXISTANTS ---
    linksBox.innerHTML = `
      <div class="dashboard-links-row">
        <button class="btn btn-secondary btn-sm" onclick="switchToTab('sales')"><span aria-label="CA">💰 CA détaillé</span></button>
        <button class="btn btn-secondary btn-sm" onclick="switchToTab('ingredients')"><span aria-label="Stock">🌾 Stock détaillé</span></button>
        <button class="btn btn-secondary btn-sm" onclick="switchToTab('forecast')"><span aria-label="Forecast">🔮 Prévision complète</span></button>
        <button class="btn btn-secondary btn-sm" onclick="switchToTab('segmentation')"><span aria-label="Segmentation">📊 Segmentation complète</span></button>
      </div>`;

    // Bind export + refresh (safe to re-bind since handler is idempotent via off/on)
    bindDashboardActions();
  } catch (err) {
    console.error('Dashboard load error:', err);
    summaryBox.innerHTML = '<p class="error">Impossible de charger le dashboard.</p>';
  }
}

// Sprint 5 — Export Excel : uses the SAME object rendered on screen (cache snapshot),
// so exported numbers are identical to what the user sees (constraint 2).
function exportDashboardToExcel() {
  const data = __dashboardSummaryCache;
  if (!data || !window.XLSX) {
    showToast('Aucune donnée à exporter ou lib XLSX indisponible.', true);
    return;
  }
  const wb = XLSX.utils.book_new();
  // Sheet 1 – Core KPIs
  const kpiRows = [
    { Indicateur: 'Chiffre d\'affaires (CA)', Valeur: Number(data.kpis.revenue || 0).toFixed(2) + ' DT' },
    { Indicateur: 'Stock critique', Valeur: data.kpis.critical_stock_count || 0 }
  ];
  (data.kpis.top_products || []).forEach((p, i) => {
    kpiRows.push({ Indicateur: `Top produit #${i + 1}`, Valeur: `${p.name} (${p.units_sold || 0} u)` });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'KPIs');

  // Sheet 2 – AI summary
  const fc = data.forecast_summary || {};
  const seg = data.segmentation_summary || {};
  const iaRows = [
    { Section: 'Forecast', Produit: fc.product_name || '—', Prévision: Number(fc.forecast_next || 0).toFixed(1), Horizon: `${fc.horizon_days || 7} j` },
    { Section: 'Anomalies', Compteur: data.active_anomalies_count || 0 },
    { Section: 'Segmentation', Segments: seg.segments_count || 0 }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(iaRows), 'Résumé IA');

  XLSX.writeFile(wb, 'dashboard-admin.xlsx');
  showToast('Export Excel généré (chiffres identiques à l\'écran).');
}

// Bind export + refresh buttons to the admin dashboard section
function bindDashboardActions() {
  const exportBtn = document.getElementById('export-dashboard-btn');
  const refreshBtn = document.getElementById('refresh-dashboard-btn');
  if (exportBtn) exportBtn.onclick = () => exportDashboardToExcel();
  if (refreshBtn) refreshBtn.onclick = () => loadAdminDashboard();
}

// ===== AI anomalies -> EXISTING dashboard notification system (Sprint 3, Prompt 3) =====
// Reuses WITHOUT duplicating:
//   - the header #alerts-summary-badge / .alert-pill component (dashboard alerts panel)
//   - the showToast() helper already used by the Commandes module for notifications
//   - the switchToTab() navigation (same mechanism as the nav tabs)
//   - the existing same-origin /ai proxy fetch pattern (aiUrl + Authorization header)

const ANOMALY_TYPE_LABELS = {
  sales_drop: 'Baisse de ventes',
  stock_discrepancy: 'Écart de stock'
};

const ANOMALY_SEVERITY_LABELS = {
  haute: '🔴 haute',
  moyenne: '🟠 moyenne',
  faible: '🟡 faible'
};

function anomalyProductName(productId) {
  const product = productsList.find((p) => Number(p.id) === Number(productId));
  return product ? product.name : `Produit #${productId}`;
}

// Direct link to the concerned screen (product / stock), role-aware.
function openConcernedScreen(type, productId) {
  const role = getRole();
  let targetTab = 'ingredients'; // stock screen
  if (type === 'sales_drop') {
    // Product screen: catalog when the role can open it, otherwise the AI
    // forecast screen (product-centric, accessible to every role allowed to
    // view anomalies: ADMIN and STOCK both have the forecast tab).
    targetTab = role && ROLE_TABS[role] && ROLE_TABS[role].includes('catalog') ? 'catalog' : 'forecast';
  }
  switchToTab(targetTab);

  if (targetTab === 'forecast' && productId) {
    const forecastSelect = document.getElementById('forecast-product-select');
    if (forecastSelect) {
      forecastSelect.value = String(productId);
      loadForecast();
    }
  } else if (targetTab === 'catalog' && productId) {
    const searchBox = document.getElementById('search-products');
    if (searchBox) {
      searchBox.value = anomalyProductName(productId);
      renderProducts();
    }
  }
  // Reuse the Commandes toast notification helper.
  showToast(`Anomalie ${ANOMALY_TYPE_LABELS[type] || type} — ${anomalyProductName(productId)}.`, false);
}

// Loads the active AI anomalies via the existing same-origin /ai proxy.
async function loadAnomalies() {
  const badge = document.getElementById('badge-anomalies');
  const panel = document.getElementById('anomalies-panel');
  if (!badge || !panel) return;

  // Mirror the backend RBAC (ADMIN / STOCK only). The backend stays the single
  // source of truth (401/403 are still enforced server-side).
  if (!authToken || !hasAnyRole('ADMIN', 'STOCK')) {
    badge.classList.add('hidden');
    panel.classList.add('hidden');
    __aiAnomalies = [];
    refreshNotifications();
    updateAlertsBadgeVisibility();
    return;
  }

  const headers = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  try {
    const res = await fetch(aiUrl('/anomalies'), { headers });
    if (res.status === 401 || res.status === 403) {
      badge.classList.add('hidden');
      panel.classList.add('hidden');
      __aiAnomalies = [];
      refreshNotifications();
      updateAlertsBadgeVisibility();
      return;
    }
    if (!res.ok) throw new Error(`Erreur anomalies ${res.status}`);

    const data = await res.json();
    const anomalies = Array.isArray(data.anomalies) ? data.anomalies : [];
    __aiAnomalies = anomalies;
    refreshNotifications();
    renderAnomalies(badge, panel, anomalies);
  } catch (err) {
    console.error('Erreur chargement anomalies:', err);
    badge.classList.add('hidden');
    panel.classList.add('hidden');
    updateAlertsBadgeVisibility();
  }
}

function renderAnomalies(badge, panel, anomalies) {
  if (!anomalies.length) {
    badge.classList.add('hidden');
    panel.classList.add('hidden');
    updateAlertsBadgeVisibility();
    return;
  }

  // Reuse the existing dashboard alert-pill component.
  badge.textContent = `⚠️ ${anomalies.length} Anomalie${anomalies.length > 1 ? 's' : ''} IA`;
  badge.classList.remove('hidden');
  updateAlertsBadgeVisibility();

  panel.innerHTML = `
    <div class="anomalies-panel-header">
      <strong>⚠️ Anomalies actives détectées par l'IA</strong>
      <span class="text-muted">${anomalies.length} signalement(s)</span>
    </div>
    <div class="anomalies-list">
      ${anomalies.map((a) => {
        const name = anomalyProductName(a.product_id);
        const typeLabel = ANOMALY_TYPE_LABELS[a.type] || a.type;
        const sevLabel = ANOMALY_SEVERITY_LABELS[a.severity] || a.severity;
        const detail = a.confidence && a.confidence.detail ? a.confidence.detail : '';
        return `
          <div class="anomaly-item">
            <div>
              <strong>${name}</strong>
              <span class="text-muted"> · ${typeLabel} · ${sevLabel}</span>
              <p class="text-muted" style="margin-top:2px;">${detail}</p>
            </div>
            <a href="#" class="btn btn-secondary btn-sm"
               onclick="openConcernedScreen('${a.type}', ${a.product_id}); return false;">Voir l'écran →</a>
          </div>`;
      }).join('')}
    </div>`;
  panel.classList.remove('hidden');

  // Reuse the Commandes toast notification helper.
  showToast(`⚠️ ${anomalies.length} anomalie(s) active(s) détectée(s) par l'IA.`, false);
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

let currentProfile = null;
let currentHours = null;

async function fetchProfile() {
  if (!authToken) return;
  try {
    currentProfile = await safeFetchJson(`${API_BASE}/employees/profile`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderProfile();
  } catch (err) {
    console.warn('Erreur chargement profil:', err);
  }
}

async function fetchHours() {
  if (!authToken) return;
  try {
    currentHours = await safeFetchJson(`${API_BASE}/employees/hours`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    renderHours();
    if (currentProfile) renderProfile(); // rafraîchit les cartes KPI du profil dès que les heures sont disponibles
  } catch (err) {
    console.warn('Erreur chargement heures:', err);
  }
}

function renderProfile() {
  const container = document.getElementById('profile-content');
  if (!container || !currentProfile) return;
  const p = currentProfile;

  // Avatar with role badge
  const roleBadge = ['ADMIN', 'PRODUCTION', 'STOCK', 'CASHIER'].includes(p.user_role) ? p.user_role : 'EMPLOYEE';
  const avatarClass = `avatar role-${roleBadge.toLowerCase()}`;
  const userInitial = (p.user_name || 'U').trim().charAt(0).toUpperCase() || 'U';

  // ── Cartes KPI (refonte ERP) ──────────────────────────────────────
  // Réutilisation stricte des données déjà disponibles : on privilégie les
  // champs du profil (currentProfile), sinon on dérive de currentHours déjà
  // chargé (plannings du mois courant + congés en attente). Aucune nouvelle
  // API, aucun calcul serveur supplémentaire — uniquement de l'agrégation UI.
  const monthPrefix = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };
  const monthHoursFromSchedules = () =>
    currentHours && Array.isArray(currentHours.schedules)
      ? currentHours.schedules
          .filter((s) => s.shift_start && String(s.shift_start).startsWith(monthPrefix()))
          .reduce((acc, s) => acc + (Number(s.hours) || 0), 0)
      : null;
  const pendingLeavesFromHours = () =>
    currentHours && Array.isArray(currentHours.leaves)
      ? currentHours.leaves.filter((l) => l.status === 'PENDING').length
      : null;

  const monthlyHours = p.monthly_hours !== undefined ? p.monthly_hours : monthHoursFromSchedules();
  const leaveBalance = p.leave_balance !== undefined ? p.leave_balance : null;
  const pendingLeaves = p.pending_leaves !== undefined ? p.pending_leaves : pendingLeavesFromHours();

  const monthlyHoursText = monthlyHours !== null && monthlyHours !== undefined ? Number(monthlyHours).toFixed(1) : '—';
  const leaveBalanceText = leaveBalance !== null && leaveBalance !== undefined ? leaveBalance : '—';
  const pendingLeavesText = pendingLeaves !== null && pendingLeaves !== undefined ? pendingLeaves : '—';

  container.innerHTML = `
    <div class="profile-header">
      <div class="avatar-wrapper">
        <div class="avatar ${avatarClass}">
          ${userInitial}
        </div>
        <span class="role-badge ${roleBadge.toLowerCase()}">${roleBadge}</span>
      </div>
      <div class="profile-info">
        <h2>${p.user_name || 'Utilisateur'}</h2>
        <p class="profile-email">${p.user_email || ''}</p>
      </div>
    </div>

    <div class="profile-actions">
      <button class="btn btn-secondary btn-sm" onclick="openChangePasswordModal()">🔐 Modifier mon mot de passe</button>
      <button class="btn btn-primary btn-sm" onclick="openEditProfileModal()">👤 Modifier mes informations</button>
    </div>

    <div class="profile-cards">
      <div class="profile-card">
        <div class="card-header">
          <span class="card-icon">⏱️</span>
          <span class="card-title">Heures du mois</span>
        </div>
        <div class="card-value" id="monthly-hours-value">${monthlyHoursText}</div>
        <div class="card-label">heures</div>
      </div>
      <div class="profile-card">
        <div class="card-header">
          <span class="card-icon">📅</span>
          <span class="card-title">Congés restants</span>
        </div>
        <div class="card-value" id="leave-balance-value">${leaveBalanceText}</div>
        <div class="card-label">jours</div>
      </div>
      <div class="profile-card">
        <div class="card-header">
          <span class="card-icon">⏳</span>
          <span class="card-title">Demandes en attente</span>
        </div>
        <div class="card-value" id="pending-leaves-value">${pendingLeavesText}</div>
        <div class="card-label">en cours</div>
      </div>
    </div>

    <div class="profile-details">
      <div class="profile-detail-row">
        <label>Nom complet</label>
        <span>${p.user_name || 'Non spécifié'}</span>
      </div>
      <div class="profile-detail-row">
        <label>Email</label>
        <span>${p.user_email || 'Non spécifié'}</span>
      </div>
      <div class="profile-detail-row">
        <label>Téléphone</label>
        <span>${p.phone || 'Non spécifié'}</span>
      </div>
      <div class="profile-detail-row">
        <label>Poste</label>
        <span>${p.job_title || 'Non spécifié'}</span>
      </div>
      <div class="profile-detail-row">
        <label>Rôle</label>
        <span>${p.user_role || 'Non spécifié'}</span>
      </div>
      <div class="profile-detail-row">
        <label>Date d'embauche</label>
        <span>${p.hire_date || 'Non spécifié'}</span>
      </div>
      <div class="profile-detail-row">
        <label>Adresse</label>
        <span>${p.address || 'Non spécifié'}</span>
      </div>
    </div>
  `;
}

// ── Boutons d'action de la fiche « Mon Profil » (refonte ERP) ──────────
// Aucune API backend dédiée n'existe encore pour le changement de mot de
// passe ou l'auto-édition du profil (auth.js n'expose que le login ;
// employees.js ne gère le CRUD employé que pour ADMIN). On conserve des
// boutons informatifs au lieu d'appeler un endpoint inexistant — conforme
// aux contraintes : « aucun changement backend / aucune nouvelle API /
// modifications minimales ».
// Ouvre la modale de changement de mot de passe (self-service).
// La route PUT /api/employees/me/password (protégée par requireAuth) ne
// modifie QUE le mot de passe de l'utilisateur authentifié (req.user.id) —
// un id fourni dans le body serait ignoré côté serveur.
function openChangePasswordModal() {
  const modal = document.getElementById('change-password-modal');
  if (!modal) {
    showToast('Modal de changement de mot de passe introuvable.', true);
    return;
  }
  // Réinitialise les champs à chaque ouverture
  document.getElementById('cp-current-password').value = '';
  document.getElementById('cp-new-password').value = '';
  modal.classList.remove('hidden');
  document.getElementById('cp-current-password').focus();
}

// Soumission du formulaire de changement de mot de passe.
async function submitChangePassword() {
  const currentPassword = document.getElementById('cp-current-password').value;
  const newPassword = document.getElementById('cp-new-password').value;

  if (!currentPassword) {
    showToast('Veuillez saisir votre mot de passe actuel.', true);
    return;
  }
  if (newPassword.length < 8) {
    showToast('Le nouveau mot de passe doit contenir au moins 8 caractères.', true);
    return;
  }
  if (newPassword === currentPassword) {
    showToast('Le nouveau mot de passe doit être différent du mot de passe actuel.', true);
    return;
  }
  if (!authToken) {
    showToast('Veuillez vous connecter.', true);
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/employees/me/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    if (res.status === 204) {
      closeModal('change-password-modal');
      showToast('Mot de passe modifié avec succès.');
      return;
    }

    let message = `Erreur lors du changement de mot de passe (HTTP ${res.status}).`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch (_) { /* le corps n'est pas du JSON exploitable */ }

    if (res.status === 401) {
      showToast('Mot de passe actuel incorrect.', true);
    } else if (res.status === 400) {
      showToast(message, true);
    } else {
      showToast(message, true);
    }
  } catch (err) {
    showToast('Impossible de contacter le serveur.', true);
  }
}

// Ouvre la modale « Modifier mes informations » (self-service).
// Seuls phone / address sont éditables ; l'employé est résolu côté serveur par
// req.user.id uniquement — aucun id n'est envoyé depuis le client.
function openEditProfileModal() {
  if (!authToken) return showToast('Veuillez vous connecter.', true);
  const modal = document.getElementById('edit-profile-modal');
  if (!modal) {
    showToast('Modal de modification du profil introuvable.', true);
    return;
  }
  // Pré-remplissage avec les valeurs actuelles du profil chargé.
  const p = currentProfile || {};
  document.getElementById('edit-profile-phone').value = p.phone || '';
  document.getElementById('edit-profile-address').value = p.address || '';
  modal.classList.remove('hidden');
}

// Envoie la mise à jour self-service du profil (phone / address).
// Réutilise fetchProfile() (existant) pour rafraîchir l'affichage — pas de
// second mécanisme de fetch.
async function handleSaveEditProfile(e) {
  e.preventDefault();
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const phone = document.getElementById('edit-profile-phone').value.trim();
  const address = document.getElementById('edit-profile-address').value.trim();

  if (!phone && !address) {
    return showToast('Saisissez au moins une information à modifier.', true);
  }

  // Seuls ces deux champs whitelistés sont transmis au backend.
  const payload = {};
  if (phone) payload.phone = phone;
  if (address) payload.address = address;

  try {
    await safeFetchJson(`${API_BASE}/employees/me/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(payload)
    });

    showToast('Informations mises à jour');
    closeModal('edit-profile-modal');
    await fetchProfile();
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderHours() {
  const container = document.getElementById('hours-content');
  if (!container || !currentHours) return;
  const h = currentHours;
  const scheduleRows = (h.schedules || []).map((s) => {
    const start = s.shift_start ? new Date(s.shift_start).toLocaleString('fr-FR') : '—';
    const end = s.shift_end ? new Date(s.shift_end).toLocaleString('fr-FR') : '—';
    const hours = (s.hours || 0).toFixed(1);
    return `<tr><td>${start}</td><td>${end}</td><td>${hours} h</td><td>${s.notes || '—'}</td></tr>`;
  }).join('');

  const leaveRows = (h.leaves || []).map((l) => {
    return `<tr><td>${l.start_date || '—'}</td><td>${l.end_date || '—'}</td><td>${l.status || '—'}</td><td>${l.reason || '—'}</td></tr>`;
  }).join('');

  container.innerHTML = `
    <div class="hours-summary">
      <h3>Total heures travaillées</h3>
      <p class="hours-total">${h.total_hours.toFixed(1)} h</p>
    </div>
    <h4>Planning</h4>
    <table class="hours-table"><thead><tr><th>Début</th><th>Fin</th><th>Heures</th><th>Notes</th></tr></thead><tbody>${scheduleRows || '<tr><td colspan="4">Aucun planning.</td></tr>'}</tbody></table>
    <h4>Congés</h4>
    <table class="hours-table"><thead><tr><th>Début</th><th>Fin</th><th>Statut</th><th>Motif</th></tr></thead><tbody>${leaveRows || '<tr><td colspan="4">Aucun congé.</td></tr>'}</tbody></table>`;
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
  if (!requireRoleFor('ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE')) return;
  if (!employeesList || employeesList.length === 0) {
    showToast('Chargez d’abord les employés.', true);
    return;
  }
  populateEmployeeSelects();
  document.getElementById('leave-form').reset();
    // Non-ADMIN: the employee selector is hidden for this role, so pre-select their
  // own profile. This both satisfies the field's `required` constraint (otherwise
  // native HTML5 validation silently blocks form submission) and guarantees the
  // request is created in the employee's own name.
  if (!hasAnyRole('ADMIN')) {
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

  // En CRÉATION, le mot de passe est obligatoire (min 8) : sans lui, aucun compte
  // de connexion utilisable ne serait créé dans `users` (le login ne lit que cette
  // table + password_hash bcrypt). On bloque la soumission côté client AVANT
  // d'atteindre la route — même si le required HTML était contourné.
  if (!id && (!password || password.length < 8)) {
    return showToast('Un mot de passe de 8 caractères minimum est requis à la création.', true);
  }

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
  if (!requireRoleFor('ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE')) return;
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  let employeeId = parseInt(document.getElementById('leave-employee-select').value, 10);
  let status = document.getElementById('leave-status').value;

    // Non-ADMIN always submits a leave request in their own name, forced to PENDING.
  if (!hasAnyRole('ADMIN')) {
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

// Ouvre la modale self-service « Demander un congé » (écran Mes Heures).
// L'employé est résolu côté serveur par req.user.id uniquement — aucun
// employee_id n'est envoyé depuis le client.
function openMyLeaveModal() {
  if (!authToken) return showToast('Veuillez vous connecter.', true);
  const modal = document.getElementById('my-leave-modal');
  if (!modal) {
    showToast('Modal de demande de congé introuvable.', true);
    return;
  }
  document.getElementById('my-leave-form').reset();
  modal.classList.remove('hidden');
}

// Envoie la demande de congé self-service.
// Réutilise fetchHours() (existant) pour rafraîchir la liste des congés — pas de
// second mécanisme de fetch.
async function handleSaveMyLeave(e) {
  e.preventDefault();
  if (!authToken) return showToast('Veuillez vous connecter.', true);

  const startValue = document.getElementById('my-leave-start').value;
  const endValue = document.getElementById('my-leave-end').value;
  const reason = document.getElementById('my-leave-reason').value.trim() || null;

  if (!startValue || !endValue) {
    return showToast('Les dates de début et de fin sont requises.', true);
  }

  // Validation UI minimale — le backend revalide aussi.
  const start = new Date(`${startValue}T00:00:00`);
  const end = new Date(`${endValue}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start > end) {
    return showToast('La date de début doit être antérieure ou égale à la date de fin.', true);
  }
  if (start < today) {
    return showToast('La date de début ne peut pas être dans le passé.', true);
  }

  try {
    await safeFetchJson(`${API_BASE}/employees/leaves/me`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ start_date: startValue, end_date: endValue, reason })
    });

    showToast('Demande de congé envoyée');
    closeModal('my-leave-modal');
    await fetchHours();
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
          <span class="price-tag">${parseFloat(product.price).toFixed(2)} DT</span>
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

  loadProductionRecommendation();

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

// ---- Production recommendation integration (Phase 4 / AI) ----

function productionConfidenceLabel(level) {
  return { haute: 'élevée', moyenne: 'moyenne', faible: 'faible' }[level] || level || '—';
}

// Applies the recommended quantity to the batch field (one-click, no re-entry).
function applyProductionRecommendation(qty) {
  const qtyInput = document.getElementById('prod-quantity');
  if (qtyInput) qtyInput.value = Math.max(1, Math.round(qty));
  showToast('Quantité recommandée appliquée. Vérifiez puis lancez la fabrication.');
}

// Renders the recommendation inside the production-declaration form.
function renderProductionRecommendation(box, data) {
  if (data.status === 'insufficient_data') {
    box.innerHTML = `
      <div style="background: rgba(245,158,11,0.12); border:1px solid var(--accent-orange); padding:12px; border-radius:10px;">
        <strong>⚠️ Historique insuffisant</strong>
        <p style="margin-top:6px;">Pas encore assez de ventes passées sur ce produit pour proposer une recommandation fiable.
        Décision manuelle requise : saisissez la quantité du lot ci-dessus.</p>
      </div>`;
    return;
  }
  if (data.status === 'manual_review_required') {
    box.innerHTML = `
      <div style="background: rgba(245,158,11,0.12); border:1px solid var(--accent-orange); padding:12px; border-radius:10px;">
        <strong>⚠️ Recommandation indisponible</strong>
        <p style="margin-top:6px;">Certaines données sont incomplètes (ex. stock non renseigné).
        Décision manuelle requise : saisissez la quantité vous-même.</p>
      </div>`;
    return;
  }

  const rec = Number(data.recommended_quantity);
  const level = productionConfidenceLabel(data.confidence && data.confidence.level);
  const interval = data.confidence && Array.isArray(data.confidence.interval) ? data.confidence.interval : null;
  const intervalTxt = interval ? ` — fourchette de prévision ${interval[0]} à ${interval[1]} unités` : '';
  const recDisplay = Number.isFinite(rec) ? `${rec} unités` : '—';

  let actionHtml = '';
  if (Number.isFinite(rec) && rec >= 1) {
    actionHtml = `<button type="button" class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="applyProductionRecommendation(${rec})">⚡ Utiliser cette quantité</button>`;
  } else {
    actionHtml = `<p style="margin-top:6px; font-size:0.85rem; color:var(--text-secondary);">
      Le stock actuel couvre déjà la demande — production supplémentaire non nécessaire.
      Vous pouvez saisir une quantité manuelle dans le champ ci-dessus.</p>`;
  }

  box.innerHTML = `
    <div style="background: rgba(16,185,129,0.12); border:1px solid var(--accent-green); padding:12px; border-radius:10px;">
      <strong>💡 Quantité recommandée : ${recDisplay}</strong>
      <p style="margin-top:4px;">Confiance : ${level}${intervalTxt}</p>
      ${actionHtml}
    </div>`;
}

// Fetches the production recommendation for the selected product (role-gated).
async function loadProductionRecommendation() {
  const box = document.getElementById('prod-recommendation-box');
  if (!box) return;

  const productId = document.getElementById('prod-product-select').value;
  // Role protection via the existing helper (ADMIN / PRODUCTION only).
  if (!hasAnyRole('ADMIN', 'PRODUCTION')) {
    box.innerHTML = '<p class="text-muted">Recommandation réservée aux rôles ADMIN / Production.</p>';
    return;
  }
  if (!productId) {
    box.innerHTML = '<p class="text-muted">Sélectionnez un produit pour voir la quantité recommandée.</p>';
    return;
  }

  box.innerHTML = '<p class="text-muted">Chargement de la recommandation…</p>';
  const headers = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  try {
    const res = await fetch(aiUrl(`/production-recommendations?product_id=${productId}&horizon_days=7`), { headers });
    if (res.status === 401 || res.status === 403) {
      box.innerHTML = '<p class="text-muted">Recommandation non disponible (accès refusé pour votre rôle).</p>';
      return;
    }
    if (!res.ok) throw new Error(`Erreur ${res.status}`);
    const data = await res.json();
    renderProductionRecommendation(box, data);
  } catch (err) {
    console.error('Production recommendation error:', err);
    box.innerHTML = '<p class="text-muted">Recommandation momentanément indisponible — la saisie manuelle reste possible.</p>';
  }
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
      <td>${parseFloat(ing.cost_per_unit || 0).toFixed(2)} DT</td>
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
      <td><strong>${parseFloat(po.total_cost || 0).toFixed(2)} DT</strong></td>
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
    optionsHtml += `<option value="${ing.id}" data-cost="${cost}" ${sel}>${ing.name} (${ing.unit}) — Ref cost: ${parseFloat(cost).toFixed(2)} DT</option>`;
  });

  row.innerHTML = `
    <select class="form-control po-ing-select" style="flex: 2;" required>${optionsHtml}</select>
    <input type="number" step="0.001" min="0.001" class="form-control po-qty-input" placeholder="Qté" value="${quantityOrdered}" style="flex: 1;" required>
    <input type="number" step="0.01" min="0" class="form-control po-cost-input" placeholder="Coût Unitaire (DT)" value="${unitCost}" style="flex: 1;" required>
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
  if (summaryEl) summaryEl.textContent = `${total.toFixed(2)} DT`;
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
        <p>Total Coût: <strong>${parseFloat(po.total_cost || 0).toFixed(2)} DT</strong></p>
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
              <td>${parseFloat(it.unit_cost).toFixed(2)} DT</td>
              <td><strong>${(parseFloat(it.quantity_ordered) * parseFloat(it.unit_cost)).toFixed(2)} DT</strong></td>
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
      <td><strong>${parseFloat(co.total_price || 0).toFixed(2)} DT</strong></td>
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
    optionsHtml += `<option value="${prod.id}" data-price="${price}" ${sel}>${prod.name} — ${parseFloat(price).toFixed(2)} DT</option>`;
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
  if (summaryEl) summaryEl.textContent = `${total.toFixed(2)} DT`;
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
        <p>Total Prix: <strong>${parseFloat(co.total_price || 0).toFixed(2)} DT</strong></p>
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
              <td>${parseFloat(it.unit_price).toFixed(2)} DT</td>
              <td><strong>${parseFloat(it.subtotal).toFixed(2)} DT</strong></td>
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


// ================================================================
// NOTIFICATION CENTER (2026 UI/UX) — agrégateur client, aucune
// modification de logique métier. Sources = endpoints existants :
// /api/stocks/alerts (stock + péremption), /ai/anomalies (IA),
// commandes déjà chargées en mémoire, et une entrée système.
// ================================================================
const NOTIF_CATEGORY_LABELS = {
  stock: 'Stock critique',
  expiry: 'Péremptions',
  orders: 'Commandes',
  ia: 'IA',
  rh: 'RH',
  profile: 'Profil',
  schedule: 'Planning',
  leave: 'Congés',
  system: 'Système'
};

// Filter chips shown in the panel — ordered and RBAC-gated: a role only ever sees
// the categories for which it holds at least one permission. 'system' (session
// info) stays visible for every authenticated role.
const NOTIF_CATEGORY_ORDER = ['stock', 'expiry', 'orders', 'ia', 'rh', 'system'];
const NOTIF_CATEGORY_PERMISSIONS = {
  stock: ['view_stock_alerts'],
  expiry: ['view_stock_alerts'],
  orders: ['view_purchase_orders', 'view_customer_orders'],
  ia: ['view_ai_anomalies'],
  rh: ['view_profile', 'view_schedule', 'view_leave', 'view_hours'],
  system: []
};
function notifCategoryAccessible(category) {
  const perms = NOTIF_CATEGORY_PERMISSIONS[category];
  if (!perms) return true;
  if (perms.length === 0) return true; // system — informational for everyone
  return perms.some((p) => can(p));
}

const NOTIF_READ_KEY = 'bakery_notif_read_v2';

let __notifications = [];
let __notifFilter = 'all';
let __stockAlerts = null;
let __aiAnomalies = [];
let __serverNotifications = []; // RBAC-filtered server notifications (GET /api/notifications)
let __notifFetching = false;    // re-entrancy guard for fetchServerNotifications
let __notifRead = new Set(JSON.parse(localStorage.getItem(NOTIF_READ_KEY) || '[]'));

function __persistNotifRead() {
  try { localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(Array.from(__notifRead))); } catch (e) { /* ignore */ }
}

function collectNotifications() {
  const list = [];
  const role = getRole();

  // --- Server notifications (already RBAC-filtered at DB level) ---
  (__serverNotifications || []).forEach((n) => {
    list.push({
      id: 'srv:' + n.id,
      category: n.category || 'system',
      title: n.title,
      message: n.message || '',
      priority: n.priority || 'Information',
      date: new Date(n.created_at || n.date || Date.now()),
      tab: n.target_tab || null,
      is_read: n.is_read || false,
    });
  });

  // --- Stock critique (ADMIN + STOCK only) ---
  if (can('view_stock_alerts')) {
    const lowStock = (__stockAlerts && Array.isArray(__stockAlerts.low_stock)) ? __stockAlerts.low_stock : [];
    lowStock.forEach((ing) => {
      list.push({
        id: 'stock:' + ing.id,
        category: 'stock',
        title: 'Stock faible \u2014 ' + (ing.name || ('Ingr\u00e9dient #' + ing.id)),
        message: 'Niveau actuel ' + ing.current_stock + ' ' + (ing.unit || '') + ' (minimum ' + ing.minimum_stock + ').',
        priority: 'Critique',
        date: new Date(),
        tab: 'ingredients'
      });
    });
  }

  // --- Peremptions (ADMIN + STOCK only) ---
  if (can('view_stock_alerts')) {
    const expiring = (__stockAlerts && Array.isArray(__stockAlerts.expiring_soon)) ? __stockAlerts.expiring_soon : [];
    expiring.forEach((ing) => {
      list.push({
        id: 'expiry:' + ing.id,
        category: 'expiry',
        title: 'Peremption proche \u2014 ' + (ing.name || ('Ingr\u00e9dient #' + ing.id)),
        message: 'Expire le ' + (ing.expiration_date || 'sous peu') + '.',
        priority: 'Important',
        date: new Date(),
        tab: 'ingredients'
      });
    });
  }

  // --- IA anomalies (ADMIN + STOCK only) ---
  if (can('view_ai_anomalies')) {
    __aiAnomalies.forEach((a) => {
      const name = anomalyProductName(a.product_id);
      const typeLabel = ANOMALY_TYPE_LABELS[a.type] || a.type;
      const detail = (a.confidence && a.confidence.detail) ? a.confidence.detail : typeLabel;
      list.push({
        id: 'ia:' + a.product_id + ':' + a.type,
        category: 'ia',
        title: 'Anomalie IA \u2014 ' + name,
        message: detail,
        priority: a.severity === 'haute' ? 'Critique' : 'Important',
        date: new Date(),
        tab: 'dashboard'
      });
    });
  }

  // --- Commandes fournisseur (ADMIN + STOCK + PRODUCTION only) ---
  if (can('view_purchase_orders')) {
    (purchaseOrdersList || []).forEach((po) => {
      if (po && po.status && po.status !== 'RECEIVED' && po.status !== 'CANCELLED') {
        list.push({
          id: 'orders:po:' + po.id,
          category: 'orders',
          title: 'Commande fournisseur #' + po.id,
          message: 'Statut : ' + po.status + '.',
          priority: 'Important',
          date: new Date(),
          tab: 'purchase-orders'
        });
      }
    });
  }

  // --- Commandes client (ADMIN + CASHIER + PRODUCTION only) ---
  if (can('view_customer_orders')) {
    (customerOrdersList || []).forEach((co) => {
      if (co && co.status && co.status !== 'DELIVERED' && co.status !== 'CANCELLED') {
        list.push({
          id: 'orders:co:' + co.id,
          category: 'orders',
          title: 'Commande client #' + co.id,
          message: 'Statut : ' + co.status + '.',
          priority: 'Important',
          date: new Date(),
          tab: 'customer-orders'
        });
      }
    });
  }

  // --- System (informational -- all authenticated roles) ---
  const statusEl = document.getElementById('api-status');
  list.push({
    id: 'system:session',
    category: 'system',
    title: 'Session',
    message: currentUser
      ? (currentUser.name + ' (' + currentUser.role + ') \u2014 ' + (statusEl ? statusEl.textContent : ''))
      : 'Non connect\u00e9',
    priority: 'Information',
    date: new Date(),
    tab: null
  });

  return list;
}

function notifUnreadCount() {
  return __notifications.filter((n) => !__notifRead.has(n.id)).length;
}

function updateNotifBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const n = notifUnreadCount();
  badge.textContent = n;
  badge.classList.toggle('hidden', n <= 0);
}

function markAllNotifRead() {
  __notifications.forEach((n) => __notifRead.add(n.id));
  __persistNotifRead();
  renderNotifPanel();
  updateNotifBadge();
}

/**
 * Single delegated click handler for the notification panel (attached once on the
 * stable #notif-panel element in initNotifications). Handles the filter chips,
 * "Tout marquer lu" and the clickable notification items.
 *
 * Event delegation keeps clicks reliable: the previous implementation attached a
 * new listener to every render and re-rendered the panel synchronously inside the
 * click handler, which destroyed the clicked node mid-click ("element detached"),
 * making notifications effectively unclickable.
 */
function handleNotifPanelClick(e) {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;

  // "Tout marquer lu"
  if (e.target.closest('#notif-mark-all')) {
    markAllNotifRead();
    return;
  }

  // Category filter chip
  const filterBtn = e.target.closest('.notif-filter');
  if (filterBtn) {
    __notifFilter = filterBtn.dataset.filter;
    renderNotifPanel();
    return;
  }

  // Notification item -> mark read (instant local feedback) + navigate to its tab
  const item = e.target.closest('.notif-item');
  if (item) {
    const notif = __notifications.find((n) => n.id === item.dataset.id);
    if (!notif) return;

    if (!__notifRead.has(notif.id)) {
      __notifRead.add(notif.id);
      __persistNotifRead();
      item.classList.remove('unread');
      updateNotifBadge();
    }

    if (notif.tab) {
      switchToTab(notif.tab);
      panel.classList.add('hidden');
    }
  }
}

function renderNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;

  // RBAC-driven chips: only the modules the connected role may access appear.
  const visibleCats = ['all'].concat(NOTIF_CATEGORY_ORDER.filter(notifCategoryAccessible));
  if (__notifFilter !== 'all' && !visibleCats.includes(__notifFilter)) {
    __notifFilter = 'all'; // the previously selected category is no longer accessible
  }

  const filtered = __notifFilter === 'all'
    ? __notifications
    : __notifications.filter((n) => n.category === __notifFilter);

  const filters = visibleCats
    .map((c) => `<button class="notif-filter ${__notifFilter === c ? 'active' : ''}" data-filter="${c}">${c === 'all' ? 'Tout' : escapeHtml(NOTIF_CATEGORY_LABELS[c] || c)}</button>`)
    .join('');

  const items = filtered.length
    ? filtered.map((n) => {
        const read = __notifRead.has(n.id);
        const prio = n.priority || 'Information';
        return `
        <div class="notif-item ${read ? '' : 'unread'} prio-${prio}" data-id="${escapeHtml(n.id)}">
          <div class="notif-item-body">
            <div class="notif-item-title">${escapeHtml(n.title)} <span class="notif-prio ${prio}">${escapeHtml(prio)}</span></div>
            <div class="notif-item-msg">${escapeHtml(n.message)}</div>
            <div class="notif-item-meta">
              <span>${escapeHtml(NOTIF_CATEGORY_LABELS[n.category] || n.category)}</span>
              <span>${new Date(n.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>`;
      }).join('')
    : '<div class="notif-empty">Aucune notification dans cette catégorie.</div>';

  panel.innerHTML = `
    <div class="notif-header">
      <strong>🔔 Notifications</strong>
      <div class="notif-header-actions">
        <button class="notif-mark-all" id="notif-mark-all" type="button">Tout marquer lu</button>
      </div>
    </div>
    <div class="notif-filters" id="notif-filters">${filters}</div>
    <div class="notif-list">${items}</div>`;

  // No per-node listeners here — clicks go through the single delegated handler
  // attached once in initNotifications().
}

/**
 * Re-collect + render the local notifications (badge + open panel) WITHOUT any
 * network call. Kept separate from refreshNotifications() so the server fetch can
 * re-render without triggering another fetch — the old recursion
 * (refreshNotifications -> fetchServerNotifications -> refreshNotifications ...)
 * created an infinite re-render loop that rebuilt the panel hundreds of times per
 * second and made every notification click fail ("element detached").
 */
function renderNotificationCenter() {
  __notifications = collectNotifications();
  updateNotifBadge();
  const panel = document.getElementById('notif-panel');
  if (panel && !panel.classList.contains('hidden')) renderNotifPanel();
}

function refreshNotifications() {
  if (authToken) {
    fetchServerNotifications().catch(() => {});
  }
  renderNotificationCenter();
}

async function fetchServerNotifications() {
  if (!authToken) return;
  if (__notifFetching) return; // re-entrancy guard (parallel rounds are pointless)
  __notifFetching = true;
  try {
    __serverNotifications = await safeFetchJson(`${API_BASE}/notifications`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    // Mark server notifications as read/unread based on the stored set
    __serverNotifications.forEach((n) => {
      n.is_read = __notifRead.has('srv:' + n.id);
    });
    renderNotificationCenter();
  } catch (err) {
    // Backend notifications endpoint may not be available in all envs
    console.warn('Erreur chargement notifications serveur:', err);
  } finally {
    __notifFetching = false;
  }
}

function initNotifications() {
  const bell = document.getElementById('notif-bell');
  const panel = document.getElementById('notif-panel');
  // Single delegated listener — survives every innerHTML rebuild of the panel.
  if (panel) panel.addEventListener('click', handleNotifPanelClick);
  if (bell) bell.addEventListener('click', (e) => {
    e.stopPropagation();
    const hidden = panel.classList.toggle('hidden');
    if (!hidden) renderNotifPanel();
  });
  document.addEventListener('pointerdown', (e) => {
    // Outside-click-to-close. Registered on pointerdown (before any click-handler
    // re-render) so e.target is still attached when we test containment — a click
    // listener here would run AFTER renderNotifPanel() replaced the panel DOM on
    // filter/item clicks, making contains() return false on the detached target
    // and closing the panel right after the user opened/used it.
    const wrap = document.getElementById('notif-wrap');
    if (wrap && !wrap.contains(e.target) && panel && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
    }
  });
  refreshNotifications();
}

