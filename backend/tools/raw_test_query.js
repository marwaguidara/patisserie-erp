process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');
(async () => {
  try {
    const res = await db.raw("select id, receipt_number, created_at, date(created_at) as dt from sales where date(created_at) >= date(?)", ['2026-07-31']);
    console.log(JSON.stringify(res, null, 2));
    await db.destroy();
  } catch (err) {
    console.error(err);
    await db.destroy();
    process.exit(1);
  }
})();
