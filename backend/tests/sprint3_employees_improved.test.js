process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * Sprint 3 — Improved Employees module tests.
 *
 * Covers:
 *  1. Onboarding: POST /api/employees with email/password/role creates the
 *     user account + employee profile atomically in a single transaction.
 *  2. Validation: unique email, required password, valid role.
 *  3. Backward compatibility: the existing user_id link path still works.
 *  4. The new employee can log in with the created credentials.
 *  5. Leave approval/rejection (ADMIN-only) + employee cannot self-approve.
 *  6. Schedules & leaves list endpoints return employee names.
 */
describe('Sprint 3 — Improved Employees Module', () => {
  let adminToken;
  let employeeToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(adminLogin.statusCode).toEqual(200);
    adminToken = adminLogin.body.token;

    const empLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employe@bakery.com', password: 'password123' });
    expect(empLogin.statusCode).toEqual(200);
    employeeToken = empLogin.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  // --- 1. Onboarding: atomic user + employee creation ---
  test('POST /api/employees with email/password/role creates user + employee atomically', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Marie',
        last_name: 'Durand',
        email: 'marie.durand@bakery.com',
        password: 'secret123',
        role: 'CASHIER',
        phone: '+33 6 12 34 56 78',
        job_title: 'Caissière',
        hire_date: '2026-08-01',
        address: '5 rue des Lilas, Paris'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.first_name).toEqual('Marie');
    expect(res.body.last_name).toEqual('Durand');

    // Both records must exist and be linked
    const employee = await db('employees').where({ id: res.body.id }).first();
    expect(employee).toBeDefined();
    const user = await db('users').where({ id: employee.user_id }).first();
    expect(user).toBeDefined();
    expect(user.email).toEqual('marie.durand@bakery.com');
    expect(user.role).toEqual('CASHIER');
    // Password must be hashed, never stored in plaintext
    expect(user.password_hash).not.toEqual('secret123');
    expect(user.password_hash.length).toBeGreaterThan(20);
  });

  // --- 2. Validation: unique email ---
  test('POST /api/employees rejects a duplicate email', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Doublon',
        last_name: 'Test',
        email: 'marie.durand@bakery.com',
        password: 'secret123',
        role: 'EMPLOYEE'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('déjà utilisé');
  });

  // --- 2b. Validation: required password ---
  test('POST /api/employees rejects missing password', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Sans',
        last_name: 'MotDePasse',
        email: 'sans.mdp@bakery.com',
        role: 'EMPLOYEE'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('password');
  });

  // --- 2c. Validation: valid role ---
  test('POST /api/employees rejects an invalid role', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Role',
        last_name: 'Invalide',
        email: 'role.invalide@bakery.com',
        password: 'secret123',
        role: 'SUPERUSER'
      });

    expect(res.statusCode).toEqual(400);
    expect(res.body.error).toContain('role invalide');
  });

  // --- 3. Backward compatibility: user_id link path ---
  test('POST /api/employees with existing user_id still works (backward compatible)', async () => {
    const [newUserId] = await db('users').insert({
      name: 'Legacy User',
      email: 'legacy.user@bakery.com',
      password_hash: 'x',
      role: 'STOCK'
    }).returning('id');
    const uid = typeof newUserId === 'object' ? newUserId.id : newUserId;

    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        user_id: uid,
        first_name: 'Legacy',
        last_name: 'User',
        job_title: 'Stock'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.user_id).toEqual(uid);
  });

  // --- 4. New employee can log in ---
  test('Newly created employee can log in with the created credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'marie.durand@bakery.com', password: 'secret123' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toEqual('CASHIER');
    expect(res.body.user.name).toEqual('Marie Durand');
  });

  // --- 5. Leave approval/rejection (ADMIN-only) ---
  test('ADMIN can approve a pending leave request', async () => {
    // The seed creates a PENDING leave for the EMPLOYEE user
    const leavesRes = await request(app)
      .get('/api/employees/leaves')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(leavesRes.statusCode).toEqual(200);

    const pending = leavesRes.body.find((l) => l.status === 'PENDING');
    expect(pending).toBeDefined();

    const approveRes = await request(app)
      .put(`/api/employees/leaves/${pending.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });

    expect(approveRes.statusCode).toEqual(200);
    expect(approveRes.body.status).toEqual('APPROVED');
  });

  test('ADMIN can reject a pending leave request', async () => {
    const leavesRes = await request(app)
      .get('/api/employees/leaves')
      .set('Authorization', `Bearer ${adminToken}`);
    const pending = leavesRes.body.find((l) => l.status === 'PENDING');
    expect(pending).toBeDefined();

    const rejectRes = await request(app)
      .put(`/api/employees/leaves/${pending.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' });

    expect(rejectRes.statusCode).toEqual(200);
    expect(rejectRes.body.status).toEqual('REJECTED');
  });

  test('Non-ADMIN cannot change leave status (403)', async () => {
    const leavesRes = await request(app)
      .get('/api/employees/leaves')
      .set('Authorization', `Bearer ${adminToken}`);
    const anyLeave = leavesRes.body[0];
    expect(anyLeave).toBeDefined();

    const res = await request(app)
      .put(`/api/employees/leaves/${anyLeave.id}/status`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ status: 'APPROVED' });

    expect(res.statusCode).toEqual(403);
  });

  // --- 5b. Employee cannot self-approve (H-1) ---
  test('EMPLOYEE creating a leave is forced to PENDING (cannot self-approve)', async () => {
    const empProfile = await db('employees').where({ user_id: (await db('users').where({ email: 'employe@bakery.com' }).first()).id }).first();

    const res = await request(app)
      .post('/api/employees/leaves')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        employee_id: empProfile.id,
        start_date: '2026-12-01',
        end_date: '2026-12-03',
        reason: 'Test self-approve',
        status: 'APPROVED'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.status).toEqual('PENDING');
  });

  // --- 6. Schedules & leaves list with employee names ---
  test('GET /api/employees/schedules returns employee names', async () => {
    const res = await request(app)
      .get('/api/employees/schedules')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].employee_first_name).toBeDefined();
    expect(res.body[0].employee_last_name).toBeDefined();
  });

  test('GET /api/employees/leaves returns employee names and status', async () => {
    const res = await request(app)
      .get('/api/employees/leaves')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].employee_first_name).toBeDefined();
    expect(res.body[0].status).toBeDefined();
  });

  // --- 7. Sprint 1/2 compatibility sanity checks ---
  test('Sprint 1: products and ingredients still list correctly', async () => {
    const products = await request(app).get('/api/products');
    expect(products.statusCode).toEqual(200);
    expect(products.body.length).toBeGreaterThan(0);

    const ingredients = await request(app).get('/api/ingredients');
    expect(ingredients.statusCode).toEqual(200);
    expect(ingredients.body.length).toBeGreaterThan(0);
  });

  test('Sprint 2: sales metrics still work', async () => {
    const res = await request(app)
      .get('/api/sales/metrics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toEqual(200);
    expect(res.body.day).toBeDefined();
    expect(res.body.week).toBeDefined();
    expect(res.body.month).toBeDefined();
  });
});