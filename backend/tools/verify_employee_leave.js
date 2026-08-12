// Verify EMPLOYEE leave-request creation path (non-destructive, cleans up after).
// 1) EMPLOYEE creates a leave for THEMSELVES -> 201, forced status PENDING.
// 2) EMPLOYEE tries to create for ANOTHER employee -> 403 (backend security).
const db = require('../src/db/connection');
const app = require('../src/app');
const request = require('supertest');

const REASON = '__verify_employee_leave__';

(async () => {
  // Login as ADMIN to read the employee directory.
  const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin@bakery.com', password: 'password123' });
  if (adminLogin.status !== 200) throw new Error('ADMIN login failed: ' + adminLogin.status);
  const adminToken = adminLogin.body.token;
  const employees = await request(app).get('/api/employees').set('Authorization', 'Bearer ' + adminToken);
  const empOwn = employees.body.find((e) => (e.user_email || '').toLowerCase() === 'employe@bakery.com');
  const empOther = employees.body.find((e) => (e.user_email || '').toLowerCase() !== 'employe@bakery.com');
  console.log('EMPLOYEE own record id:', empOwn && empOwn.id, '| other record id:', empOther && empOther.id, '| other role:', empOther && empOther.user_role);

  // Login as EMPLOYEE.
  const empLogin = await request(app).post('/api/auth/login').send({ email: 'employe@bakery.com', password: 'password123' });
  console.log('EMPLOYEE login status:', empLogin.status, '| role:', empLogin.body.user && empLogin.body.user.role);
  const empToken = empLogin.body.token;

  // 1) Create for self (payload mirrors what the fixed frontend sends).
  const self = await request(app)
    .post('/api/employees/leaves')
    .set('Authorization', 'Bearer ' + empToken)
    .send({ employee_id: empOwn.id, start_date: '2026-09-01', end_date: '2026-09-02', reason: REASON, status: 'APPROVED' });
  console.log('POST /leaves (SELF, status=APPROVED) -> status:', self.status, '| stored:', self.body.status);

  // 2) Create for another employee -> must be 403.
  const other = await request(app)
    .post('/api/employees/leaves')
    .set('Authorization', 'Bearer ' + empToken)
    .send({ employee_id: empOther.id, start_date: '2026-09-03', end_date: '2026-09-04', reason: REASON });
  console.log('POST /leaves (OTHER employee)       -> status:', other.status, '| body:', other.body && other.body.error);

  // Cleanup created test rows.
  await db('leaves').where({ reason: REASON }).del();
  await db.destroy();
  console.log('DONE (test rows cleaned up).');
})().catch(async (e) => {
  console.error('VERIFY ERROR:', e);
  await db.destroy();
  process.exit(1);
});
