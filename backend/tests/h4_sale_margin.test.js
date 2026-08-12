process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * H-4 Regression: Sale costs & margins must be persisted.
 *
 * SalesService computes cost_per_unit / margin / total_cost / total_margin
 * but these values were discarded at INSERT time (columns stayed at DEFAULT 0).
 * This test proves the created sale and its items retain the real values and
 * that the HTML ticket displays the true margin.
 */
describe('H-4: Sale costs, margins and totals are persisted', () => {
  let authToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier@bakery.com', password: 'password123' });

    expect(login.statusCode).toEqual(200);
    authToken = login.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('POST /api/sales persists total_cost, total_margin, total_items and status', async () => {
    // Fetch the seeded Croissant — it has a recipe with real ingredient costs
    // (0.08kg flour @1.20 + 0.04kg butter @8.50 + 0.01kg sugar @1.50)
    const productsRes = await request(app).get('/api/products');
    const croissant = productsRes.body.find((p) => p.name === 'Croissant Pur Beurre');
    expect(croissant).toBeDefined();
    expect(croissant.ingredients.length).toBeGreaterThan(0);

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ product_id: croissant.id, quantity: 10 }],
        paymentMethod: 'CASH',
        customerName: 'Test H4'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();

    // total_amount = 10 * 1.30 = 13.00
    expect(parseFloat(res.body.total_amount)).toEqual(13.00);
    // total_items = 10
    expect(parseInt(res.body.total_items, 10)).toEqual(10);
    // status persisted as PAID
    expect(res.body.status).toEqual('PAID');

    // cost = 10 * (0.08*1.20 + 0.04*8.50 + 0.01*1.50) = 10 * (0.096+0.34+0.015) = 10 * 0.451 = 4.51
    expect(parseFloat(res.body.total_cost)).toBeGreaterThan(0);
    expect(parseFloat(res.body.total_margin)).toBeGreaterThan(0);
    // margin = 13.00 - 4.51 = 8.49
    expect(parseFloat(res.body.total_margin)).toBeCloseTo(8.49, 2);
  });

  test('Sale items include cost_per_unit and margin', async () => {
    const productsRes = await request(app).get('/api/products');
    const croissant = productsRes.body.find((p) => p.name === 'Croissant Pur Beurre');

    const saleRes = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ product_id: croissant.id, quantity: 5 }],
        paymentMethod: 'CARD',
        customerName: 'Test H4 items'
      });

    expect(saleRes.statusCode).toEqual(201);
    expect(saleRes.body.items).toHaveLength(1);

    const item = saleRes.body.items[0];
    expect(parseFloat(item.cost_per_unit)).toBeGreaterThan(0);
    expect(parseFloat(item.margin)).toBeGreaterThan(0);
    expect(item.quantity).toEqual(5);
    expect(parseFloat(item.unit_price)).toEqual(1.30);
  });

  test('HTML ticket displays the real margin (not 0.00)', async () => {
    const productsRes = await request(app).get('/api/products');
    const croissant = productsRes.body.find((p) => p.name === 'Croissant Pur Beurre');

    const saleRes = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ product_id: croissant.id, quantity: 2 }],
        paymentMethod: 'CASH',
        customerName: 'Ticket H4'
      });

    expect(saleRes.statusCode).toEqual(201);
    const saleId = saleRes.body.id;

    const ticketRes = await request(app)
      .get(`/api/sales/${saleId}/ticket/html`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(ticketRes.statusCode).toEqual(200);
    expect(ticketRes.headers['content-type']).toContain('text/html');
    // 2 croissants: margin = 2 * (1.30 - 0.451) = 1.698 -> 1.70
    // The markup is "<strong>Marge:</strong> 1.70 €", so account for the
    // closing </strong> tag. Assert on the numeric value only — the euro
    // sign round-trip depends on the response charset (text/html without
    // charset decodes as latin-1 in supertest), so the numeric check is
    // encoding-independent.
    expect(ticketRes.text).toMatch(/Marge:<\/strong>\s*1\.70/);
    expect(ticketRes.text).not.toMatch(/Marge:<\/strong>\s*0\.00/);
  });
});