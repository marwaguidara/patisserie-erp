process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * POST /api/auth/login — Zod input validation (Sprint 0, Step 1).
 *
 * Proves that the new validate(loginSchema) middleware secures the login
 * route: malformed / missing payloads are rejected with 400 before any
 * business logic runs, while valid credentials still authenticate normally.
 */
describe('POST /api/auth/login — input validation', () => {
  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('valid credentials -> 200 + token (no regression)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toEqual('admin@bakery.com');
  });

  test('missing email AND password -> 400', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/Validation failed/);
  });

  test('missing password only -> 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/password/);
  });

  test('missing email only -> 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'password123' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('invalid email format -> 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('non-string password (number) -> 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 123456 });

    expect(res.statusCode).toEqual(400);
  });

  test('extra unknown fields are stripped, login still works -> 200', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123', injected: 'hack' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
  });

  test('empty string body ({}) still treated as missing -> 400 (not 500)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send();

    expect(res.statusCode).toEqual(400);
  });

  test('wrong password still returns 401 (validation passes, auth fails)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'wrong-password' });

    expect(res.statusCode).toEqual(401);
    expect(res.body.error).toBeDefined();
  });
});
