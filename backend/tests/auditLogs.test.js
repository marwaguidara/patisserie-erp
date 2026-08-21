process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');
const AuditLogService = require('../src/services/auditLogService');

describe('Audit Logs & User Action Traceability Tests', () => {
  let adminToken;
  let cashierToken;
  let adminId;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    // Authenticate ADMIN
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(adminLogin.statusCode).toBe(200);
    adminToken = adminLogin.body.token;
    adminId = adminLogin.body.user.id;

    // Authenticate CASHIER
    const cashierLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier@bakery.com', password: 'password123' });
    expect(cashierLogin.statusCode).toBe(200);
    cashierToken = cashierLogin.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('1. RBAC Restrictions on GET /api/audit-logs', () => {
    test('Unauthenticated request -> 401 Unauthorized', async () => {
      const res = await request(app).get('/api/audit-logs');
      expect(res.statusCode).toBe(401);
    });

    test('Non-ADMIN user (CASHIER) -> 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Authorization', `Bearer ${cashierToken}`);
      expect(res.statusCode).toBe(403);
    });

    test('ADMIN user -> 200 OK & returns paginated audit logs', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('2. Audit Recording & Filtering Operations', () => {
    test('Logs LOGIN action upon successful login', async () => {
      const logs = await AuditLogService.getLogs({ action: 'LOGIN' });
      expect(logs.data.length).toBeGreaterThan(0);
      expect(logs.data[0].action).toBe('LOGIN');
    });

    test('Logs CREATE_PRODUCT, UPDATE_PRODUCT, and DELETE_PRODUCT actions', async () => {
      // Create product
      const createRes = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Pain aux Raisins Audit Test',
          price: 2.10,
          category_id: 1
        });
      expect(createRes.statusCode).toBe(201);
      const prodId = createRes.body.id;

      // Update product
      const updateRes = await request(app)
        .put(`/api/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 2.30 });
      expect(updateRes.statusCode).toBe(200);

      // Delete product
      const deleteRes = await request(app)
        .delete(`/api/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deleteRes.statusCode).toBe(200);

      // Verify audit logs
      const createLogs = await AuditLogService.getLogs({ action: 'CREATE_PRODUCT' });
      const updateLogs = await AuditLogService.getLogs({ action: 'UPDATE_PRODUCT' });
      const deleteLogs = await AuditLogService.getLogs({ action: 'DELETE_PRODUCT' });

      expect(createLogs.data.some(l => l.entity_id === String(prodId))).toBe(true);
      expect(updateLogs.data.some(l => l.entity_id === String(prodId))).toBe(true);
      expect(deleteLogs.data.some(l => l.entity_id === String(prodId))).toBe(true);
    });

    test('Filter audit logs by action and user_id via GET /api/audit-logs', async () => {
      const res = await request(app)
        .get(`/api/audit-logs?action=LOGIN&user_id=${adminId}&page=1&limit=10`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.data.every(l => l.action === 'LOGIN')).toBe(true);
    });
  });
});
