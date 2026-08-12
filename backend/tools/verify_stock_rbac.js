// Verify STOCK role authentication + RBAC enforcement (non-destructive).
// Only inserts the STOCK seed user if missing; never wipes existing data.
const bcrypt = require('bcryptjs');
const db = require('../src/db/connection');
const app = require('../src/app');
const request = require('supertest');

(async () => {
  const password = 'password123';
  const existing = await db('users').where({ email: 'stock@bakery.com' }).first();
  if (!existing) {
    const hash = await bcrypt.hash(password, 10);
    await db('users').insert({
      name: 'Gestionnaire Stock',
      email: 'stock@bakery.com',
      password_hash: hash,
      role: 'STOCK'
    });
    console.log('STOCK user created (was missing).');
  } else {
    console.log('STOCK user already exists (role=' + existing.role + ').');
  }

  const login = await request(app).post('/api/auth/login').send({ email: 'stock@bakery.com', password });
  console.log('LOGIN /api/auth/login -> status:', login.status, '| role:', login.body.user && login.body.user.role);
  const token = login.body && login.body.token;

  const allowed = await request(app).get('/api/suppliers').set('Authorization', 'Bearer ' + token);
  console.log('GET /api/suppliers (STOCK allowed)          -> status:', allowed.status);

  const denied = await request(app).get('/api/customer-orders').set('Authorization', 'Bearer ' + token);
  console.log('GET /api/customer-orders (STOCK forbidden)   -> status:', denied.status);

  const emails = ['admin@bakery.com', 'production@bakery.com', 'cashier@bakery.com', 'employe@bakery.com', 'stock@bakery.com'];
  console.log('--- Seeded users present ---');
  for (const e of emails) {
    const u = await db('users').where({ email: e }).first();
    console.log('  ' + e + ': ' + (u ? u.role : 'MISSING'));
  }

  await db.destroy();
})().catch(async (e) => {
  console.error('VERIFY ERROR:', e);
  await db.destroy();
  process.exit(1);
});
