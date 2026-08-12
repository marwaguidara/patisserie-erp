/**
 * Sprint 4 — Orders module migration.
 *
 * Adds traceability fields to the existing order tables (created in migration 1)
 * and creates the missing customer_order_items table.
 *
 * All additions are guarded (hasColumn / hasTable) so the migration is
 * idempotent and safe on any environment (dev, test, prod).
 */
exports.up = async function (knex) {
  // purchase_orders: traceability
  if (!(await knex.schema.hasColumn('purchase_orders', 'received_at'))) {
    await knex.schema.table('purchase_orders', (table) => {
      table.datetime('received_at').nullable();
    });
  }
  if (!(await knex.schema.hasColumn('purchase_orders', 'created_by'))) {
    await knex.schema.table('purchase_orders', (table) => {
      table.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }

  // purchase_order_items: partial reception tracking
  if (!(await knex.schema.hasColumn('purchase_order_items', 'quantity_received'))) {
    await knex.schema.table('purchase_order_items', (table) => {
      table.decimal('quantity_received', 12, 3).notNullable().defaultTo(0);
    });
  }

  // customer_orders: who registered the order
  if (!(await knex.schema.hasColumn('customer_orders', 'user_id'))) {
    await knex.schema.table('customer_orders', (table) => {
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }

  // customer_order_items: line items for special customer orders
  if (!(await knex.schema.hasTable('customer_order_items'))) {
    await knex.schema.createTable('customer_order_items', (table) => {
      table.increments('id').primary();
      table.integer('customer_order_id').unsigned().notNullable().references('id').inTable('customer_orders').onDelete('CASCADE');
      table.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('RESTRICT');
      table.integer('quantity').notNullable();
      table.decimal('unit_price', 10, 2).notNullable();
      table.decimal('subtotal', 10, 2).notNullable();
      table.timestamps(true, true);
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasTable('customer_order_items')) {
    await knex.schema.dropTableIfExists('customer_order_items');
  }
  if (await knex.schema.hasColumn('customer_orders', 'user_id')) {
    await knex.schema.table('customer_orders', (table) => {
      table.dropColumn('user_id');
    });
  }
  if (await knex.schema.hasColumn('purchase_order_items', 'quantity_received')) {
    await knex.schema.table('purchase_order_items', (table) => {
      table.dropColumn('quantity_received');
    });
  }
  if (await knex.schema.hasColumn('purchase_orders', 'created_by')) {
    await knex.schema.table('purchase_orders', (table) => {
      table.dropColumn('created_by');
    });
  }
  if (await knex.schema.hasColumn('purchase_orders', 'received_at')) {
    await knex.schema.table('purchase_orders', (table) => {
      table.dropColumn('received_at');
    });
  }
};