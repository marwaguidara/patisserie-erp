process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

describe('Full RBAC Matrix Test Suite - Real API Testing', () => {
  let tokens = {};

  const ROLES = ['ADMIN', 'PRODUCTION', 'STOCK', 'CASHIER', 'EMPLOYEE'];

  const CREDENTIALS = {
    ADMIN: { email: 'admin@bakery.com', password: 'password123' },
    PRODUCTION: { email: 'production@bakery.com', password: 'password123' },
    STOCK: { email: 'stock@bakery.com', password: 'password123' },
    CASHIER: { email: 'cashier@bakery.com', password: 'password123' },
    EMPLOYEE: { email: 'employe@bakery.com', password: 'password123' }
  };

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    // Authenticate all 5 roles using seed credentials
    for (const role of ROLES) {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send(CREDENTIALS[role]);
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.body).toHaveProperty('token');
      tokens[role] = loginRes.body.token;
    }

    // Ensure STOCK user has an employee profile for self-profile test
    const stockUser = await db('users').where({ email: 'stock@bakery.com' }).first();
    if (stockUser) {
      const empStock = await db('employees').where({ user_id: stockUser.id }).first();
      if (!empStock) {
        await db('employees').insert({
          user_id: stockUser.id,
          first_name: 'Gestionnaire',
          last_name: 'Stock',
          job_title: 'Stock Manager'
        });
      }
    }
  });

  afterAll(async () => {
    await db.destroy();
  });

  /**
   * Reusable Assertion Helper for RBAC Matrix testing.
   * Dynamically evaluates 401 (Unauthenticated), 200/201 (Allowed roles), and 403 (Forbidden roles).
   */
  function assertRbacMatrix({
    name,
    method,
    url,
    getSendPayload,
    getUrl,
    allowedRoles,
    allowedStatus = [200, 201, 204],
    isAiProxy = false,
    beforeEachRole
  }) {
    describe(`RBAC Matrix: ${name}`, () => {
      test('1. Unauthenticated Request -> 401 Unauthorized', async () => {
        const targetUrl = getUrl ? await getUrl() : url;
        let req = request(app)[method.toLowerCase()](targetUrl);
        if (getSendPayload) req = req.send(getSendPayload('UNAUTH'));
        const res = await req;
        expect(res.statusCode).toBe(401);
      });

      ROLES.forEach((role) => {
        const isAllowed = allowedRoles.includes(role);
        const expectedLabel = isAllowed ? 'Allowed' : '403 Forbidden';

        test(`2. Role: ${role} -> ${expectedLabel}`, async () => {
          if (beforeEachRole) await beforeEachRole(role);

          const targetUrl = getUrl ? await getUrl(role) : url;
          let req = request(app)[method.toLowerCase()](targetUrl)
            .set('Authorization', `Bearer ${tokens[role]}`);
          if (getSendPayload) req = req.send(getSendPayload(role));

          const res = await req;

          if (isAllowed) {
            if (isAiProxy) {
              expect(res.statusCode).not.toBe(401);
              expect(res.statusCode).not.toBe(403);
            } else {
              expect(allowedStatus).toContain(res.statusCode);
            }
          } else {
            expect(res.statusCode).toBe(403);
          }
        });
      });
    });
  }

  // ─── 1. USERS MODULE ────────────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Users - Profile Self Info (GET /api/auth/me)',
    method: 'GET',
    url: '/api/auth/me',
    allowedRoles: ['ADMIN', 'PRODUCTION', 'STOCK', 'CASHIER', 'EMPLOYEE'],
    allowedStatus: [200]
  });

  // ─── 2. PRODUCTS MODULE ─────────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Products - Create Product (POST /api/products)',
    method: 'POST',
    url: '/api/products',
    getSendPayload: (role) => ({ name: `Pain RBAC ${role} ${Date.now()}`, price: 2.50, category_id: 1 }),
    allowedRoles: ['ADMIN', 'PRODUCTION'],
    allowedStatus: [201]
  });

  let productToDeleteId;
  assertRbacMatrix({
    name: 'Products - Delete Product (DELETE /api/products/:id)',
    method: 'DELETE',
    beforeEachRole: async () => {
      const [id] = await db('products').insert({
        name: `Temp Delete Prod ${Date.now()}`,
        price: 1.00,
        stock_quantity: 10
      }).returning('id');
      productToDeleteId = typeof id === 'object' ? id.id : id;
    },
    getUrl: () => `/api/products/${productToDeleteId}`,
    allowedRoles: ['ADMIN'],
    allowedStatus: [200]
  });

  // ─── 3. STOCKS / INGREDIENTS MODULE ──────────────────────────────────────────
  assertRbacMatrix({
    name: 'Stocks - Stock Movement (POST /api/ingredients/1/movement)',
    method: 'POST',
    url: '/api/ingredients/1/movement',
    getSendPayload: () => ({ movement_type: 'IN', quantity: 5.0, reason: 'Réapprovisionnement test' }),
    allowedRoles: ['ADMIN', 'PRODUCTION', 'STOCK'],
    allowedStatus: [200]
  });

  let ingredientToDeleteId;
  assertRbacMatrix({
    name: 'Stocks - Delete Ingredient (DELETE /api/ingredients/:id)',
    method: 'DELETE',
    beforeEachRole: async () => {
      const [id] = await db('ingredients').insert({
        name: `Temp Delete Ing ${Date.now()}`,
        unit: 'kg',
        current_stock: 10
      }).returning('id');
      ingredientToDeleteId = typeof id === 'object' ? id.id : id;
    },
    getUrl: () => `/api/ingredients/${ingredientToDeleteId}`,
    allowedRoles: ['ADMIN'],
    allowedStatus: [200]
  });

  // ─── 4. SALES MODULE ────────────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Sales - List Sales (GET /api/sales)',
    method: 'GET',
    url: '/api/sales',
    allowedRoles: ['ADMIN', 'PRODUCTION', 'CASHIER'],
    allowedStatus: [200]
  });

  assertRbacMatrix({
    name: 'Sales - Create Sale (POST /api/sales)',
    method: 'POST',
    url: '/api/sales',
    getSendPayload: () => ({
      paymentMethod: 'CASH',
      items: [{ product_id: 1, quantity: 1, unit_price: 1.30 }]
    }),
    allowedRoles: ['ADMIN', 'PRODUCTION', 'CASHIER'],
    allowedStatus: [201]
  });

  // ─── 5. EMPLOYEES MODULE ────────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Employees - View Employee Profile / Directory (GET /api/employees)',
    method: 'GET',
    url: '/api/employees',
    allowedRoles: ['ADMIN', 'PRODUCTION', 'STOCK', 'CASHIER', 'EMPLOYEE'],
    allowedStatus: [200]
  });

  assertRbacMatrix({
    name: 'Employees - Create Employee (POST /api/employees)',
    method: 'POST',
    url: '/api/employees',
    getSendPayload: (role) => ({
      first_name: 'Nouveau',
      last_name: 'Employé',
      email: `emp.rbac.${role}.${Date.now()}@bakery.com`,
      password: 'password123',
      role: 'EMPLOYEE'
    }),
    allowedRoles: ['ADMIN'],
    allowedStatus: [201]
  });

  // ─── 6. SUPPLIERS MODULE ────────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Suppliers - List Suppliers (GET /api/suppliers)',
    method: 'GET',
    url: '/api/suppliers',
    allowedRoles: ['ADMIN', 'PRODUCTION', 'STOCK'],
    allowedStatus: [200]
  });

  assertRbacMatrix({
    name: 'Suppliers - Create Supplier (POST /api/suppliers)',
    method: 'POST',
    url: '/api/suppliers',
    getSendPayload: (role) => ({ name: `Fournisseur RBAC ${role} ${Date.now()}`, email: `sup.${Date.now()}@test.com` }),
    allowedRoles: ['ADMIN', 'STOCK'],
    allowedStatus: [201]
  });

  // ─── 7. ORDERS MODULE ───────────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Orders - List Purchase Orders (GET /api/purchase-orders)',
    method: 'GET',
    url: '/api/purchase-orders',
    allowedRoles: ['ADMIN', 'PRODUCTION', 'STOCK'],
    allowedStatus: [200]
  });

  assertRbacMatrix({
    name: 'Orders - Create Customer Order (POST /api/customer-orders)',
    method: 'POST',
    url: '/api/customer-orders',
    getSendPayload: () => ({
      customer_name: 'Client RBAC Test',
      customer_phone: '+33600000000',
      delivery_date: '2026-08-30',
      items: [{ product_id: 1, quantity: 2 }]
    }),
    allowedRoles: ['ADMIN', 'CASHIER'],
    allowedStatus: [201]
  });

  // ─── 8. FORECAST MODULE ─────────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Forecast - View Sales Forecast (GET /ai/forecast)',
    method: 'GET',
    url: '/ai/forecast?product_id=1',
    allowedRoles: ['ADMIN', 'PRODUCTION', 'STOCK'],
    isAiProxy: true
  });

  // ─── 9. PRODUCTION RECOMMENDATIONS MODULE ──────────────────────────────────
  assertRbacMatrix({
    name: 'Production Recommendations (GET /ai/production-recommendations)',
    method: 'GET',
    url: '/ai/production-recommendations',
    allowedRoles: ['ADMIN', 'PRODUCTION'],
    isAiProxy: true
  });

  // ─── 10. ANOMALIES MODULE ───────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Anomalies - View Stock Anomalies (GET /ai/anomalies)',
    method: 'GET',
    url: '/ai/anomalies',
    allowedRoles: ['ADMIN', 'STOCK'],
    isAiProxy: true
  });

  // ─── 11. SEGMENTATION MODULE ────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Segmentation - View Customer Segmentation (GET /ai/segmentation)',
    method: 'GET',
    url: '/ai/segmentation',
    allowedRoles: ['ADMIN'],
    isAiProxy: true
  });

  // ─── 12. DASHBOARD MODULE ───────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Dashboard - Strategic Summary (GET /api/dashboard/summary)',
    method: 'GET',
    url: '/api/dashboard/summary',
    allowedRoles: ['ADMIN'],
    allowedStatus: [200]
  });

  // ─── 13. AUDIT LOGS MODULE ──────────────────────────────────────────────────
  assertRbacMatrix({
    name: 'Audit Logs - Access Audit Logs (GET /api/audit-logs)',
    method: 'GET',
    url: '/api/audit-logs',
    allowedRoles: ['ADMIN'],
    allowedStatus: [200]
  });
});
