process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');
const tables = ['employees','suppliers','leaves','schedules','users','ingredients','purchase_orders','purchase_order_items'];
(async () => {
  try {
    for (const t of tables) {
      const info = await db.raw(`PRAGMA table_info(${t})`);
      console.log('TABLE', t);
      console.log(info);
      console.log('---');
    }
    const emp = await db('employees').select('*').limit(3);
    console.log('employees sample', emp);
    const sup = await db('suppliers').select('*').limit(3);
    console.log('suppliers sample', sup);
    await db.destroy();
  } catch (err) {
    console.error(err);
    await db.destroy();
    process.exit(1);
  }
})();
