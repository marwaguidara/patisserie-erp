process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

describe('Simple concurrency check for production', () => {
  let authToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'production@bakery.com', password: 'password123' });

    authToken = res.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('Two concurrent heavy produce requests do not create negative stock', async () => {
    const productsRes = await request(app).get('/api/products');
    const croissant = productsRes.body.find((p) => p.name === 'Croissant Pur Beurre');
    expect(croissant).toBeDefined();

    const initialIngredients = await request(app).get('/api/ingredients');
    const butter = initialIngredients.body.find((i) => i.name === 'Beurre Doux 82%');
    expect(butter).toBeDefined();
    const initialButterStock = parseFloat(butter.current_stock);

    // Two concurrent large productions that together exceed butter stock
    const heavyQty = 1000; // each request will try to deduct a large amount

    const p1 = request(app)
      .post(`/api/products/${croissant.id}/produce`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ quantity: heavyQty });

    const p2 = request(app)
      .post(`/api/products/${croissant.id}/produce`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ quantity: heavyQty });

    const results = await Promise.allSettled([p1, p2]);

    // Ensure at least one request failed with 400 due to insufficient stock
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.statusCode : 500));
    expect(statuses.some((s) => s === 400)).toBe(true);

    // Verify no ingredient has negative stock
    const afterIngredients = await request(app).get('/api/ingredients');
    const butterAfter = afterIngredients.body.find((i) => i.name === 'Beurre Doux 82%');
    expect(parseFloat(butterAfter.current_stock)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(butterAfter.current_stock)).toBeLessThanOrEqual(initialButterStock);
  }, 20000);
});
