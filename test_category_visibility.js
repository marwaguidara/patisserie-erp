const fs = require('fs');
const path = require('path');

const ROLE_TABS = {
  ADMIN: ['catalog', 'ingredients', 'production', 'sales', 'employees', 'suppliers', 'categories', 'purchase-orders', 'customer-orders', 'forecast', 'ai-technical', 'segmentation', 'dashboard'],
  STOCK: ['ingredients', 'suppliers', 'purchase-orders', 'forecast'],
  CASHIER: ['sales', 'customer-orders'],
  PRODUCTION: ['catalog', 'ingredients', 'production', 'customer-orders', 'purchase-orders', 'forecast'],
  EMPLOYEE: ['employees']
};

const html = fs.readFileSync(path.join(__dirname, 'frontend', 'index.html'), 'utf-8');
const tabCategoryMap = {};
let currentCategory = null;
for (const line of html.split('\n')) {
  const catMatch = line.match(/<div class="tab-category[^"]*" data-category="([^"]+)"/);
  if (catMatch) currentCategory = catMatch[1];
  const tabMatch = line.match(/<button class="tab-btn[^"]*" data-tab="([^"]+)">/);
  if (tabMatch && currentCategory) tabCategoryMap[tabMatch[1]] = currentCategory;
  if (line.match(/^\s*<\/div>\s*$/) && currentCategory) currentCategory = null;
}

const FORECAST_ALLOWED_ROLES = ['ADMIN', 'PRODUCTION', 'STOCK'];

function simulateVisibility(role) {
  const allowedTabs = (role && ROLE_TABS[role]) ? ROLE_TABS[role] : null;
  const visibleTabs = new Set();
  const hiddenTabs = new Set();
  for (const tabName of Object.keys(tabCategoryMap)) {
    let visible = !allowedTabs || allowedTabs.includes(tabName);
    if (tabName === 'forecast') visible = FORECAST_ALLOWED_ROLES.includes(role);
    (visible ? visibleTabs : hiddenTabs).add(tabName);
  }
  const visibleCats = new Set();
  const hiddenCats = new Set();
  for (const [tab, cat] of Object.entries(tabCategoryMap)) {
    if (visibleTabs.has(tab)) visibleCats.add(cat);
    else if (!visibleCats.has(cat)) hiddenCats.add(cat);
  }
  return { visibleTabs, hiddenTabs, visibleCategories: visibleCats, hiddenCategories: hiddenCats };
}

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL: ' + msg); }
}

console.log('=== TEST 1: All 13 tabs present ===');
const allTabs = Object.keys(tabCategoryMap);
check(allTabs.length === 13, 'Expected 13 tabs, got ' + allTabs.length);
for (const t of ['catalog','ingredients','categories','production','sales','employees','suppliers','purchase-orders','customer-orders','forecast','segmentation','dashboard','ai-technical']) {
  check(allTabs.includes(t), 'Missing tab: ' + t);
}
console.log('  Tabs:', allTabs.length, '->', allTabs.join(', '));
console.log('  Categories:', [...new Set(Object.values(tabCategoryMap))].length);
console.log(pass+'/'+ (pass+fail) + ' checks passed\n');

console.log('=== TEST 2: CASHIER role (non-ADMIN) ===');
const c = simulateVisibility('CASHIER');
check(c.visibleTabs.size === 2, 'CASHIER should see 2 tabs, got ' + c.visibleTabs.size);
check(c.visibleTabs.has('sales'), 'CASHIER should see sales');
check(c.visibleTabs.has('customer-orders'), 'CASHIER should see customer-orders');
check(!c.visibleTabs.has('forecast'), 'CASHIER should NOT see forecast');
check([...c.visibleTabs].join(',') === 'sales,customer-orders', 'Wrong visible tabs: ' + [...c.visibleTabs].join(','));
check(c.visibleCategories.has('operations'), 'CASHIER should see Operations category');
check(c.visibleCategories.has('clients'), 'CASHIER should see Clients category');
check(c.visibleCategories.size === 2, 'CASHIER should see 2 categories, got ' + c.visibleCategories.size);
check(c.hiddenCategories.has('catalogue'), 'Catalogue should be hidden for CASHIER');
check(c.hiddenCategories.has('admin'), 'Admin should be hidden for CASHIER');
console.log('  Visible tabs:', [...c.visibleTabs].join(', '));
console.log('  Visible categories:', [...c.visibleCategories].join(', '));
console.log('  Hidden categories:', [...c.hiddenCategories].join(', '));
console.log(pass+'/'+ (pass+fail) + ' checks passed so far\n');

console.log('=== TEST 3: ADMIN role (all tabs) ===');
const a = simulateVisibility('ADMIN');
check(a.visibleTabs.size === 13, 'ADMIN should see 13 tabs, got ' + a.visibleTabs.size);
check(a.visibleCategories.size === 7, 'ADMIN should see 7 categories, got ' + a.visibleCategories.size);
check(a.visibleCategories.has('admin'), 'ADMIN should see Admin category');
check(a.visibleTabs.has('ai-technical'), 'ADMIN should see ai-technical tab');
console.log('  Visible tabs:', a.visibleTabs.size);
console.log('  Visible categories:', [...a.visibleCategories].join(', '));
console.log(pass+'/'+ (pass+fail) + ' checks passed so far\n');

console.log('=== TEST 4: EMPLOYEE role ===');
const e = simulateVisibility('EMPLOYEE');
check(e.visibleTabs.has('employees'), 'EMPLOYEE should see employees');
check(e.visibleCategories.has('rh'), 'EMPLOYEE should see RH category');
check(e.visibleCategories.size === 1, 'EMPLOYEE should see 1 category, got ' + e.visibleCategories.size);
check(e.hiddenCategories.has('catalogue'), 'EMPLOYEE should NOT see Catalogue');
check(e.hiddenCategories.has('admin'), 'EMPLOYEE should NOT see Admin');
console.log('  Visible tabs:', [...e.visibleTabs].join(', '));
console.log('  Visible categories:', [...e.visibleCategories].join(', '));
console.log(pass+'/'+ (pass+fail) + ' checks passed so far\n');

console.log('=== TEST 5: PRODUCTION role (cross-category) ===');
const p = simulateVisibility('PRODUCTION');
check(p.visibleTabs.has('catalog'), 'PRODUCTION should see catalog');
check(p.visibleTabs.has('forecast'), 'PRODUCTION should see forecast (can view_ai_forecast)');
check(p.visibleTabs.has('customer-orders'), 'PRODUCTION should see customer-orders');
check(p.visibleCategories.has('catalogue'), 'PRODUCTION should see Catalogue');
check(p.visibleCategories.has('operations'), 'PRODUCTION should see Operations');
check(p.visibleCategories.has('clients'), 'PRODUCTION should see Clients');
check(p.visibleCategories.has('ia'), 'PRODUCTION should see IA & Reporting');
console.log('  Visible tabs:', [...p.visibleTabs].join(', '));
console.log('  Visible categories:', [...p.visibleCategories].join(', '));
console.log(pass+'/'+ (pass+fail) + ' checks passed so far\n');

console.log('=== TEST 6: STOCK role ===');
const s = simulateVisibility('STOCK');
check(s.visibleTabs.size === 4, 'STOCK should see 4 tabs, got ' + s.visibleTabs.size);
check(s.visibleCategories.has('catalogue'), 'STOCK should see Catalogue (ingredients)');
check(s.visibleCategories.has('achats'), 'STOCK should see Achats (suppliers, po)');
check(s.visibleCategories.has('ia'), 'STOCK should see IA (forecast)');
console.log('  Visible tabs:', [...s.visibleTabs].join(', '));
console.log('  Visible categories:', [...s.visibleCategories].join(', '));
console.log(pass+'/'+ (pass+fail) + ' checks passed so far\n');

console.log(pass === (pass+fail) ? '=== ALL TESTS PASSED ===' : '=== SOME TESTS FAILED ===');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
