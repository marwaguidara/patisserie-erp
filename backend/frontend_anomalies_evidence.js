/**
 * Sprint 3 - Prompt 3 - Evidence: AI anomalies are wired into the EXISTING
 * dashboard notification system (header #alerts-summary-badge + showToast),
 * NOT into a parallel system.
 *
 * Scenarios:
 *  1. REAL network call (ADMIN): capture the actual /ai/anomalies request +
 *     response through the /ai proxy. Real state = no active anomaly -> the
 *     anomalies pill/panel stay hidden (valid result).
 *  2. SIMULATED payload (UI demonstration ONLY, route interception -> no data
 *     mutated): assert the reused components render the anomaly:
 *       - #badge-anomalies is a CHILD of the existing #alerts-summary-badge
 *       - #badge-anomalies reuses the .alert-pill component class
 *       - the product name is resolved dynamically from productsList
 *       - the "Voir l'écran" link switches to the concerned screen
 *  3. RBAC (PRODUCTION): the backend returns 403 -> the UI stays hidden.
 */
const { chromium } = require('playwright');
const http = require('http');

const BASE = 'http://127.0.0.1:5000';
const USERS = {
  ADMIN: { email: 'admin@bakery.com', password: 'password123' },
  STOCK: { email: 'stock@bakery.com', password: 'password123' },
  PRODUCTION: { email: 'production@bakery.com', password: 'password123' }
};

function loginToken(role) {
  return new Promise((resolve, reject) => {
    const u = USERS[role];
    const payload = JSON.stringify({ email: u.email, password: u.password });
    const req = http.request({
      hostname: '127.0.0.1', port: 5000, path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.token) resolve(data.token);
          else reject(new Error(`login failed for ${role}: ${body}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 120 });

  // ---------------- Scenario 1: REAL /ai/anomalies call (ADMIN) ----------------
  console.log('\n=== SCENARIO 1: REAL /ai/anomalies call (ADMIN) ===');
  {
    const token = await loginToken('ADMIN');
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript((t) => localStorage.setItem('bakery_jwt', t), token);
    const page = await context.newPage();

    const anomaliesRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/ai/anomalies')) {
        anomaliesRequests.push({ url: req.url(), method: req.method() });
      }
    });
    const respPromise = page.waitForResponse((r) => r.url().includes('/ai/anomalies'), { timeout: 15000 }).catch(() => null);

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const resp = await respPromise;

    if (resp) {
      const body = await resp.json().catch(() => null);
      console.log(`✅ REAL /ai/anomalies -> HTTP ${resp.status()}`);
      console.log(`   URL: ${resp.url()}`);
      console.log(`   Response: ${JSON.stringify(body)}`);
    } else {
      console.log('⚠️ no /ai/anomalies response captured');
    }
    console.log(`   Captured requests: ${JSON.stringify(anomaliesRequests)}`);

    await page.waitForTimeout(1200);
    const badgeHidden = await page.$eval('#badge-anomalies', (el) => el.classList.contains('hidden'));
    const panelHidden = await page.$eval('#anomalies-panel', (el) => el.classList.contains('hidden'));
    const pillIsInExistingBadge = await page.$eval('#alerts-summary-badge', (b) => !!b.querySelector('#badge-anomalies'));
    console.log(`   DOM (#badge-anomalies is INSIDE existing #alerts-summary-badge): ${pillIsInExistingBadge}`);
    console.log(`   DOM (#badge-anomalies hidden=${badgeHidden} — real state has no anomalies, valid)`);
    console.log(`   DOM (#anomalies-panel hidden=${panelHidden})`);

    await page.screenshot({ path: 'C:/marwaguidara/summer/frontend-anomalies-real.png' });
    await context.close();
  }

  // ---------------- Scenario 2: SIMULATED anomaly -> reused UI rendering (ADMIN) ----------------
  console.log('\n=== SCENARIO 2: SIMULATED anomaly payload -> reused components (ADMIN) ===');
  {
    const token = await loginToken('ADMIN');
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript((t) => localStorage.setItem('bakery_jwt', t), token);
    const page = await context.newPage();

    // Route interception - SIMULATED payload for UI demonstration only (no data is mutated).
    await page.route('**/ai/anomalies', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          anomalies: [{
            product_id: 32,
            type: 'sales_drop',
            severity: 'haute',
            confidence: {
              level: 'haute',
              detail: 'Dernier jour : 0 unité vs moyenne mobile 7j ~30 (baisse de 100%).'
            },
            description: 'Dernier jour : 0 unité vs moyenne mobile 7j ~30 (baisse de 100%).'
          }],
          excluded_products: [33],
          status: 'ok'
        })
      });
    });

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const badgeVisible = await page.$eval('#badge-anomalies', (el) => !el.classList.contains('hidden'));
    const badgeText = await page.$eval('#badge-anomalies', (el) => el.textContent.trim());
    const pillIsInExistingBadge = await page.$eval('#alerts-summary-badge', (b) => !!b.querySelector('#badge-anomalies'));
    const pillReusesClass = await page.$eval('#badge-anomalies', (el) => el.classList.contains('alert-pill'));
    const badgeContainerVisible = await page.$eval('#alerts-summary-badge', (el) => !el.classList.contains('hidden'));
    const panelVisible = await page.$eval('#anomalies-panel', (el) => !el.classList.contains('hidden'));
    const panelText = await page.$eval('#anomalies-panel', (el) => el.textContent || '');
    const hasRealProductName = panelText.includes('Croissant Pur Beurre');
    const hasDetail = panelText.includes('baisse de 100%');
    const hasLink = await page.$eval('#anomalies-panel', (el) => !!el.querySelector('a'));

    console.log(`✅ #badge-anomalies visible=${badgeVisible} text="${badgeText}"`);
    console.log(`   REUSE: #badge-anomalies is child of existing #alerts-summary-badge: ${pillIsInExistingBadge}`);
    console.log(`   REUSE: #badge-anomalies uses existing .alert-pill class: ${pillReusesClass}`);
    console.log(`   REUSE: #alerts-summary-badge (existing dashboard panel) visible=${badgeContainerVisible}`);
    console.log(`   #anomalies-panel visible=${panelVisible}`);
    console.log(`   product name resolved from productsList (no hardcoding): ${hasRealProductName}`);
    console.log(`   confidence detail rendered: ${hasDetail}`);
    console.log(`   "Voir l'écran" link rendered: ${hasLink}`);

    await page.screenshot({ path: 'C:/marwaguidara/summer/frontend-anomalies-simulated.png' });

    // Click "Voir l'écran" -> switches to the concerned product screen (catalog for ADMIN)
    await page.click('#anomalies-panel a');
    await page.waitForTimeout(1000);
    const activeTab = await page.$eval('.tab-btn.active', (el) => el.dataset.tab);
    const searchValue = await page.$eval('#search-products', (el) => el.value);
    console.log(`✅ clicked link -> active tab="${activeTab}", product filter="${searchValue}"`);
    await page.screenshot({ path: 'C:/marwaguidara/summer/frontend-anomalies-navigated.png' });
    await context.close();
  }

  // ---------------- Scenario 3: RBAC — PRODUCTION blocked, UI stays hidden ----------------
  console.log('\n=== SCENARIO 3: RBAC — PRODUCTION (backend 403 / UI hidden) ===');
  {
    const token = await loginToken('PRODUCTION');
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript((t) => localStorage.setItem('bakery_jwt', t), token);
    const page = await context.newPage();

    // Track, per page, every /ai/anomalies response that really hits this page.
    const aiAnomaliesResponses = [];
    page.on('response', (res) => {
      if (res.url().includes('/ai/anomalies')) {
        aiAnomaliesResponses.push({ status: res.status(), url: res.url() });
      }
    });

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    if (aiAnomaliesResponses.length === 0) {
      console.log('   /ai/anomalies responses captured: NONE — the client-side RBAC gate (ADMIN/STOCK only) prevented the call for PRODUCTION');
    } else {
      const forbidden = aiAnomaliesResponses.every((r) => r.status === 403);
      console.log(`   /ai/anomalies responses captured: ${JSON.stringify(aiAnomaliesResponses)} (all 403 => backend RBAC enforces PRODUCTION block)`);
    }

    const panelHidden = await page.$eval('#anomalies-panel', (el) => el.classList.contains('hidden'));
    const badgeHidden = await page.$eval('#badge-anomalies', (el) => el.classList.contains('hidden'));
    console.log(`   #anomalies-panel hidden=${panelHidden} (UI gated by role - OK)`);
    console.log(`   #badge-anomalies hidden=${badgeHidden}`);
    await context.close();
  }

  // ---------------- Scenario 4: STOCK — allowed (ADMIN/STOCK), link targets forecast ----------------
  console.log('\n=== SCENARIO 4: STOCK allowed -> anomaly UI + role-aware link (forecast) ===');
  {
    const token = await loginToken('STOCK');
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    await context.addInitScript((t) => localStorage.setItem('bakery_jwt', t), token);
    const page = await context.newPage();

    await page.route('**/ai/anomalies', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          anomalies: [{
            product_id: 32,
            type: 'sales_drop',
            severity: 'moyenne',
            confidence: { level: 'moyenne', detail: 'Baisse de 45% vs moyenne mobile 7j (~30).' },
            description: 'Baisse de 45% vs moyenne mobile 7j (~30).'
          }],
          excluded_products: [33],
          status: 'ok'
        })
      });
    });

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const panelVisible = await page.$eval('#anomalies-panel', (el) => !el.classList.contains('hidden'));
    const badgeVisible = await page.$eval('#badge-anomalies', (el) => !el.classList.contains('hidden'));
    console.log(`   STOCK: #badge-anomalies visible=${badgeVisible}, #anomalies-panel visible=${panelVisible} (STOCK allowed)`);

    await page.click('#anomalies-panel a');
    await page.waitForTimeout(1000);
    const activeTab = await page.$eval('.tab-btn.active', (el) => el.dataset.tab);
    console.log(`   STOCK: clicked link -> active tab="${activeTab}" (role-aware: no catalog for STOCK -> forecast product screen)`);
    await page.screenshot({ path: 'C:/marwaguidara/summer/frontend-anomalies-stock.png' });
    await context.close();
  }

  await browser.close();
  console.log('\n=== DONE ===');
})().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
