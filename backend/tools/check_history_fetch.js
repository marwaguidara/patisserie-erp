const fetch = global.fetch || require('node-fetch');
const BASE = 'http://localhost:5000';

async function run() {
  const login = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ email: 'cashier@bakery.com', password: 'password123' }) })).json();
  const token = login.token;
  const res = await (await fetch(`${BASE}/api/sales/history?period=day`, { headers: { Authorization: `Bearer ${token}` } })).json();
  console.log('history period=day ->', res.length, 'rows');
  res.forEach((s) => console.log(s.id, s.receipt_number, s.created_at));
}

run().catch((e)=>{console.error(e);process.exit(1)});
