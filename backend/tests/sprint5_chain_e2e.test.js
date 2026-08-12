process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

jest.setTimeout(30000);

/**
 * Sprint 5 — Mandatory cross-module end-to-end scenario.
 *
 * This is THE acceptance test required by the cahier des charges (Sprint 4
 * "Intégration obligatoire" / Sprint 5 consolidation). It proves the whole
 * vertical slice is connected, through the real API and the real database:
 *
 *   Supplier
 *     -> Purchase Order (create + ORDERED)
 *     -> Delivery (RECEIVED)          -> ingredient stock INCREASES
 *     -> Production                   -> ingredient stock DECREASES, product stock INCREASES
 *     -> Sale                          -> finished-good stock DECREASES, CA/margin persisted
 *     -> Revenue Update               -> /sales/metrics reflects the new revenue
 *
 * The scenario builds its own Supplier, Ingredient, Product and Recipe so it is
 * fully self-contained and does not depend on seed values.
 */
describe('Sprint 5 — Mandatory cross-module chain (Supplier → PO → Delivery → Stock → Production → Sale → Revenue)', () => {
  let adminToken;

  let supplierId;
  let ingredientId;
  let productId;

  let poId;
  let revenueBefore;
  let countBefore;
  const purchaseQty = 100.0; // kg of ingredient bought
  const lotCost = 1.00; // € / kg
  const produceQty = 20; // units produced
  const recipeQty = 0.1; // kg of ingredient required per unit
  const productPrice = 2.50; // € per unit
  const saleQty = 5; // units sold

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(login.statusCode).toEqual(200);
    expect(login.body.user.role).toEqual('ADMIN');
    adminToken = login.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('1. Create a supplier', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Fournisseur Chaîne E2E',
        contact_person: 'Test Sprint 5',
        email: 'chain-e2e@example.com',
        phone: '0123456789',
        address: '1 rue du Test',
        lead_time: 3,
        quality: 'B',
        rating: 4
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    supplierId = res.body.id;
  });

  test('2. Create an ingredient (needs supply)', async () => {
    const res = await request(app)
      .post('/api/ingredients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Amande Moulue Chaîne E2E',
        unit: 'kg',
        current_stock: 0,
        minimum_stock: 10.0,
        cost_per_unit: lotCost,
        expiration_date: '2026-12-31'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    expect(parseFloat(res.body.current_stock)).toEqual(0);
    ingredientId = res.body.id;
  });

  test('3. Create a product and its recipe (consumes the ingredient)', async () => {
    const productRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Financier Chaîne E2E',
        description: 'Produit fabriqué uniquement avec l’ingrédient acheté via la chaîne',
        price: productPrice,
        stock_quantity: 0
      });

    expect(productRes.statusCode).toEqual(201);
    productId = productRes.body.id;

    const recipeRes = await request(app)
      .post(`/api/products/${productId}/recipe`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [{ ingredient_id: ingredientId, quantity_required: recipeQty }]
      });

    expect(recipeRes.statusCode).toEqual(200);
    expect(recipeRes.body.recipe).toHaveLength(1);
    expect(recipeRes.body.recipe[0].ingredient_id).toEqual(ingredientId);
  });
  test('4. Create a purchase order in DRAFT', async () => {
    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        supplier_id: supplierId,
        items: [
          { ingredient_id: ingredientId, quantity_ordered: purchaseQty, unit_cost: lotCost }
        ]
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.status).toEqual('DRAFT');
    expect(parseFloat(res.body.total_cost)).toBeCloseTo(purchaseQty * lotCost, 2);
    poId = res.body.id;
  });

  test('5. Validate the purchase order (ORDERED)', async () => {
    const res = await request(app)
      .put(`/api/purchase-orders/${poId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ORDERED' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ORDERED');
  });

  test('6. Deliver the purchase order (RECEIVED) → ingredient stock INCREASES', async () => {
    const res = await request(app)
      .put(`/api/purchase-orders/${poId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RECEIVED' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('RECEIVED');
    expect(res.body.received_at).toBeDefined();

    // Stock increased from 0 to purchaseQty
    const ing = await db('ingredients').where({ id: ingredientId }).first();
    expect(parseFloat(ing.current_stock)).toBeCloseTo(purchaseQty, 3);

    // A stock movement IN was recorded (traceability)
    const movement = await db('stock_movements')
      .where({ ingredient_id: ingredientId, movement_type: 'IN' })
      .orderBy('id', 'desc')
      .first();
    expect(movement).toBeDefined();
    expect(parseFloat(movement.quantity)).toBeCloseTo(purchaseQty, 3);
    expect(movement.reason).toContain(`Réception commande fournisseur #${poId}`);
  });

  test('7. Produce with the delivered stock → ingredient DOWN, product UP', async () => {
    const res = await request(app)
      .post(`/api/products/${productId}/produce`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantity: produceQty });

    expect(res.statusCode).toEqual(200);
    expect(res.body.result.produced_quantity).toEqual(produceQty);
    expect(parseInt(res.body.result.product.stock_quantity, 10)).toEqual(produceQty);

    const ing = await db('ingredients').where({ id: ingredientId }).first();
    expect(parseFloat(ing.current_stock)).toBeCloseTo(purchaseQty - produceQty * recipeQty, 3);
  });

  test('8. Sell the produced goods → finished-good stock DOWN, revenue/margin persisted', async () => {
    // Revenue baseline taken BEFORE the sale (so the delta proves the update)
    const metricsBefore = await request(app)
      .get('/api/sales/metrics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(metricsBefore.statusCode).toEqual(200);
    revenueBefore = parseFloat(metricsBefore.body.month.total_revenue || 0);
    countBefore = parseInt(metricsBefore.body.month.sales_count || 0, 10);

    const saleRes = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        items: [{ product_id: productId, quantity: saleQty }],
        paymentMethod: 'CASH',
        customerName: 'Client Chaîne E2E'
      });

    expect(saleRes.statusCode).toEqual(201);
    expect(saleRes.body.items).toHaveLength(1);
    expect(parseFloat(saleRes.body.total_amount)).toBeCloseTo(productPrice * saleQty, 2);
    expect(parseFloat(saleRes.body.total_margin)).toBeGreaterThan(0);
    expect(saleRes.body.status).toEqual('PAID');
    expect(saleRes.body.payments).toHaveLength(1);

    // Cost basis: recipeQty kg * lotCost per kg = 0.1 €/unit → margin = (2.50 - 0.10) * 5
    const item = saleRes.body.items[0];
    expect(parseFloat(item.cost_per_unit)).toBeCloseTo(recipeQty * lotCost, 4);
    expect(parseFloat(item.margin)).toBeCloseTo((productPrice - recipeQty * lotCost) * saleQty, 2);

    // Finished-good stock decreased from produceQty to produceQty - saleQty
    const product = await db('products').where({ id: productId }).first();
    expect(parseInt(product.stock_quantity, 10)).toEqual(produceQty - saleQty);
  });

  test('9. Revenue update — /sales/metrics reflects the sale', async () => {
    const expected = productPrice * saleQty;

    const after = await request(app)
      .get('/api/sales/metrics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.statusCode).toEqual(200);

    const afterRevenue = parseFloat(after.body.month.total_revenue);
    const afterCount = parseInt(after.body.month.sales_count, 10);

    expect(afterRevenue - revenueBefore).toBeCloseTo(expected, 2);
    expect(afterCount - countBefore).toEqual(1);

    // The product appears among best sellers (top_products)
    const inTop = (after.body.top_products || []).some(
      (p) => p.id === productId && parseFloat(p.revenue) >= expected
    );
    expect(inTop).toBe(true);
  });
});