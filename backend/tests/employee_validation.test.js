process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * Employee validation (Zod) — POST /api/employees + PUT /api/employees/:id.
 *
 * Proves that createEmployeeSchema / updateEmployeeSchema secure the employee
 * endpoints: malformed payloads are rejected with 400 before any business
 * logic runs, while valid requests (Mode A link, Mode B onboarding, patches)
 * still produce the exact same outcomes as before.
 */
describe('Employee validation (Zod) — POST + PUT', () => {
  let adminToken;
  let targetEmployeeId;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(login.statusCode).toEqual(200);
    adminToken = login.body.token;

    // Create a target employee (Mode B onboarding) for the PUT tests.
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Update',
        last_name: 'Target',
        email: 'update.target@bakery.com',
        password: 'secret123',
        role: 'CASHIER'
      });
    expect(res.statusCode).toEqual(201);
    targetEmployeeId = res.body.id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  // ── POST /api/employees — validation rejected before handler ──

  test('POST missing first_name -> 400', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ last_name: 'X', email: 'missing.fn@bakery.com', password: 'p', role: 'EMPLOYEE' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/first_name/i);
  });

  test('POST missing last_name -> 400', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'X', email: 'missing.ln@bakery.com', password: 'p', role: 'EMPLOYEE' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/last_name/i);
  });

  test('POST first_name as number -> 400', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 123, last_name: 'X', email: 'num.fn@bakery.com', password: 'p', role: 'EMPLOYEE' });

    expect(res.statusCode).toEqual(400);
  });

  test('POST invalid email format -> 400', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'X', last_name: 'X', email: 'not-an-email', password: 'p', role: 'EMPLOYEE' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toMatch(/email/i);
  });

  // ── POST — conditional business logic stays in the handler (unchanged) ──

  test('POST missing password (Mode B) -> 400 from handler, error mentions password', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'Sans', last_name: 'MDP', email: 'sansmdp@bakery.com', role: 'EMPLOYEE' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('password');
  });

  test('POST invalid role -> 400 from handler, error mentions "role invalide"', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'X',
        last_name: 'X',
        email: 'badrole@bakery.com',
        password: 'p',
        role: 'SUPERUSER'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('role invalide');
  });

  // ── POST — valid requests still succeed (no regression) ──

  test('POST valid Mode B creation -> 201', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Valid',
        last_name: 'Create',
        email: 'valid.create@bakery.com',
        password: 'pass123',
        role: 'EMPLOYEE'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
  });

  test('POST valid Mode A (user_id link) still works -> 201', async () => {
    const [u] = await db('users')
      .insert({
        name: 'Mode A User',
        email: 'modea@bakery.com',
        password_hash: 'x',
        role: 'STOCK'
      })
      .returning('id');
    const uid = typeof u === 'object' ? u.id : u;

    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_id: uid, first_name: 'ModeA', last_name: 'Link', job_title: 'Stock' });

    expect(res.statusCode).toEqual(201);
    expect(res.body.user_id).toEqual(uid);
  });

  // ── PUT /api/employees/:id ──

  test('PUT valid partial update -> 200', async () => {
    const res = await request(app)
      .put(`/api/employees/${targetEmployeeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '02 02 02 02 02' });

    expect(res.statusCode).toEqual(200);
  });

  test('PUT first_name as number -> 400', async () => {
    const res = await request(app)
      .put(`/api/employees/${targetEmployeeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 123 });

    expect(res.statusCode).toEqual(400);
  });

  test('PUT extra unknown fields are stripped (no break) -> 200', async () => {
    const res = await request(app)
      .put(`/api/employees/${targetEmployeeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '03 03 03 03 03', malicious: 'drop table; --' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.phone).toEqual('03 03 03 03 03');
  });

  test('PUT empty body -> 200 (no-op, returns current record)', async () => {
    const res = await request(app)
      .put(`/api/employees/${targetEmployeeId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.statusCode).toEqual(200);
  });
});
