process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * H-2 Regression: Deleting a supplier with purchase orders must be refused,
 * so the schema-level CASCADE (purchase_orders.supplier_id -> suppliers.id)
 * can never silently destroy order history through the API.
 */
describe('H-2: Supplier deletion is blocked when purchase orders exist', () => {
  let authToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });

    expect(login.statusCode).toEqual(200);
    authToken = login.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('DELETE /api/suppliers/:id returns 400 and preserves the purchase order when POs exist', async () => {
    // Create a supplier with NO ingredients so only the purchase-order guard applies
    const [supplierInsert] = await db('suppliers').insert({
      name: 'Fournisseur PO Test',
      contact_person: 'Test',
      email: 'po-test@example.com'
    }).returning('id');
    const supplierId = typeof supplierInsert === 'object' ? supplierInsert.id : supplierInsert;

    // Insert a purchase order referencing the supplier
    const [poInsert] = await db('purchase_orders').insert({
      supplier_id: supplierId,
      status: 'ORDERED',
      total_cost: 150.00
    }).returning('id');
    const poId = typeof poInsert === 'object' ? poInsert.id : poInsert;
    expect(poId).toBeDefined();

    const res = await request(app)
      .delete(`/api/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('purchase_orders');

    // The supplier and the purchase order must both still exist
    const supplierAfter = await db('suppliers').where({ id: supplierId }).first();
    expect(supplierAfter).toBeDefined();
    const poAfter = await db('purchase_orders').where({ id: poId }).first();
    expect(poAfter).toBeDefined();
    expect(poAfter.supplier_id).toEqual(supplierId);
  });

  test('DELETE /api/suppliers/:id still succeeds for a supplier with no POs and no ingredients', async () => {
    const [supplierInsert] = await db('suppliers').insert({
      name: 'Fournisseur Supprimable',
      contact_person: 'Test',
      email: 'deletable@example.com'
    }).returning('id');
    const supplierId = typeof supplierInsert === 'object' ? supplierInsert.id : supplierInsert;

    const res = await request(app)
      .delete(`/api/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.statusCode).toEqual(200);

    const supplierAfter = await db('suppliers').where({ id: supplierId }).first();
    expect(supplierAfter).toBeUndefined();
  });

  test('DELETE /api/suppliers/:id still returns 400 when ingredients are attached (existing guard intact)', async () => {
    // The seeded supplier has ingredients attached
    const seeded = await db('suppliers').where({ name: 'Moulins & Crémerie de France' }).first();
    expect(seeded).toBeDefined();

    const res = await request(app)
      .delete(`/api/suppliers/${seeded.id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('ingrédients');

    const supplierAfter = await db('suppliers').where({ id: seeded.id }).first();
    expect(supplierAfter).toBeDefined();
  });
});