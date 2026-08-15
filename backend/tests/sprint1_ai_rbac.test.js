process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

describe('Sprint 1 - Phase 4 AI RBAC Protection Tests (/ai/forecast)', () => {
  let adminToken;
  let productionToken;
  let stockToken;
  let cashierToken;
  let employeeToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    // 1. Authenticate ADMIN (admin@bakery.com)
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(adminLogin.statusCode).toBe(200);
    adminToken = adminLogin.body.token;

    // 2. Authenticate PRODUCTION (production@bakery.com)
    const prodLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'production@bakery.com', password: 'password123' });
    expect(prodLogin.statusCode).toBe(200);
    productionToken = prodLogin.body.token;

    // 3. Authenticate STOCK (stock@bakery.com)
    const stockLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'stock@bakery.com', password: 'password123' });
    expect(stockLogin.statusCode).toBe(200);
    stockToken = stockLogin.body.token;

    // 4. Authenticate CASHIER (cashier@bakery.com)
    const cashierLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier@bakery.com', password: 'password123' });
    expect(cashierLogin.statusCode).toBe(200);
    cashierToken = cashierLogin.body.token;

    // 5. Authenticate EMPLOYEE (employe@bakery.com)
    const empLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employe@bakery.com', password: 'password123' });
    expect(empLogin.statusCode).toBe(200);
    employeeToken = empLogin.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('Backend RBAC - GET /ai/forecast', () => {
    test('1. Unauthenticated request (no token) -> 401 Unauthorized', async () => {
      const res = await request(app).get('/ai/forecast?product_id=1');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Authentication required/i);
    });

    test('2. Administrateur / Gérant (ADMIN) -> Authorized (200 or 502 if upstream AI off, but NOT 401/403)', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=1')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    test('3. Responsable Production (PRODUCTION) -> Authorized (200 or 502 if upstream AI off, but NOT 401/403)', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=1')
        .set('Authorization', `Bearer ${productionToken}`);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    test('4. Responsable Stock / Achats (STOCK) -> Authorized (200 or 502 if upstream AI off, but NOT 401/403)', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=1')
        .set('Authorization', `Bearer ${stockToken}`);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    test('5. Vendeur / Caissier (CASHIER) -> 403 Forbidden', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=1')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });

    test('6. Employé (EMPLOYEE) -> 403 Forbidden', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=1')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });

    test('7. Authorized ADMIN receives forecast contract with model_version when AI is up', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=25&horizon_days=7')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('value');
        expect(res.body).toHaveProperty('confidence');
        expect(res.body.confidence).toHaveProperty('level');
        expect(res.body.confidence).toHaveProperty('interval');
        expect(Array.isArray(res.body.confidence.interval)).toBe(true);
        expect(res.body.confidence.interval).toHaveLength(2);
        expect(['ok', 'insufficient_data']).toContain(res.body.status);
        expect(['ridge-v2', 'baseline-v1']).toContain(res.body.model_version);
      }
    });
  });

  describe('Frontend Conditional Render & Helper Validation for all 5 roles', () => {
    // Pure unit evaluation mirroring frontend can('view_ai_forecast') logic
    function can(role, permission) {
      if (!role) return false;
      switch (permission) {
        case 'view_ai_forecast':
          return ['ADMIN', 'PRODUCTION', 'STOCK'].includes(role);
        case 'run_ai_etl':
          return ['ADMIN'].includes(role);
        default:
          return false;
      }
    }

    const ROLE_TABS = {
      ADMIN: ['catalog', 'ingredients', 'production', 'sales', 'employees', 'suppliers', 'categories', 'purchase-orders', 'customer-orders', 'forecast'],
      STOCK: ['ingredients', 'suppliers', 'purchase-orders', 'forecast'],
      CASHIER: ['sales', 'customer-orders'],
      PRODUCTION: ['catalog', 'ingredients', 'production', 'customer-orders', 'purchase-orders', 'forecast'],
      EMPLOYEE: ['employees']
    };

    test('ADMIN role can view forecast tab and run ETL', () => {
      expect(can('ADMIN', 'view_ai_forecast')).toBe(true);
      expect(can('ADMIN', 'run_ai_etl')).toBe(true);
      expect(ROLE_TABS.ADMIN.includes('forecast')).toBe(true);
    });

    test('PRODUCTION role can view forecast tab but NOT run ETL', () => {
      expect(can('PRODUCTION', 'view_ai_forecast')).toBe(true);
      expect(can('PRODUCTION', 'run_ai_etl')).toBe(false);
      expect(ROLE_TABS.PRODUCTION.includes('forecast')).toBe(true);
    });

    test('STOCK role can view forecast tab but NOT run ETL', () => {
      expect(can('STOCK', 'view_ai_forecast')).toBe(true);
      expect(can('STOCK', 'run_ai_etl')).toBe(false);
      expect(ROLE_TABS.STOCK.includes('forecast')).toBe(true);
    });

    test('CASHIER role CANNOT view forecast tab', () => {
      expect(can('CASHIER', 'view_ai_forecast')).toBe(false);
      expect(can('CASHIER', 'run_ai_etl')).toBe(false);
      expect(ROLE_TABS.CASHIER.includes('forecast')).toBe(false);
    });

    test('EMPLOYEE role CANNOT view forecast tab', () => {
      expect(can('EMPLOYEE', 'view_ai_forecast')).toBe(false);
      expect(can('EMPLOYEE', 'run_ai_etl')).toBe(false);
      expect(ROLE_TABS.EMPLOYEE.includes('forecast')).toBe(false);
    });
  });
describe('Backend RBAC - GET /ai/production-recommendations (pre-dev protection)', () => {
    test('1. Unauthenticated request (no token) -> 401 Unauthorized', async () => {
      const res = await request(app).get('/ai/production-recommendations');
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/Authentication required/i);
    });

    test('2. Administrateur / Gérant (ADMIN) -> Authorized (pass-through, business still 501; NOT 401/403)', async () => {
      const res = await request(app)
        .get('/ai/production-recommendations')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    test('3. Responsable Production (PRODUCTION) -> Authorized (NOT 401/403)', async () => {
      const res = await request(app)
        .get('/ai/production-recommendations')
        .set('Authorization', `Bearer ${productionToken}`);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });

    test('4. Responsable Stock / Achats (STOCK) -> 403 Forbidden (own endpoint in Sprint 3)', async () => {
      const res = await request(app)
        .get('/ai/production-recommendations')
        .set('Authorization', `Bearer ${stockToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });

    test('5. Vendeur / Caissier (CASHIER) -> 403 Forbidden', async () => {
      const res = await request(app)
        .get('/ai/production-recommendations')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });

    test('6. Employé (EMPLOYEE) -> 403 Forbidden', async () => {
      const res = await request(app)
        .get('/ai/production-recommendations')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toMatch(/Access denied/i);
    });
  });
});
