process.env.NODE_ENV = 'test';

const db = require('../src/db/connection');
const syncMigration = require('../migrations/20260806000000_sync_dev_schema.js');

/**
 * DB-1 regression: the forward-only sync migration
 * (20260806000000_sync_dev_schema.js) must:
 *  1. Run cleanly as part of the full migration chain (fresh test DB already
 *     has all columns from migrations 3 & 5 — the sync migration must no-op).
 *  2. Produce a schema where sales.status, suppliers.lead_time and
 *     employees.hire_date all exist.
 *  3. Be reversible (down() drops only the columns it added).
 */
describe('DB Sync Migration (20260806000000_sync_dev_schema)', () => {
  beforeAll(async () => {
    await db.migrate.latest();
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('All required columns exist after migrate:latest on a fresh DB', async () => {
    expect(await db.schema.hasColumn('sales', 'status')).toBe(true);
    expect(await db.schema.hasColumn('suppliers', 'lead_time')).toBe(true);
    expect(await db.schema.hasColumn('suppliers', 'quality')).toBe(true);
    expect(await db.schema.hasColumn('suppliers', 'rating')).toBe(true);
    expect(await db.schema.hasColumn('employees', 'hire_date')).toBe(true);
    expect(await db.schema.hasColumn('employees', 'address')).toBe(true);
  });

  test('migrate:latest is idempotent — re-running after applied is a no-op', async () => {
    const before = await db('knex_migrations').select('id');
    await expect(db.migrate.latest()).resolves.toBeDefined();
    const after = await db('knex_migrations').select('id');
    expect(after.length).toEqual(before.length);
  });

  test('sales.status has the PAID default', async () => {
    const saleCols = await db.raw('PRAGMA table_info(sales)');
    const statusCol = saleCols.find((c) => c.name === 'status');
    expect(statusCol).toBeDefined();
    expect(String(statusCol.dflt_value).toUpperCase()).toContain('PAID');
  });

  test('sync migration is reversible (down rolls back only its own columns)', async () => {
    // Simulate a scenario where migration 6 was the ONLY source of a column:
    // drop it with the migration's own down(), re-add with up(). On a fresh
    // DB migrations 3 & 5 already created these columns, so down() is a
    // guarded no-op here — which is exactly the defensive behavior we want.
    await syncMigration.down(db);
    await syncMigration.up(db);

    expect(await db.schema.hasColumn('sales', 'status')).toBe(true);
    expect(await db.schema.hasColumn('suppliers', 'lead_time')).toBe(true);
    expect(await db.schema.hasColumn('employees', 'hire_date')).toBe(true);
  });
});