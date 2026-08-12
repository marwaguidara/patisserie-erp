const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5000';

test.describe('Sprint 2 Sales UI', () => {
  test('should allow login and create a sale through the frontend', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.click('button#login-modal-btn');
    await page.selectOption('#login-email-select', 'cashier@bakery.com');
    await page.fill('#login-password', 'password123');
    await page.click('#login-form button[type="submit"]');

    await expect(page.locator('#user-profile')).toContainText('Vendeuse Caissière');

    await page.click('.tab-btn[data-tab="sales"]');

    await page.click('#add-sale-item-btn');
    await page.selectOption('#sales-items-container select:nth-of-type(1)', { index: 1 });
    await page.fill('#sales-items-container input[type="number"]', '2');

    await page.selectOption('#sale-payment-method', 'CASH');
    await page.fill('#sale-customer-name', 'Test Client');
    await page.fill('#sale-customer-phone', '0600000000');

    await page.click('#sales-form button[type="submit"]');

    await expect(page.locator('.toast')).toContainText('Vente enregistrée');
    await expect(page.locator('#sales-history-tbody tr')).toHaveCountGreaterThan(0);
  });
});
