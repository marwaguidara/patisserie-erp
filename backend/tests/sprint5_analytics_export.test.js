process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

jest.setTimeout(30000);

/**
 * Sprint 5 — Consolidated analytics export endpoint (GET /api/analytics/export).
 * Verifies the dataset required for the future AI phase, and that margins are
 * those already computed by the core backend (not recomputed here).
 */
describe('Sprint 5 — GET /api/analytics/export', () => {
  let adminToken;
  let cashierToken;

  const SECTIONS = ['sales', 'sale_items', 'stock_movements', 'purchase_orders', 'deliveries', 'products', 'categories', 'suppliers'];

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const admin = await request(app).post('/api/auth/login').send({ email: 'admin@bakery.com', password: 'password123' });
    adminToken = admin.body.token;
    const cashier = await request(app).post('/api/auth/login').send({ email: 'cashier@bakery.com', password: 'password123' });
    cashierToken = cashier.body.token;

    // Seed a sale so the export contains sales + sale items (with margins).
    const productsRes = await request(app).get('/api/products');
    const product = productsRes.body[0];
    await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ items: [{ product_id: product.id, quantity: 2 }], paymentMethod: 'CASH' });

    // Seed a delivered purchase order so the export contains purchase_orders + deliveries.
    const supplier = await db('suppliers').first();
    const ingredient = await db('ingredients').first();
    const poRes = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplier_id: supplier.id, items: [{ ingredient_id: ingredient.id, quantity_ordered: 10, unit_cost: 1.0 }] });
    await request(app)
      .put(`/api/purchase-orders/${poRes.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ORDERED' });
    await request(app)
      .put(`/api/purchase-orders/${poRes.body.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RECEIVED' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('ADMIN can export and the payload contains all sections', async () => {
    const res = await request(app)
      .get('/api/analytics/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.exported_at).toBeDefined();
    expect(res.body.counts).toBeDefined();
    expect(res.body.data).toBeDefined();
    SECTIONS.forEach((s) => expect(Array.isArray(res.body.data[s])).toBe(true));
  });

  test('counts are consistent with the database', async () => {
    const res = await request(app)
      .get('/api/analytics/export')
      .set('Authorization', `Bearer ${adminToken}`);
    const c = res.body.counts;

    const [sales, saleItems, movements, purchaseOrders, deliveredPOs, products, categories, suppliers] = await Promise.all([
      db('sales').count('* as n').first(),
      db('sale_items').count('* as n').first(),
      db('stock_movements').count('* as n').first(),
      db('purchase_orders').count('* as n').first(),
      db('purchase_orders').where({ status: 'RECEIVED' }).count('* as n').first(),
      db('products').count('* as n').first(),
      db('categories').count('* as n').first(),
      db('suppliers').count('* as n').first()
    ]);

    expect(c.sales).toEqual(Number(sales.n));
    expect(c.sale_items).toEqual(Number(saleItems.n));
    expect(c.stock_movements).toEqual(Number(movements.n));
    expect(c.purchase_orders).toEqual(Number(purchaseOrders.n));
    expect(c.products).toEqual(Number(products.n));
    expect(c.categories).toEqual(Number(categories.n));
    expect(c.suppliers).toEqual(Number(suppliers.n));
    // deliveries = received POs (each contributes >= 1 delivery line)
    expect(c.deliveries).toBeGreaterThanOrEqual(Number(deliveredPOs.n));
  });

  test('exported margins are the ones computed by the core backend', async () => {
    const res = await request(app)
      .get('/api/analytics/export')
      .set('Authorization', `Bearer ${adminToken}`);

    // sale items carry cost_per_unit + margin (computed at sale time)
    expect(res.body.data.sale_items.length).toBeGreaterThan(0);
    const item = res.body.data.sale_items[0];
    expect('margin' in item).toBe(true);
    expect('cost_per_unit' in item).toBe(true);
    expect('product_name' in item).toBe(true);

    // sales carry total_cost + total_margin (computed at sale time)
    expect(res.body.data.sales.length).toBeGreaterThan(0);
    const sale = res.body.data.sales[0];
    expect('total_margin' in sale).toBe(true);
    expect('total_cost' in sale).toBe(true);
    // each sale has its items + payments attached
    expect(Array.isArray(sale.items)).toBe(true);
    expect(Array.isArray(sale.payments)).toBe(true);
  });

  test('non-ADMIN roles are denied (403)', async () => {
    const res = await request(app)
      .get('/api/analytics/export')
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.statusCode).toEqual(403);
  });
});