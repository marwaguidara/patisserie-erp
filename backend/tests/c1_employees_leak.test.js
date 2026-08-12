process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * C-1 Regression: GET /api/employees must NEVER expose HR-private columns
 * (e.g. salary) to any authenticated role, even though the employees table
 * contains a salary column in the schema.
 */
describe('C-1: Employee list must not expose HR-private columns (salary)', () => {
  let authToken;
  let cashierUserId;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    // Use a DEDICATED user (not the seeded cashier) so this test is
    // independent of the seed's employee profiles. The seed now creates a
    // cashier employee profile; reusing that user would make this test
    // order-dependent and violate the 1:1 user<->employee invariant.
    const [newUserId] = await db('users').insert({
      name: 'C1 Test Cashier',
      email: 'c1.test@bakery.com',
      password_hash: await require('bcryptjs').hash('password123', 10),
      role: 'CASHIER'
    }).returning('id');
    cashierUserId = typeof newUserId === 'object' ? newUserId.id : newUserId;

    // Link an employee profile to this dedicated user and set a real
    // salary value to prove the leak would be visible if selected.
    const [empId] = await db('employees').insert({
      user_id: cashierUserId,
      first_name: 'Vendeuse',
      last_name: 'Caissière',
      phone: '+33600000000',
      job_title: 'CASHIER',
      hire_date: '2026-01-01',
      address: '1 rue de la Boulangerie',
      salary: 42000.00
    }).returning('id');
    const employeeId = typeof empId === 'object' ? empId.id : empId;
    expect(employeeId).toBeDefined();

    // Login as a non-admin role (CASHIER) to prove a lesser-privileged
    // role cannot read salary through this endpoint.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'c1.test@bakery.com', password: 'password123' });

    expect(login.statusCode).toEqual(200);
    authToken = login.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('GET /api/employees returns 200 and never exposes salary to any authenticated role', async () => {
    const res = await request(app)
      .get('/api/employees')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.statusCode).toEqual(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((emp) => !('salary' in emp))).toBe(true);
  });

  test('GET /api/employees retains all fields required by the frontend', async () => {
    const res = await request(app)
      .get('/api/employees')
      .set('Authorization', `Bearer ${authToken}`);

    const emp = res.body.find((e) => e.user_id === cashierUserId);
    expect(emp).toBeDefined();
    expect(emp.first_name).toEqual('Vendeuse');
    expect(emp.last_name).toEqual('Caissière');
    expect(emp.user_email).toEqual('c1.test@bakery.com');
    expect(emp.user_role).toEqual('CASHIER');
    expect(emp.job_title).toEqual('CASHIER');
    expect(emp.phone).toEqual('+33600000000');
    expect(emp.hire_date).toEqual('2026-01-01');
    expect(emp.address).toEqual('1 rue de la Boulangerie');
  });
});