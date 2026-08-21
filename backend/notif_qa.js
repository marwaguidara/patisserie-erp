// Playwright QA — notification panel regressions (click-navigation + RBAC filters).
// Usage: node notif_qa.js <baseURL> <ROLE>  (requires the backend server running)
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:5000';
const ROLE = (process.argv[3] || 'ADMIN').toUpperCase();

const EMAILS = {
  ADMIN: 'admin@bakery.com',
  PRODUCTION: 'production@bakery.com',
  CASHIER: 'cashier@bakery.com',
  STOCK: 'stock@bakery.com',
  EMPLOYEE: 'employe@bakery.com'
};

function expectedTabForId(id) {
  if (id.startsWith('stock:') || id.startsWith('expiry:')) return 'ingredients';
  if (id.startsWith('ia:')) return 'dashboard';
  if (id.startsWith('orders:po:')) return 'purchase-orders';
  if (id.startsWith('orders:co:')) return 'customer-orders';
  return null; // srv:/system: target unknown or none
}

async function login(page, email) {
  return page.evaluate(async (creds) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds)
    });
    const data = await res.json();
    if (!data.token) throw new Error('login failed: ' + JSON.stringify(data));
    localStorage.setItem('bakery_jwt', data.token);
    location.reload();
    return data.user.role;
  }, { email, password: 'password123' });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(BASE + '/');
  const role = await login(page, EMAILS[ROLE]);
  await page.waitForFunction(() => {
    const u = document.getElementById('user-profile');
    return u && u.textContent.includes('(');
  }, null, { timeout: 10000 });
  await page.waitForTimeout(1500);

  // Instrument re-render + tab switch counters (function declarations are window properties)
  await page.evaluate(() => {
    window.__renderCount = 0;
    const origRender = window.renderNotifPanel;
    window.renderNotifPanel = function () { window.__renderCount = (window.__renderCount || 0) + 1; return origRender.apply(this, arguments); };
    window.__switchCount = 0;
    const origSwitch = window.switchToTab;
    window.switchToTab = function (tab) { window.__switchCount = (window.__switchCount || 0) + 1; return origSwitch.apply(this, arguments); };
  });

  // Open the notification panel
  await page.click('#notif-bell');
  await page.waitForSelector('#notif-panel:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(4000); // let async refreshes settle

  const filters = await page.$$eval('#notif-panel .notif-filter', (els) => els.map((e) => ({ key: e.dataset.filter, label: e.textContent.trim() })));
  const itemIds = await page.$$eval('#notif-panel .notif-item', (els) => els.map((e) => e.dataset.id));
  const rendersAtOpen = await page.evaluate(() => window.__renderCount || 0);

  // Churn measurement: count additional re-renders over 5s of idle
  await page.waitForTimeout(5000);
  const rendersAfterIdle = await page.evaluate(() => window.__renderCount || 0);

  const roleLabel = await page.evaluate(() => {
    const el = document.getElementById('user-profile');
    return el ? el.textContent.trim() : '';
  });

  // 3) Filter chip delegation check (panel still open)
  const chipKey = ['orders', 'stock', 'expiry', 'ia', 'rh', 'system'].find((c) => filters.some((f) => f.key === c));
  let filterResult = 'no-chip';
  if (chipKey) {
    await page.click(`#notif-panel .notif-filter[data-filter="${chipKey}"]`);
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const active = document.querySelector('#notif-panel .notif-filter.active');
      const items = Array.from(document.querySelectorAll('#notif-panel .notif-item')).map((it) => {
        const meta = it.querySelector('.notif-item-meta span');
        return meta ? meta.textContent.trim() : null;
      });
      return { activeChip: active ? active.dataset.filter : null, itemMeta: items };
    });
    filterResult = { chip: chipKey, ...state };
    await page.click('#notif-panel .notif-filter[data-filter="all"]');
    await page.waitForTimeout(150);
  }

  // 4) Mark-all read button
  const markState = await page.evaluate(() => ({
    before: document.getElementById('notif-badge').textContent,
    readCount: document.getElementById('notif-badge').classList.contains('hidden')
  }));
  await page.click('#notif-panel #notif-mark-all');
  await page.waitForTimeout(200);
  const markAfter = await page.evaluate(() => ({
    after: document.getElementById('notif-badge').textContent,
    hidden: document.getElementById('notif-badge').classList.contains('hidden'),
    unreadItems: document.querySelectorAll('#notif-panel .notif-item.unread').length
  }));

  // 5) Navigational click (re-read fresh item ids after the panel was re-rendered)
  const itemIdsAfter = await page.$$eval('#notif-panel .notif-item', (els) => els.map((e) => e.dataset.id));
  const target = (() => {
    const known = itemIdsAfter.map((id) => ({ id, tab: expectedTabForId(id) })).find((x) => x.tab);
    if (known) return known;
    const srv = itemIdsAfter.find((id) => id.startsWith('srv:'));
    return srv ? { id: srv, tab: 'srv-target' } : null; // target comes from the server
  })();
  let clickResult = 'none-clickable-with-known-target';
  if (target) {
    try {
      await page.click(`#notif-panel .notif-item[data-id="${target.id}"]`, { timeout: 8000 });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => {
        const active = document.querySelector('.tab-content.active');
        const hidden = document.getElementById('notif-panel').classList.contains('hidden');
        return { activeTab: active ? active.id : null, panelHidden: hidden, switchCount: window.__switchCount || 0 };
      });
      clickResult = { id: target.id, expectedTab: target.tab, ...after };
    } catch (e) {
      clickResult = { id: target.id, error: String(e.message).split('\n')[0] };
    }
  } else if (itemIdsAfter.length > 0) {
    clickResult = { note: 'items exist but none had a known navigation target', itemIdsAfter };
  }

  console.log(JSON.stringify({ role, roleLabel, filters, itemIds, rendersAtOpen, rendersAfterIdle, additionalRendersDuringIdle: rendersAfterIdle - rendersAtOpen, filterResult, markState, markAfter, clickResult, pageErrors }, null, 2));
  await browser.close();
}

main().then(() => process.exit(0)).catch((e) => { console.error('SCRIPT FAIL:', e); process.exit(1); });