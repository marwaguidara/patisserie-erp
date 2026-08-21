process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * POST /api/employees/leaves/me — Self-service leave request.
 *
 * Security model verified:
 *  - the target employee is ALWAYS resolved from req.user.id (never from the body);
 *  - status is ALWAYS forced to 'PENDING' (an employee can never self-approve);
 *  - the existing admin route POST /api/employees/leaves still works unchanged.
 */
describe('POST /api/employees/leaves/me', () => {
  let employeToken;
  let adminToken;

  // Local date helper (avoid UTC-shift producing a wrong calendar day near midnight).
  function fmtDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function futureDate(daysAhead) {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    return fmtDate(d);
  }

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const empLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employe@bakery.com', password: 'password123' });
    expect(empLogin.statusCode).toEqual(200);
    employeToken = empLogin.body.token;

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(adminLogin.statusCode).toEqual(200);
    adminToken = adminLogin.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('start_date > end_date -> 400', async () => {
    const res = await request(app)
      .post('/api/employees/leaves/me')
      .set('Authorization', `Bearer ${employeToken}`)
      .send({ start_date: futureDate(7), end_date: futureDate(2), reason: 'Inversé' });

    expect(res.statusCode).toEqual(400);
  });

  test('date dans le passé -> 400', async () => {
    const res = await request(app)
      .post('/api/employees/leaves/me')
      .set('Authorization', `Bearer ${employeToken}`)
      .send({ start_date: '2020-01-01', end_date: '2020-01-10', reason: 'passé' });

    expect(res.statusCode).toEqual(400);
  });

  test('nominal -> 201, status forcé à PENDING même si le client envoie APPROVED', async () => {
    const res = await request(app)
      .post('/api/employees/leaves/me')
      .set('Authorization', `Bearer ${employeToken}`)
      .send({
        start_date: futureDate(10),
        end_date: futureDate(12),
        reason: 'Vacances',
        status: 'APPROVED' // self-approval attempt, must be ignored
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.status).toEqual('PENDING');
    expect(res.body.employee_id).toBeDefined();
  });

  test("employee_id ne peut pas être falsifié via le body (ciblage d'un autre employé ignoré)", async () => {
    // Self employee id (the authenticated employe@bakery.com)
    const self = await request(app)
      .get('/api/employees/profile')
      .set('Authorization', `Bearer ${employeToken}`);
    expect(self.statusCode).toEqual(200);
    const selfEmployeeId = self.body.id;

    // Admin employee id — a forged target in the body that must be ignored.
    const adminProfile = await request(app)
      .get('/api/employees/profile')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminEmployeeId = adminProfile.body.id;

    const res = await request(app)
      .post('/api/employees/leaves/me')
      .set('Authorization', `Bearer ${employeToken}`)
      .send({
        start_date: futureDate(20),
        end_date: futureDate(21),
        reason: 'forge',
        employee_id: adminEmployeeId // forged, ignored
      });

    expect(res.statusCode).toEqual(201);
    // The leave must belong to the authenticated employee, not the forged admin id.
    expect(res.body.employee_id).toEqual(selfEmployeeId);
    expect(res.body.employee_id).not.toEqual(adminEmployeeId);

    const persisted = await db('leaves').where({ id: res.body.id }).first();
    expect(persisted.employee_id).toEqual(selfEmployeeId);
  });

  test("la route admin POST /api/employees/leaves reste fonctionnelle (créer pour un autre employé)", async () => {
    const selfProfile = await request(app)
      .get('/api/employees/profile')
      .set('Authorization', `Bearer ${employeToken}`);
    const targetEmployeeId = selfProfile.body.id;

    const res = await request(app)
      .post('/api/employees/leaves')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employee_id: targetEmployeeId,
        start_date: futureDate(14),
        end_date: futureDate(15),
        reason: 'créé par admin'
      });

    expect(res.statusCode).toEqual(201);
    expect(res.body.employee_id).toEqual(targetEmployeeId);
    expect(res.body.status).toEqual('PENDING');
  });
});