const { chromium } = require('playwright');

(async () => {
  const url = process.env.URL || 'http://localhost:5000';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push({ text: err.message });
  });

  try {
    console.log('Opening', url);
    await page.goto(url, { waitUntil: 'networkidle' });

    // Click safe buttons (avoid destructive/danger buttons)
    const buttons = await page.$$('button');
    for (const b of buttons) {
      try {
        const text = (await b.innerText()).trim();
        const cls = (await b.getAttribute('class')) || '';
        if (cls.includes('btn-danger')) continue;
        if (/supprimer|delete|🗑|annuler|cancel/i.test(text)) continue;

        await b.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(200);
      } catch (e) {
        // ignore individual click errors
      }
    }

    // Click tab buttons explicitly
    const tabs = await page.$$('.tab-btn');
    for (const t of tabs) {
      try {
        await t.click();
        await page.waitForTimeout(200);
      } catch (e) {}
    }

    // Take screenshot for manual inspection
    const screenshotPath = 'backend/tools/ui_check_screenshot.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('Console errors captured:', JSON.stringify(consoleErrors, null, 2));
    console.log('Screenshot saved to', screenshotPath);
  } catch (err) {
    console.error('UI check failed:', err);
    process.exitCode = 2;
  } finally {
    await browser.close();
  }
})();
