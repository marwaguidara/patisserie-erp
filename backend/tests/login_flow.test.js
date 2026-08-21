process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * Login flow — free-typed email/password against the existing POST /api/auth/login.
 *
 * These tests prove the existing route accepts a full email string submitted by
 * the new login form (no <select> anymore) and returns a clean error on bad
 * credentials — no duplication of the route, no JWT logic change.
 */
describe('POST /api/auth/login (connexion par email libre)', () => {
  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('connexion avec un email saisi librement (pas via un select) -> 200 + token', async () => {
    // The email is provided as a free string exactly like the new form does.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toEqual('admin@bakery.com');
    expect(res.body.user.role).toEqual('ADMIN');
  });

  test('connexion avec un mauvais mot de passe -> 401 + message clair, pas de crash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cashier@bakery.com', password: 'mauvais-mot-de-passe' });

    expect(res.statusCode).toEqual(401);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error).toEqual('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('connexion avec un email inconnu -> 401 (même réponse, pas de fuite)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@bakery.com', password: 'password123' });

    expect(res.statusCode).toEqual(401);
  });
});