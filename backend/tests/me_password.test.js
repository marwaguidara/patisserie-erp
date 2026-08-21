process.env.NODE_ENV = 'test';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * PUT /api/employees/me/password — Self-service password change.
 *
 * Security model verified:
 *  - the target user is ALWAYS resolved from req.user.id (the JWT subject);
 *  - an id smuggled into the body is IGNORED, so a user can never change
 *    another employee's password, even by forging a body payload.
 */
describe('PUT /api/employees/me/password', () => {
  let authToken;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.seed.run();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'employe@bakery.com', password: 'password123' });

    expect(login.statusCode).toEqual(200);
    authToken = login.body.token;
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('nominal: 204 and password_hash is replaced with the new bcrypt hash', async () => {
    const res = await request(app)
      .put('/api/employees/me/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ currentPassword: 'password123', newPassword: 'newpass1234' });

    expect(res.status).toEqual(204);

    // The seeded user were resolved through login; re-fetch by email to read the
    // persisted hash and prove it now matches the NEW password.
    const user = await db('users').where({ email: 'employe@bakery.com' }).first();
    expect(user).toBeDefined();

    const newMatches = await bcrypt.compare('newpass1234', user.password_hash);
    const oldMatches = await bcrypt.compare('password123', user.password_hash);
    expect(newMatches).toBe(true);
    expect(oldMatches).toBe(false);
  });

  test('mauvais mot de passe actuel -> 401', async () => {
    const res = await request(app)
      .put('/api/employees/me/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ currentPassword: 'mauvais-mdp', newPassword: 'newpass1234' });

    expect(res.status).toEqual(401);
  });

  test('nouveau mot de passe < 8 caractères -> 400', async () => {
    const res = await request(app)
      .put('/api/employees/me/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ currentPassword: 'newpass1234', newPassword: 'short' });

    expect(res.status).toEqual(400);
  });

  test("un utilisateur ne peut PAS changer le mot de passe d'un autre employé, même en falsifiant un id dans le body", async () => {
    // The authenticated user is employe@bakery.com. A forged body tries to
    // redirect the password change to another user. The route MUST ignore it
    // and keep targeting req.user.id only.
    const adminUser = await db('users').where({ email: 'admin@bakery.com' }).first();
    expect(adminUser).toBeDefined();
    const adminHashBefore = adminUser.password_hash;

    const res = await request(app)
      .put('/api/employees/me/password')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ currentPassword: 'newpass1234', newPassword: 'hijacked1234', id: adminUser.id });

    expect(res.status).toEqual(204); // the SELF password was updated, 204

    // admin password must be intact (forged id ignored)
    const adminAfter = await db('users').where({ email: 'admin@bakery.com' }).first();
    expect(adminAfter.password_hash).toEqual(adminHashBefore);
    expect(await bcrypt.compare('password123', adminAfter.password_hash)).toBe(true);
  });
});