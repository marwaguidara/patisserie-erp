// Database audit script — inspects dev.sqlite3 schema vs expected migrations
const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'dev.sqlite3');
const db = new sqlite3.Database(dbPath);

function run(sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

(async () => {
  try {
    console.log('=== DATABASE FILE ===');
    console.log(dbPath);

    console.log('\n=== TABLES (sqlite_master) ===');
    const tables = await run("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    tables.forEach((t) => console.log('-', t.name));

    console.log('\n=== APPLIED MIGRATIONS (knex_migrations) ===');
    try {
      const migrations = await run('SELECT id, name, batch, migration_time FROM knex_migrations ORDER BY id');
      migrations.forEach((m) => console.log(`${m.id} | ${m.name} | batch=${m.batch} | ${m.migration_time}`));
    } catch (e) {
      console.log('knex_migrations table not found:', e.message);
    }

    console.log('\n=== COLUMNS: sales ===');
    const salesCols = await run('PRAGMA table_info(sales)');
    salesCols.forEach((c) => console.log(`- ${c.name} (${c.type}) notnull=${c.notnull} default=${c.dflt_value}`));

    console.log('\n=== COLUMNS: suppliers ===');
    const supCols = await run('PRAGMA table_info(suppliers)');
    supCols.forEach((c) => console.log(`- ${c.name} (${c.type}) notnull=${c.notnull} default=${c.dflt_value}`));

    console.log('\n=== COLUMNS: employees ===');
    const empCols = await run('PRAGMA table_info(employees)');
    empCols.forEach((c) => console.log(`- ${c.name} (${c.type}) notnull=${c.notnull} default=${c.dflt_value}`));

    console.log('\n=== COLUMNS: sale_items ===');
    const siCols = await run('PRAGMA table_info(sale_items)');
    siCols.forEach((c) => console.log(`- ${c.name} (${c.type}) notnull=${c.notnull} default=${c.dflt_value}`));

    console.log('\n=== COLUMNS: ingredients ===');
    const ingCols = await run('PRAGMA table_info(ingredients)');
    ingCols.forEach((c) => console.log(`- ${c.name} (${c.type}) notnull=${c.notnull} default=${c.dflt_value}`));

    console.log('\n=== COLUMNS: stock_movements ===');
    const smCols = await run('PRAGMA table_info(stock_movements)');
    smCols.forEach((c) => console.log(`- ${c.name} (${c.type}) notnull=${c.notnull} default=${c.dflt_value}`));

    console.log('\n=== COLUMNS: payments ===');
    const payCols = await run('PRAGMA table_info(payments)');
    payCols.forEach((c) => console.log(`- ${c.name} (${c.type}) notnull=${c.notnull} default=${c.dflt_value}`));

    console.log('\n=== ROW COUNTS ===');
    const countTables = ['users', 'employees', 'suppliers', 'ingredients', 'products', 'sales', 'sale_items', 'payments', 'purchase_orders', 'stock_movements'];
    for (const t of countTables) {
      try {
        const rows = await run(`SELECT COUNT(*) as c FROM ${t}`);
        console.log(`- ${t}: ${rows[0].c}`);
      } catch (e) {
        console.log(`- ${t}: ERROR ${e.message}`);
      }
    }
  } catch (err) {
    console.error('AUDIT FAILED:', err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();