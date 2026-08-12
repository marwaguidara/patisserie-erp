process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

describe('Walking Skeleton E2E Integration Suite', () => {
  let authToken;

  beforeAll(async () => {
    // Run migrations and seed in-memory database
    await db.migrate.latest();
    await db.seed.run();

    const login = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'production@bakery.com',
        password: 'password123'
      });

    expect(login.statusCode).toEqual(200);
    authToken = login.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('1. Health check endpoint responds with UP status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('UP');
    expect(res.body.walking_skeleton).toBe(true);
  });

  test('2. User login produces valid JWT token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'production@bakery.com',
        password: 'password123'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toEqual('PRODUCTION');
    authToken = res.body.token;
  });

  test('3. Fetch active product catalog with recipe ingredients', async () => {
    const res = await request(app).get('/api/products');
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const croissant = res.body.find((p) => p.name === 'Croissant Pur Beurre');
    expect(croissant).toBeDefined();
    expect(croissant.ingredients.length).toBeGreaterThan(0);
  });

  test('4. Fetch current ingredient stock levels', async () => {
    const res = await request(app).get('/api/ingredients');
    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);

    const flour = res.body.find((i) => i.name === 'Farine T45');
    expect(flour).toBeDefined();
    expect(parseFloat(flour.current_stock)).toEqual(100.0);
  });

  test('5. Produce batch of Croissants and verify atomic ingredient stock deduction', async () => {
    const productsRes = await request(app).get('/api/products');
    const croissant = productsRes.body.find((p) => p.name === 'Croissant Pur Beurre');
    const initialProductStock = croissant.stock_quantity;

    // Produce 10 Croissants
    // Recipe requires 0.08kg flour and 0.04kg butter per croissant
    // 10 croissants -> 0.8kg flour, 0.4kg butter
    const produceRes = await request(app)
      .post(`/api/products/${croissant.id}/produce`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ quantity: 10 });

    expect(produceRes.statusCode).toEqual(200);
    expect(produceRes.body.result.product.stock_quantity).toEqual(initialProductStock + 10);

    // Verify ingredient stock updated in database
    const ingredientsRes = await request(app).get('/api/ingredients');
    const flour = ingredientsRes.body.find((i) => i.name === 'Farine T45');
    const butter = ingredientsRes.body.find((i) => i.name === 'Beurre Doux 82%');

    expect(parseFloat(flour.current_stock)).toEqual(99.2); // 100.0 - 0.8
    expect(parseFloat(butter.current_stock)).toEqual(49.6); // 50.0 - 0.4
  });

  test('6. Create a sale and verify sales API returns the transaction', async () => {
    const productsRes = await request(app).get('/api/products');
    const croissant = productsRes.body.find((p) => p.name === 'Croissant Pur Beurre');
    expect(croissant).toBeDefined();

    const saleRes = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [{ product_id: croissant.id, quantity: 2 }],
        paymentMethod: 'CASH',
        customerName: 'Jean Dupont',
        customerPhone: '0123456789'
      });

    expect(saleRes.statusCode).toEqual(201);
    expect(saleRes.body.id).toBeDefined();
    expect(saleRes.body.items.length).toEqual(1);
    expect(parseFloat(saleRes.body.total_amount)).toBeGreaterThan(0);
    expect(saleRes.body.payments.length).toEqual(1);
    expect(saleRes.body.customer_name).toEqual('Jean Dupont');

    const saleGet = await request(app)
      .get(`/api/sales/${saleRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(saleGet.statusCode).toEqual(200);
    expect(saleGet.body.id).toEqual(saleRes.body.id);
    expect(saleGet.body.items.length).toEqual(1);
    expect(saleGet.body.payments.length).toEqual(1);
  });
});
