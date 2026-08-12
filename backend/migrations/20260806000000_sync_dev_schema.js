/**
 * Forward-only database synchronization migration.
 *
 * Background:
 *  - Migration 20260731000002_sprint2_sales.js was edited AFTER it had already
 *    been applied to dev.sqlite3 (the `status` column was added later). Knex
 *    tracks migrations by filename only, so it will never re-run that file
 *    and the dev DB permanently lacks `sales.status`.
 *  - Migration 20260801000000_sprint3_employees_suppliers.js was NEVER applied
 *    to dev.sqlite3, so `suppliers.lead_time/quality/rating` and
 *    `employees.hire_date/address` are missing.
 *
 * This migration adds the missing columns idempotently (guarded by
 * hasColumn) so it is safe on:
 *  - the stale dev database (adds the missing columns),
 *  - a fresh test/production database (no-op),
 *  - any partially-migrated environment (no-op on already-present columns).
 *
 * It does NOT modify existing migrations and does NOT destroy data.
 */
exports.up = async function (knex) {
  // sales.status — added to migration 3 AFTER it was applied to dev.sqlite3
  if (!(await knex.schema.hasColumn('sales', 'status'))) {
    await knex.schema.table('sales', (table) => {
      table.string('status').notNullable().defaultTo('PAID');
    });
  }

  // suppliers Sprint-3 columns — migration 5 was never applied to dev.sqlite3
  if (!(await knex.schema.hasColumn('suppliers', 'lead_time'))) {
    await knex.schema.table('suppliers', (table) => {
      table.string('lead_time');
      table.string('quality');
      table.integer('rating');
    });
  }

  // employees Sprint-3 columns — migration 5 was never applied to dev.sqlite3
  if (!(await knex.schema.hasColumn('employees', 'hire_date'))) {
    await knex.schema.table('employees', (table) => {
      table.date('hire_date');
      table.string('address');
    });
  }
};

exports.down = async function (knex) {
  // Reversible: drop only if present
  if (await knex.schema.hasColumn('sales', 'status')) {
    await knex.schema.table('sales', (table) => {
      table.dropColumn('status');
    });
  }

  if (await knex.schema.hasColumn('suppliers', 'lead_time')) {
    await knex.schema.table('suppliers', (table) => {
      table.dropColumn('lead_time');
      table.dropColumn('quality');
      table.dropColumn('rating');
    });
  }

  if (await knex.schema.hasColumn('employees', 'hire_date')) {
    await knex.schema.table('employees', (table) => {
      table.dropColumn('hire_date');
      table.dropColumn('address');
    });
  }
};