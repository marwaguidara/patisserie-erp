process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * Employee creation (POST /api/employees, onboarding Mode B) MUST produce a
 * login-capable account: a `users` row with a bcrypt password_hash matching
 * what POST /api/auth/login compares against.
 */
describe('Employee creation → login capability', () => {
  let adminToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@bakery.com', password: 'password123' });
    expect(login.statusCode).toEqual(200);
    adminToken = login.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test("création avec mot de passe -> l'employé peut ensuite se connecter (end-to-end)", async () => {
    const email = `nouveau-${Date.now()}@bakery.com`;
    const password = 'secret2026';

    const createRes = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Nouveau',
        last_name: 'Test',
        email,
        password,
        role: 'EMPLOYEE',
        job_title: 'Apprenti',
        phone: '0123456789'
      });

    expect(createRes.statusCode).toEqual(201);
    expect(createRes.body.user_id).toBeDefined();

    // The login must now succeed with the same email/password.
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    expect(loginRes.statusCode).toEqual(200);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.user.email).toEqual(email);
  });

  test('création sans mot de passe -> 400, aucun compte à moitié créé', async () => {
    const email = `sans-mdp-${Date.now()}@bakery.com`;

    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Sans',
        last_name: 'MotDePasse',
        email,
        role: 'EMPLOYEE'
      });

    expect(res.statusCode).toEqual(400);

    // No `users` row must have been created (and therefore no `employees` row
    // linked to a valid user_id either — the onboarding inserts both atomically).
    const user = await db('users').where({ email }).first();
    expect(user).toBeUndefined();
    // A user-less employee cannot exist because Mode B only inserts employees
    // inside the same transaction that inserts the user.
    const orphanEmployees = await db('employees')
      .whereIn('user_id', function () { this.select('id').from('users').where('email', email); });
    expect(orphanEmployees.length).toEqual(0);
  });

  test('non-régression : un employé seed se connecte toujours normalement', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employe@bakery.com', password: 'password123' });

    expect(res.statusCode).toEqual(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toEqual('employe@bakery.com');
  });
});