process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');

(async () => {
  try {
    const sales = await db('sales').select('*').orderBy('id', 'desc').limit(10);
    const saleItems = await db('sale_items').select('*').orderBy('id', 'desc').limit(10);
    const payments = await db('payments').select('*').orderBy('id', 'desc').limit(10).catch(() => []);

    console.log('Recent sales (up to 10):');
    console.log(JSON.stringify(sales, null, 2));

    console.log('\nRecent sale_items (up to 10):');
    console.log(JSON.stringify(saleItems, null, 2));

    console.log('\nRecent payments (up to 10):');
    console.log(JSON.stringify(payments, null, 2));

    const counts = {};
    counts.sales_count = await db('sales').count('* as cnt').first();
    counts.sale_items_count = await db('sale_items').count('* as cnt').first();
    try {
      counts.payments_count = await db('payments').count('* as cnt').first();
    } catch (e) {
      counts.payments_count = { cnt: 0 };
    }

    console.log('\nCounts:');
    console.log(JSON.stringify(counts, null, 2));

    await db.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Diagnosis error:', err);
    await db.destroy();
    process.exit(1);
  }
})();
