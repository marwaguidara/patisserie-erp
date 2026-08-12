const request = require('supertest');
const app = require('../src/app');

(async () => {
  try {
    console.log('1) Expect 401 when creating product without auth');
    const res1 = await request(app).post('/api/products').send({ name: 'x' });
    console.log('Status:', res1.status, 'Body:', res1.body);

    console.log('\n2) Login as cashier and expect 403 when creating product');
    const login = await request(app).post('/api/auth/login').send({ email: 'cashier@bakery.com', password: 'password123' });
    const token = login.body.token;
    const res2 = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({ name: 'x', price: 1.0 });
    console.log('Status:', res2.status, 'Body:', res2.body);

    console.log('\n3) Login as admin and expect 400 for invalid product payload');
    const loginAdmin = await request(app).post('/api/auth/login').send({ email: 'admin@bakery.com', password: 'password123' });
    const adminToken = loginAdmin.body.token;
    const res3 = await request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send({});
    console.log('Status:', res3.status, 'Body:', res3.body);

    console.log('\n4) Request unknown route -> 404 JSON');
    const res4 = await request(app).get('/api/unknown-route-xyz');
    console.log('Status:', res4.status, 'Body:', res4.body);

    process.exit(0);
  } catch (err) {
    console.error('Tool error:', err);
    process.exit(1);
  }
})();
