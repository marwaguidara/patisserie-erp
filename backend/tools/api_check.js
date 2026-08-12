const BASE = 'http://localhost:5000';

const fetcher = global.fetch || require('node-fetch');


async function run() {
  try {
    // Login
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cashier@bakery.com', password: 'password123' })
    });

    const login = await res.json();
    console.log('Login status:', res.status);
    console.log(JSON.stringify(login, null, 2));
    if (!login.token) return;
    const token = login.token;

    // GET /api/sales/history
    const h = await fetch(`${BASE}/api/sales/history`, { headers: { Authorization: `Bearer ${token}` } });
    console.log('/api/sales/history status:', h.status);
    console.log('history:', await h.json());

    // GET /api/sales
    const s = await fetch(`${BASE}/api/sales`, { headers: { Authorization: `Bearer ${token}` } });
    console.log('/api/sales status:', s.status);
    console.log('sales:', await s.json());

    // GET sale by id 1
    const byId = await fetch(`${BASE}/api/sales/1`, { headers: { Authorization: `Bearer ${token}` } });
    console.log('/api/sales/1 status:', byId.status);
    console.log('sale 1:', await byId.json());

    // GET ticket HTML
    const t = await fetch(`${BASE}/api/sales/1/ticket/html`, { headers: { Authorization: `Bearer ${token}` } });
    console.log('/api/sales/1/ticket/html status:', t.status);
    const text = await t.text();
    console.log('ticket (truncated):', text.slice(0, 300));
  } catch (err) {
    console.error('API check error:', err);
  }
}

run();
