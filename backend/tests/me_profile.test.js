process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * PUT /api/employees/me/profile — Self-service update of contact info.
 *
 * Security / whitelist model verified:
 *  - only phone / address can ever be written;
 *  - protected fields (email / role / job_title / hire_date / name / user_id)
 *    smuggled into the body are IGNORED and stay unchanged in the DB;
 *  - the target employee is ALWAYS resolved from req.user.id, never from an id
 *    in the body.
 */
describe('PUT /api/employees/me/profile', () => {
  let employeToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const empLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employe@bakery.com', password: 'password123' });
    expect(empLogin.statusCode).toEqual(200);
    employeToken = empLogin.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('nominal -> 200, phone et address bien mis à jour en base', async () => {
    const res = await request(app)
      .put('/api/employees/me/profile')
      .set('Authorization', `Bearer ${employeToken}`)
      .send({ phone: '12345678', address: '23 Rue des Pâtissiers, Tunis' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.phone).toEqual('12345678');
    expect(res.body.address).toEqual('23 Rue des Pâtissiers, Tunis');

    // Verify persisted in the DB for the authenticated employee.
    const employee = await db('employees')
      .where({ user_id: (await db('users').where({ email: 'employe@bakery.com' }).first()).id })
      .first();
    expect(employee.phone).toEqual('12345678');
    expect(employee.address).toEqual('23 Rue des Pâtissiers, Tunis');
  });

  test("tentative d'envoyer role/email dans le body -> ignorés, valeurs inchangées en base", async () => {
    const before = await db('users').where({ email: 'employe@bakery.com' }).first();
    const beforeRole = before.role;
    const beforeEmail = before.email;

    const res = await request(app)
      .put('/api/employees/me/profile')
      .set('Authorization', `Bearer ${employeToken}`)
      .send({
        phone: '99999999',
        role: 'ADMIN',
        email: 'pirates@bakery.com',
        job_title: 'Directeur',
        hire_date: '2000-01-01',
        first_name: 'Hacker'
      });

    expect(res.statusCode).toEqual(200);
    // phone was still updated (whitelisted)
    expect(res.body.phone).toEqual('99999999');

    // Protected fields must be unchanged in the DB.
    const after = await db('users').where({ email: 'employe@bakery.com' }).first();
    expect(after.role).toEqual(beforeRole);
    expect(after.email).toEqual(beforeEmail);

    const empAfter = await db('employees')
      .where({ user_id: after.id })
      .first();
    expect(String(empAfter.job_title)).not.toEqual('Directeur');
    expect(String(empAfter.first_name)).not.toEqual('Hacker');
    // hire_date is a separate column on employees — ensure it was not overwritten
    // (it stays whatever the seed set, i.e. not 2000-01-01 asserted-change).
    expect(empAfter.hire_date).not.toEqual('2000-01-01');
  });

  test("l'id ciblé est toujours req.user.id même si un autre id est envoyé dans le body", async () => {
    // IDs of the two seeded profiles.
    const me = await db('employees')
      .where({ user_id: (await db('users').where({ email: 'employe@bakery.com' }).first()).id })
      .first();
    const adminUser = await db('users').where({ email: 'admin@bakery.com' }).first();
    const adminEmployee = await db('employees').where({ user_id: adminUser.id }).first();

    const res = await request(app)
      .put('/api/employees/me/profile')
      .set('Authorization', `Bearer ${employeToken}`)
      .send({ phone: '555111222', address: 'self only', id: adminEmployee.id, employee_id: adminEmployee.id });

    expect(res.statusCode).toEqual(200);

    // Authenticated employee got the update.
    const meAfter = await db('employees').where({ id: me.id }).first();
    expect(meAfter.phone).toEqual('555111222');

    // The forged admin target must remain untouched.
    const adminAfter = await db('employees').where({ id: adminEmployee.id }).first();
    expect(adminAfter.phone).not.toEqual('555111222');
  });
});