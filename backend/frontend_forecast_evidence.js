/**
 * Playwright script: Open the Forecast UI and capture network evidence.
 * Verifies that all AI requests go through /ai/* proxy (never directly to 127.0.0.1:8000).
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Track all network requests and responses
  const allRequests = [];
  const allResponses = [];
  const aiProxyRequests = [];
  const directAiRequests = [];

  page.on('request', (request) => {
    const url = request.url();
    const entry = { url, method: request.method(), resourceType: request.resourceType() };
    allRequests.push(entry);

    // Requests to /ai/* (same-origin proxy path)
    if (url.includes('/ai/')) {
      aiProxyRequests.push(entry);
    }

    // Direct requests to the AI service (should NEVER happen from the browser)
    if (url.includes('127.0.0.1:8000') || url.includes('localhost:8000')) {
      directAiRequests.push(entry);
      console.log('❌ DIRECT REQUEST DETECTED:', url);
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    const entry = { url, status: response.status(), method: response.request().method() };
    allResponses.push(entry);
  });

  // Navigate to the frontend
  console.log('=== Navigating to http://localhost:5000/ ===');
  const response = await page.goto('http://localhost:5000/', { waitUntil: 'networkidle' });
  console.log('Page loaded. Status:', response ? response.status() : 'N/A');

  // Wait for the /ai/forecast request to complete
  console.log('Waiting for /ai/forecast request...');
  try {
    await page.waitForResponse(async (resp) => {
      const url = resp.url();
      return url.includes('/ai/forecast') && resp.status() === 200;
    }, { timeout: 15000 });
    console.log('✅ /ai/forecast request completed with 200');
  } catch (e) {
    console.log('⚠️ /ai/forecast not found, waiting...');
    await page.waitForTimeout(3000);
  }

  // Give the UI a moment to render
  await page.waitForTimeout(1000);

  // Click the Forecast tab
  console.log('\n=== Opening Forecast tab ===');
  const forecastTab = await page.$('.tab-btn[data-tab="forecast"]');
  if (forecastTab) {
    await forecastTab.click();
    await page.waitForTimeout(500);
    console.log('✅ Forecast tab clicked');
  } else {
    console.log('⚠️ Forecast tab button not found, checking if already visible...');
  }

  // Extract displayed values from the Forecast UI
  const forecastValue = await page.$eval('#forecast-value', (el) => el.textContent || '') || 'NOT FOUND';
  const forecastConfidence = await page.$eval('#forecast-confidence', (el) => el.textContent || '') || 'NOT FOUND';
  const forecastStatus = await page.$eval('#forecast-status', (el) => el.textContent || '') || 'NOT FOUND';
  const forecastInterval = await page.$eval('#forecast-interval', (el) => el.textContent || '') || 'NOT FOUND';

  console.log('\n=== FORECAST DISPLAY ===');
  console.log('  Forecast Value:', forecastValue);
  console.log('  Forecast Confidence:', forecastConfidence);
  console.log('  Forecast Status:', forecastStatus);
  console.log('  Forecast Interval:', forecastInterval);

  // --- Network Evidence ---
  console.log('\n=== NETWORK EVIDENCE ===');

  console.log('\n--- Requests to /ai/* (via proxy) ---');
  if (aiProxyRequests.length > 0) {
    aiProxyRequests.forEach((req) => {
      console.log(`  ✅ ${req.method} ${req.url}`);
    });
  } else {
    console.log('  ❌ No /ai/* requests found');
  }

  console.log('\n--- Direct requests to 127.0.0.1:8000 ---');
  if (directAiRequests.length === 0) {
    console.log('  ✅ NONE - browser never talks to the AI service directly');
  } else {
    console.log('  ❌ Found direct requests:');
    directAiRequests.forEach((req) => console.log(`  ❌ ${req.method} ${req.url}`));
  }

  // Show /ai/* responses
  console.log('\n--- /ai/* Response Summary ---');
  const aiResponses = allResponses.filter((r) => r.url.includes('/ai/'));
  aiResponses.forEach((resp) => {
    console.log(`  ${resp.method} ${resp.url} -> HTTP ${resp.status}`);
  });

  // Screenshot
  await page.screenshot({ path: 'C:\\marwaguidara\\summer\\frontend-forecast-ui.png', fullPage: true });
  console.log('\n✅ Screenshot saved to C:\\marwaguidara\\summer\\frontend-forecast-ui.png');

  await browser.close();
  console.log('\n=== DONE ===');
})().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
