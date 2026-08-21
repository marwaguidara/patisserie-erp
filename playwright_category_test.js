# placeholder

(async () => {
  const loginResp = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cashier@bakery.com', password: 'password123' })
  });
  const loginData = await loginResp.json();
  const jwt = loginData.token;
  console.log('Logged in:', loginData.user.name, '(' + loginData.user.role + ')');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const pageErrors = [], consoleMessages = [];
  await context.addInitScript({ content: `localStorage.setItem('bakery_jwt', '${jwt}');` });
  const page = await browser.newPage();
  page.on('console', msg => consoleMessages.push(msg.text()));
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.goto('http://localhost:5000/');
  await new Promise(r => setTimeout(r, 3000));
  const debug = await page.evaluate(() => {
    var lm = document.getElementById('login-modal'), ub = document.querySelector('.user-badge');
    return { hasBadge: !!ub, badgeText: ub ? ub.textContent : null };
  });
  console.log('DEBUG:', JSON.stringify(debug));
  if (pageErrors.length) console.log('ERRORS:', pageErrors);
  if (consoleMessages.length) consoleMessages.slice(-10).forEach(m => console.log('CONSOLE:', m));
  await page.screenshot({ path: 'cashier_test.png', fullPage: true });
  if (!debug.hasBadge || !debug.badgeText || !debug.badgeText.includes('CASHIER')) {
    console.log('UI login attempt...');
    await page.click('#login-modal-btn').catch(() => {}); await new Promise(r => setTimeout(r, 1000));
    await page.fill('input[name="email"]', 'cashier@bakery.com').catch(() => {});
    await page.fill('input[name="password"]', 'password123').catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForFunction(() => { var b = document.querySelector('.user-badge'); return b && b.textContent.includes('CASHIER'); }, { timeout: 10000 }).catch(() => console.log('no badge'));
  }
  const results = await page.evaluate(() => {
    var cats = Array.from(document.querySelectorAll('.tab-category'));
    var tabs = Array.from(document.querySelectorAll('.tab-btn'));
    var catInfo = cats.map(c => ({ category: c.getAttribute('data-category'), visible: c.style.display !== 'none', active: c.classList.contains('active'), visibleSubTabs: Array.from(c.querySelectorAll('.tab-btn')).filter(t => t.style.display !== 'none').map(t => t.getAttribute('data-tab')) }));
    var tabInfo = tabs.map(t => ({ tab: t.getAttribute('data-tab'), visible: t.style.display !== 'none' }));
    return { catInfo, tabInfo };
  });
  console.log('=== DOM CHECK: CASHIER ===');
  console.log('Total categories:', results.catInfo.length, '| Total tabs:', results.tabInfo.length);
  results.catInfo.forEach(c => console.log('  ' + c.category + ': visible=' + c.visible + ', active=' + c.active + ', visibleSubTabs=[' + c.visibleSubTabs.join(',') + ']'));
  console.log('Visible tabs:', results.tabInfo.filter(t => t.visible).map(t => t.tab).join(', '));
  var pass = [], fail = [];
  function assert(cond, msg) { if (cond) pass.push(msg); else fail.push('FAIL: ' + msg); }
  var vt = results.tabInfo.filter(t => t.visible).map(t => t.tab);
  assert(vt.length === 2, 'CASHIER sees exactly 2 tabs (sales, customer-orders), got ' + vt.length + ': ' + vt.join(','));
  assert(vt.includes('sales'), 'CASHIER sees sales tab');
  assert(vt.includes('customer-orders'), 'CASHIER sees customer-orders tab');
  assert(!vt.includes('forecast'), 'CASHIER does NOT see forecast');
  assert(!vt.includes('ai-technical'), 'CASHIER does NOT see ai-technical (Admin)');
  var vc = results.catInfo.filter(c => c.visible);
  assert(vc.length === 2, 'CASHIER sees 2 categories (operations, clients), got ' + vc.length);
  assert(vc.some(c => c.category === 'operations'), 'operations category visible');
  assert(vc.some(c => c.category === 'clients'), 'clients category visible');
  assert(!results.catInfo.some(c => c.category === 'admin' && c.visible), 'admin category hidden for CASHIER');
  await page.click('.category-btn[data-category="operations"]'); await new Promise(r => setTimeout(r, 300));
  var ac = await page.evaluate(() => Array.from(document.querySelectorAll('.tab-category')).filter(c => c.classList.contains('active')).map(c => c.getAttribute('data-category')));
  assert(ac.includes('operations'), 'operations category activates on click');
  await page.click('.tab-btn[data-tab="sales"]'); await new Promise(r => setTimeout(r, 300));
  var at = await page.evaluate(() => { var t = document.querySelector('.tab-btn.active'); return t ? t.getAttribute('data-tab') : null; });
  assert(at === 'sales', 'sales tab is active after click (got: ' + at + ')');
  var pa = await page.evaluate(() => { var t = document.querySelector('.tab-btn[data-tab="sales"]'); if (!t) return false; var c = t.closest('.tab-category'); return c ? c.classList.contains('active') : false; });
  assert(pa, 'parent operations category auto-active when sales sub-tab clicked');
  await browser.close();
  console.log('=== RESULTS: Pass=' + pass.length + ', Fail=' + fail.length + ' ===');
  if (fail.length) { fail.forEach(f => console.log(f)); process.exit(1); }
  console.log('=== ALL BROWSER TESTS PASSED ===');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
