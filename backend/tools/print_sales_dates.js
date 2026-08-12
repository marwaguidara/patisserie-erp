process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');

(async () => {
  try {
    const rows = await db('sales').select('id', 'receipt_number', 'created_at');
    console.log('sales rows:');
    rows.forEach((r) => console.log(r));

    const rows2 = await db.raw("select id, receipt_number, created_at, date(created_at) as dt from sales");
    console.log('raw date() output:');
    console.log(rows2);

    await db.destroy();
  } catch (err) {
    console.error(err);
    await db.destroy();
    process.exit(1);
  }
})();
