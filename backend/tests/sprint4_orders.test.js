process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

jest.setTimeout(30000);

describe('Sprint 4 — Purchase & Customer Orders E2E Suite', () => {
  let adminToken;
  let prodToken;
  let cashierToken;
  let employeeToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    // Login Admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(adminRes.statusCode).toEqual(200);
    adminToken = adminRes.body.token;

    // Login Production
    const prodRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'production@bakery.com', password: 'password123' });
    expect(prodRes.statusCode).toEqual(200);
    prodToken = prodRes.body.token;

    // Login Cashier
    const cashierRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier@bakery.com', password: 'password123' });
    expect(cashierRes.statusCode).toEqual(200);
    cashierToken = cashierRes.body.token;

    // Login Employee
    const empRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employe@bakery.com', password: 'password123' });
    expect(empRes.statusCode).toEqual(200);
    employeeToken = empRes.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('Purchase Orders API', () => {
    let createdPoId;
    let supplier;
    let ingredient;

    beforeAll(async () => {
      supplier = await db('suppliers').first();
      ingredient = await db('ingredients').first();
      expect(supplier).toBeDefined();
      expect(ingredient).toBeDefined();
    });

    test('POST /api/purchase-orders — create a PO in DRAFT status', async () => {
      const payload = {
        supplier_id: supplier.id,
        items: [
          {
            ingredient_id: ingredient.id,
            quantity_ordered: 50.0,
            unit_cost: 2.50
          }
        ]
      };

      const res = await request(app)
        .post('/api/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.statusCode).toEqual(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toEqual('DRAFT');
      expect(parseFloat(res.body.total_cost)).toEqual(125.00);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].ingredient_id).toEqual(ingredient.id);

      createdPoId = res.body.id;
    });

    test('GET /api/purchase-orders — list purchase orders', async () => {
      const res = await request(app)
        .get('/api/purchase-orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('GET /api/purchase-orders/:id — fetch PO detail', async () => {
      const res = await request(app)
        .get(`/api/purchase-orders/${createdPoId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.id).toEqual(createdPoId);
      expect(res.body.items).toHaveLength(1);
    });

    test('PUT /api/purchase-orders/:id/status — transition DRAFT -> ORDERED', async () => {
      const res = await request(app)
        .put(`/api/purchase-orders/${createdPoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ORDERED' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('ORDERED');
    });

    test('PUT /api/purchase-orders/:id/status — transition ORDERED -> RECEIVED increments stock', async () => {
      const initialStock = parseFloat(ingredient.current_stock);

      const res = await request(app)
        .put(`/api/purchase-orders/${createdPoId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'RECEIVED' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('RECEIVED');
      expect(res.body.received_at).toBeDefined();

      // Check stock increment in DB
      const updatedIngredient = await db('ingredients').where({ id: ingredient.id }).first();
      expect(parseFloat(updatedIngredient.current_stock)).toEqual(initialStock + 50.0);

      // Verify stock_movements trace
      const movement = await db('stock_movements')
        .where({ ingredient_id: ingredient.id, movement_type: 'IN' })
        .orderBy('id', 'desc')
        .first();
      expect(movement).toBeDefined();
      expect(movement.reason).toContain(`Réception commande fournisseur #${createdPoId}`);
    });

    test('POST /api/purchase-orders — cashiers cannot create POs (403)', async () => {
      const payload = {
        supplier_id: supplier.id,
        items: [{ ingredient_id: ingredient.id, quantity_ordered: 10, unit_cost: 1 }]
      };
      const res = await request(app)
        .post('/api/purchase-orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send(payload);

      expect(res.statusCode).toEqual(403);
    });
  });

  describe('Customer Orders API', () => {
    let createdCoId;
    let product;

    beforeAll(async () => {
      product = await db('products').first();
      expect(product).toBeDefined();
    });

    test('POST /api/customer-orders — create customer order (PENDING)', async () => {
      const payload = {
        customer_name: 'Marie Curie',
        customer_phone: '+33 6 99 88 77 66',
        delivery_date: '2026-08-15',
        special_instructions: 'Livrer avant 10h',
        items: [
          {
            product_id: product.id,
            quantity: 5
          }
        ]
      };

      const res = await request(app)
        .post('/api/customer-orders')
        .set('Authorization', `Bearer ${cashierToken}`)
        .send(payload);

      expect(res.statusCode).toEqual(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.customer_name).toEqual('Marie Curie');
      expect(res.body.status).toEqual('PENDING');
      expect(res.body.items).toHaveLength(1);
      expect(parseFloat(res.body.total_price)).toEqual(parseFloat(product.price) * 5);

      createdCoId = res.body.id;
    });

    test('GET /api/customer-orders — list customer orders', async () => {
      const res = await request(app)
        .get('/api/customer-orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    test('GET /api/customer-orders/:id — get CO detail', async () => {
      const res = await request(app)
        .get(`/api/customer-orders/${createdCoId}`)
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.statusCode).toEqual(200);
      expect(res.body.id).toEqual(createdCoId);
      expect(res.body.items[0].product_name).toEqual(product.name);
    });

    test('PUT /api/customer-orders/:id/status — update status to IN_PRODUCTION', async () => {
      const res = await request(app)
        .put(`/api/customer-orders/${createdCoId}/status`)
        .set('Authorization', `Bearer ${prodToken}`)
        .send({ status: 'IN_PRODUCTION' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.status).toEqual('IN_PRODUCTION');
    });

    test('GET /api/customer-orders — regular employee access is denied (403)', async () => {
      const res = await request(app)
        .get('/api/customer-orders')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.statusCode).toEqual(403);
    });
  });
});
