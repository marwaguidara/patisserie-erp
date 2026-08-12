process.env.NODE_ENV = 'development';
const fetch = global.fetch || require('node-fetch');
const db = require('../src/db/connection');

const BASE = 'http://localhost:5000';

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cashier@bakery.com', password: 'password123' })
  });
  return res.json();
}

async function getSales(params, token) {
  const url = new URL(`${BASE}/api/sales/history`);
  Object.keys(params || {}).forEach((k) => url.searchParams.append(k, params[k]));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function run() {
  try {
    // find a product
    const product = await db('products').first();
    if (!product) throw new Error('No product available');

    // create dated sales: today, 7 days ago, 30 days ago
    const today = new Date();
    const d7 = new Date(); d7.setDate(today.getDate() - 7);
    const d30 = new Date(); d30.setDate(today.getDate() - 30);

    await db('sales').del();
    await db('sale_items').del();
    await db('payments').del();

    const exec = require('child_process').execSync;
    exec(`node tools/create_dated_sale.js ${product.id} ${today.toISOString().slice(0,10)} 1 2.5`);
    exec(`node tools/create_dated_sale.js ${product.id} ${d7.toISOString().slice(0,10)} 1 3.0`);
    exec(`node tools/create_dated_sale.js ${product.id} ${d30.toISOString().slice(0,10)} 1 4.0`);

    const loginRes = await login();
    const token = loginRes.token;

    // period=day
    const dayRes = await getSales({ period: 'day' }, token);
    console.log('day -> found', Array.isArray(dayRes.body) ? dayRes.body.length : 'ERR', 'sales');

    const weekRes = await getSales({ period: 'week' }, token);
    console.log('week -> found', Array.isArray(weekRes.body) ? weekRes.body.length : 'ERR', 'sales');

    const monthRes = await getSales({ period: 'month' }, token);
    console.log('month -> found', Array.isArray(monthRes.body) ? monthRes.body.length : 'ERR', 'sales');

    const productRes = await getSales({ product_id: product.id }, token);
    console.log('product filter -> found', Array.isArray(productRes.body) ? productRes.body.length : 'ERR', 'sales');

    await db.destroy();
  } catch (err) {
    console.error('Test error:', err);
    await db.destroy();
    process.exit(1);
  }
}

run();
