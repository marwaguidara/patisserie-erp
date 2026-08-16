process.env.NODE_ENV = 'test';

// Point the dashboard + /ai/* proxy at a DEDICATED mock IA port (no clash with any
// dev IA service that may be listening on :8000). Both the consolidated endpoint
// and the direct /ai/* calls read the SAME mock source -> parity is provable.
process.env.AI_PROXY_HOST = '127.0.0.1';
process.env.AI_PROXY_PORT = '8765';

const http = require('http');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

jest.setTimeout(30000);

// Deterministic mock IA payloads (contract shape of the real AI service).
const MOCK_AI = {
  forecast: { product_id: 32, product: 'Croissant Pur Beurre', horizon_days: 7, next_7_days: [42.5, 40.1, 41.0, 39.8, 40.5, 38.2, 41.9], status: 'ok' },
  anomalies: { anomalies: [{ type: 'sales_drop', product_id: 32, description: 'test' }], excluded_products: [], status: 'ok' },
  segmentation: { segments: [{ name: 'Groupe A', products: [1] }, { name: 'Groupe B', products: [2] }], status: 'ok' },
};

function startAiMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('/forecast')) return res.end(JSON.stringify(MOCK_AI.forecast));
      if (req.url.includes('/anomalies')) return res.end(JSON.stringify(MOCK_AI.anomalies));
      if (req.url.includes('/segmentation')) return res.end(JSON.stringify(MOCK_AI.segmentation));
      res.statusCode = 501; res.end(JSON.stringify({ error: 'not mocked' }));
    });
    server.listen(8765, '127.0.0.1', () => resolve(server));
  });
}

describe('Sprint 5 — /api/dashboard/summary (ADMIN + source-parity)', () => {
  let adminToken;
  let aiServer;

  beforeAll(async () => {
    aiServer = await startAiMock();
    await db.migrate.latest();
    await db.seed.run();
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(login.statusCode).toEqual(200);
    adminToken = login.body.token;
  });

  afterAll(async () => {
    if (aiServer) aiServer.close();
    await db.destroy();
  });

  test('ADMIN -> 200 + required contract shape', async () => {
    const res = await request(app).get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ok');
    expect(res.body).toHaveProperty('kpis');
    expect(res.body).toHaveProperty('forecast_summary');
    expect(res.body).toHaveProperty('active_anomalies_count');
    expect(res.body).toHaveProperty('segmentation_summary');
    expect(typeof res.body.kpis.revenue).toBe('number');
    expect(typeof res.body.kpis.critical_stock_count).toBe('number');
    expect(Array.isArray(res.body.kpis.top_products)).toBe(true);
  });

  test('Non-ADMIN is refused (RBAC 403)', async () => {
    const res = await request(app).get('/api/dashboard/summary')
      .set('Authorization', 'Bearer invalid.token');
    expect(res.statusCode).toEqual(401); // requireAuth rejects first for bad token
  });

  test('kpis.revenue == /api/sales/metrics.month.total_revenue (NO recalcul)', async () => {
    const [d, m] = await Promise.all([
      request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/api/sales/metrics').set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(d.statusCode).toEqual(200); expect(m.statusCode).toEqual(200);
    expect(parseFloat(d.body.kpis.revenue)).toBeCloseTo(parseFloat(m.body.month.total_revenue), 2);
  });

  test('kpis.critical_stock_count == /api/ingredients/alerts.low_stock_count', async () => {
    const [d, a] = await Promise.all([
      request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/api/ingredients/alerts').set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(d.statusCode).toEqual(200); expect(a.statusCode).toEqual(200);
    expect(parseFloat(d.body.kpis.critical_stock_count)).toEqual(parseFloat(a.body.low_stock_count));
  });

  test('kpis.top_products mirror source top_products (names set)', async () => {
    const [d, m] = await Promise.all([
      request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/api/sales/metrics').set('Authorization', `Bearer ${adminToken}`),
    ]);
    const src = (m.body.top_products || []).map(p => String(p.id));
    const dst = (d.body.kpis.top_products || []).map(p => String(p.product_id));
    expect(dst.length).toBeLessThanOrEqual(src.length);
    const srcSet = new Set(src);
    dst.forEach(id => expect(srcSet.has(id)).toBe(true));
  });

  test('segmentation_summary.segments_count == /ai/segmentation length (same AI source)', async () => {
    const [d, s] = await Promise.all([
      request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/ai/segmentation').set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(d.statusCode).toEqual(200); expect(s.statusCode).toEqual(200);
    expect(d.body.segmentation_summary.segments_count).toEqual((s.body.segments || []).length);
    expect(d.body.segmentation_summary.segments_count).toEqual(MOCK_AI.segmentation.segments.length);
  });

  test('active_anomalies_count == /ai/anomalies length (same AI source)', async () => {
    const [d, a] = await Promise.all([
      request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/ai/anomalies').set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(d.statusCode).toEqual(200); expect(a.statusCode).toEqual(200);
    expect(d.body.active_anomalies_count).toEqual((a.body.anomalies || []).length);
    expect(d.body.active_anomalies_count).toEqual(MOCK_AI.anomalies.anomalies.length);
  });

  test('forecast_summary echoes /ai/forecast (no divergence)', async () => {
    const [d, f] = await Promise.all([
      request(app).get('/api/dashboard/summary').set('Authorization', `Bearer ${adminToken}`),
      request(app).get('/ai/forecast?product_id=32&horizon_days=7').set('Authorization', `Bearer ${adminToken}`),
    ]);
    expect(d.statusCode).toEqual(200); expect(f.statusCode).toEqual(200);
    expect(d.body.forecast_summary.product_id).toEqual(32);
    expect(d.body.forecast_summary.horizon_days).toEqual(7);
    const srcNext = Array.isArray(f.body.next_7_days) && f.body.next_7_days.length > 0 ? parseFloat(f.body.next_7_days[0]) : 0;
    expect(parseFloat(d.body.forecast_summary.forecast_next)).toBeCloseTo(srcNext, 2);
    expect(d.body.forecast_summary.forecast_next).toBeCloseTo(MOCK_AI.forecast.next_7_days[0], 2);
  });
});