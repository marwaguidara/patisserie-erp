process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

describe('Sprint 1 - E2E Scenario (Produits + Stocks)', () => {
  let authToken;
  let ingredientId;
  let categoryId;
  let productId;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    // Authenticate as Admin
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@bakery.com',
        password: 'password123'
      });

    expect(loginRes.statusCode).toEqual(200);
    authToken = loginRes.body.token;

    // Fetch existing category ID
    const catRes = await request(app).get('/api/categories');
    categoryId = catRes.body[0].id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('Étape 1: Créer un ingrédient', async () => {
    const res = await request(app)
      .post('/api/ingredients')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: "Poudre d'Amande",
        unit: 'kg',
        current_stock: 0,
        minimum_stock: 5.0,
        cost_per_unit: 15.0,
        expiration_date: '2026-12-31'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toEqual("Poudre d'Amande");
    ingredientId = res.body.id;
  });

  test('Étape 2: Créer un produit', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Macaron Framboise',
        description: 'Macaron artisanal à la framboise',
        price: 2.50,
        category_id: categoryId,
        stock_quantity: 0
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toEqual('Macaron Framboise');
    productId = res.body.id;
  });

  test('Étape 3: Associer une recette', async () => {
    const res = await request(app)
      .post(`/api/products/${productId}/recipe`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          {
            ingredient_id: ingredientId,
            quantity_required: 0.05 // 50g per macaron
          }
        ]
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.recipe.length).toEqual(1);
    expect(res.body.recipe[0].ingredient_id).toEqual(ingredientId);
    expect(parseFloat(res.body.recipe[0].quantity_required)).toEqual(0.05);
  });

  test('Étape 4: Ajouter du stock (Mouvement IN)', async () => {
    const res = await request(app)
      .post(`/api/ingredients/${ingredientId}/movement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        movement_type: 'IN',
        quantity: 10.0,
        reason: 'Achat initial amandes',
        expiration_date: '2026-12-31'
      });

    expect(res.statusCode).toEqual(200);
    expect(parseFloat(res.body.ingredient.current_stock)).toEqual(10.0);
  });

  test('Étape 5: Déclarer une fabrication', async () => {
    // Produce 100 macarons -> consumes 100 * 0.05kg = 5.0kg
    const res = await request(app)
      .post(`/api/products/${productId}/produce`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        quantity: 100
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.result.produced_quantity).toEqual(100);
    expect(res.body.result.product.stock_quantity).toEqual(100);
  });

  test('Étape 6: Vérifier la diminution du stock', async () => {
    const res = await request(app).get(`/api/ingredients/${ingredientId}`);
    expect(res.statusCode).toEqual(200);
    const stock = parseFloat(res.body.ingredient.current_stock);
    // Started at 10.0kg, used 5.0kg -> 5.0kg remaining
    expect(stock).toEqual(5.0);
  });

  test('Étape 7: Déclencher une alerte de seuil bas', async () => {
    // Produce 50 more macarons -> consumes 50 * 0.05kg = 2.5kg
    // Stock drops from 5.0kg to 2.5kg
    // 2.5kg is LESS than minimum_stock 5.0kg -> Triggers low stock alert
    const res = await request(app)
      .post(`/api/products/${productId}/produce`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        quantity: 50
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.result.alerts.length).toBeGreaterThan(0);
    const lowStockAlert = res.body.result.alerts.find((a) => a.id === ingredientId);
    expect(lowStockAlert).toBeDefined();
    expect(parseFloat(lowStockAlert.current_stock)).toEqual(2.5);
  });

  test('Étape 8: Vérifier le résultat dans les endpoints d\'alertes', async () => {
    const alertsRes = await request(app).get('/api/stocks/alerts');
    expect(alertsRes.statusCode).toEqual(200);
    expect(alertsRes.body.low_stock_count).toBeGreaterThan(0);

    const ingAlert = alertsRes.body.low_stock.find((i) => i.id === ingredientId);
    expect(ingAlert).toBeDefined();
    expect(parseFloat(ingAlert.current_stock)).toBeLessThanOrEqual(parseFloat(ingAlert.minimum_stock));

    const ingredientsList = await request(app).get('/api/ingredients?status=low_stock');
    expect(ingredientsList.statusCode).toEqual(200);
    const found = ingredientsList.body.find((i) => i.id === ingredientId);
    expect(found).toBeDefined();
    expect(found.is_low_stock).toBe(true);
  });
});
