process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

describe('Sprint 1 - Complete Audit E2E Suite (12 Steps)', () => {
  let authToken;
  let categoryId;
  let ingredientId;
  let productId;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('Étape 1: Login (Authentification JWT)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@bakery.com',
        password: 'password123'
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toEqual('ADMIN');
    authToken = res.body.token;
  });

  test('Étape 2: Création catégorie', async () => {
    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Tartelettes Artisanales',
        description: 'Gammes de tartelettes fraîches du jour'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toEqual('Tartelettes Artisanales');
    categoryId = res.body.id;
  });

  test('Étape 3: Création ingrédient', async () => {
    const res = await request(app)
      .post('/api/ingredients')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Pâte Sablée Pur Beurre',
        unit: 'unité',
        current_stock: 0,
        minimum_stock: 10.0,
        cost_per_unit: 0.80,
        expiration_date: '2026-11-30'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toEqual('Pâte Sablée Pur Beurre');
    ingredientId = res.body.id;
  });

  test('Étape 4: Ajout de stock (Mouvement IN)', async () => {
    const res = await request(app)
      .post(`/api/ingredients/${ingredientId}/movement`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        movement_type: 'IN',
        quantity: 50.0,
        reason: 'Réception lot fonds de tarte',
        expiration_date: '2026-11-30'
      });

    expect(res.statusCode).toEqual(200);
    expect(parseFloat(res.body.ingredient.current_stock)).toEqual(50.0);
  });

  test('Étape 5: Création produit', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Tartelette Citron Meringuée',
        description: 'Tartelette au crémeux citron et meringue italienne',
        price: 3.50,
        category_id: categoryId,
        stock_quantity: 0
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toEqual('Tartelette Citron Meringuée');
    productId = res.body.id;
  });

  test('Étape 6: Création recette (Association ingrédients)', async () => {
    const res = await request(app)
      .post(`/api/products/${productId}/recipe`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        items: [
          {
            ingredient_id: ingredientId,
            quantity_required: 1.0 // 1 fonds de pâte per tartelette
          }
        ]
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.recipe.length).toEqual(1);
    expect(res.body.recipe[0].ingredient_id).toEqual(ingredientId);
  });

  test('Étape 7: Fabrication (Déduction atomique de stock)', async () => {
    // Produce 30 tartelettes -> consumes 30 units of Pâte Sablée
    const res = await request(app)
      .post(`/api/products/${productId}/produce`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        quantity: 30
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.result.produced_quantity).toEqual(30);
    expect(res.body.result.product.stock_quantity).toEqual(30);
  });

  test('Étape 8: Vérification baisse du stock', async () => {
    const res = await request(app).get(`/api/ingredients/${ingredientId}`);
    expect(res.statusCode).toEqual(200);
    const stock = parseFloat(res.body.ingredient.current_stock);
    // Started at 50.0, used 30.0 -> 20.0 remaining
    expect(stock).toEqual(20.0);
  });

  test('Étape 9: Détection stock faible (Alerte)', async () => {
    // Produce 15 more tartelettes -> consumes 15 units
    // Stock drops from 20.0 to 5.0
    // 5.0 is LESS than minimum_stock 10.0 -> Triggers alert
    const res = await request(app)
      .post(`/api/products/${productId}/produce`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        quantity: 15
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.result.alerts.length).toBeGreaterThan(0);
    const alertItem = res.body.result.alerts.find((a) => a.id === ingredientId);
    expect(alertItem).toBeDefined();
    expect(parseFloat(alertItem.current_stock)).toEqual(5.0);
  });

  test('Étape 10: Modification produit', async () => {
    const res = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Tartelette Citron Meringuée Biologique',
        price: 3.90
      });

    expect(res.statusCode).toEqual(200);
    expect(res.body.name).toEqual('Tartelette Citron Meringuée Biologique');
    expect(parseFloat(res.body.price)).toEqual(3.90);
  });

  test('Étape 11: Suppression produit', async () => {
    const res = await request(app)
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.statusCode).toEqual(200);

    const getRes = await request(app).get(`/api/products/${productId}`);
    expect(getRes.statusCode).toEqual(404);
  });

  test('Étape 12: Vérification alertes globales', async () => {
    const res = await request(app).get('/api/stocks/alerts');
    expect(res.statusCode).toEqual(200);
    expect(res.body.low_stock_count).toBeGreaterThan(0);

    const alertIng = res.body.low_stock.find((i) => i.id === ingredientId);
    expect(alertIng).toBeDefined();
    expect(parseFloat(alertIng.current_stock)).toEqual(5.0);
  });
});
