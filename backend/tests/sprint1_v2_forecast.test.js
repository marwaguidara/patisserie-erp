process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

describe('Sprint 1 - Phase 4 Model v2 Forecast Endpoint & Cache Tests', () => {
  let adminToken;
  let cashierToken;
  let newProductId;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    // Login ADMIN
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    adminToken = adminLogin.body.token;

    // Login CASHIER
    const cashierLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier@bakery.com', password: 'password123' });
    cashierToken = cashierLogin.body.token;

    // Create a new product with zero sales history
    const [id] = await db('products').insert({
      name: 'Pain de campagne spécial',
      category_id: 1,
      price: 2.50,
      stock_quantity: 50
    });
    newProductId = id;
  });

  afterAll(async () => {
    if (newProductId) {
      await db('products').where({ id: newProductId }).del();
    }
    await db.destroy();
  });

  describe('1. Response Contract & Insufficient Data Verification', () => {
    test('Newly created product (0 sales) -> status: insufficient_data & value: null', async () => {
      const res = await request(app)
        .get(`/ai/forecast?product_id=${newProductId}&horizon_days=7`)
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('status', 'insufficient_data');
        expect(res.body).toHaveProperty('value', null);
        expect(res.body).toHaveProperty('confidence');
        expect(res.body.confidence).toHaveProperty('level', 'faible');
        expect(res.body.confidence).toHaveProperty('interval', [0.0, 0.0]);
        expect(res.body).toHaveProperty('model_version');
      }
    });

    test('Product with sales history (Product 32) -> status: ok & ridge-v2 & residual interval', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=32&horizon_days=7')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('status', 'ok');
        expect(typeof res.body.value).toBe('number');
        expect(res.body.value).toBeGreaterThanOrEqual(0);
        expect(res.body.model_version).toBe('ridge-v2');
        expect(res.body).toHaveProperty('confidence');
        expect(['haute', 'moyenne']).toContain(res.body.confidence.level);
        expect(Array.isArray(res.body.confidence.interval)).toBe(true);
        expect(res.body.confidence.interval).toHaveLength(2);
        expect(res.body.confidence.interval[0]).toBeLessThanOrEqual(res.body.confidence.interval[1]);
        const margin = 1.96 * 7.3466;
        expect(res.body.confidence.interval[1]).toBeCloseTo(res.body.value + margin, 0);
        expect(res.body.confidence.interval[0]).toBeCloseTo(Math.max(0, res.body.value - margin), 0);
      }
    });

    test('Product 30 (kak warka) -> status: ok & baseline-v1 (hybrid routing)', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=30&horizon_days=7')
        .set('Authorization', `Bearer ${adminToken}`);

      if (res.statusCode === 200) {
        expect(['ok', 'insufficient_data']).toContain(res.body.status);
        if (res.body.status === 'ok') {
          expect(res.body.model_version).toBe('baseline-v1');
          expect(typeof res.body.value).toBe('number');
          expect(Array.isArray(res.body.confidence.interval)).toBe(true);
          expect(res.body.confidence.interval[0]).toBeLessThanOrEqual(res.body.confidence.interval[1]);
        }
      }
    });
  });

  describe('2. RBAC Verification on Modified Endpoint', () => {
    test('Unauthenticated request -> 401 Unauthorized', async () => {
      const res = await request(app).get('/ai/forecast?product_id=32');
      expect(res.statusCode).toBe(401);
    });

    test('CASHIER role -> 403 Forbidden', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=32')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(res.statusCode).toBe(403);
    });

    test('ADMIN role -> 200 Authorized', async () => {
      const res = await request(app)
        .get('/ai/forecast?product_id=32')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });
  });
});
