exports.up = async function(knex) {
  // Add payments table
  await knex.schema.createTable('payments', (table) => {
    table.increments('id').primary();
    table.integer('sale_id').unsigned().notNullable().references('id').inTable('sales').onDelete('CASCADE');
    table.enum('payment_method', ['CASH', 'CARD', 'MOBILE']).notNullable().defaultTo('CASH');
    table.decimal('amount', 12, 2).notNullable();
    table.string('status').notNullable().defaultTo('PAID');
    table.string('provider');
    table.timestamps(true, true);
  });

  // Extend sales table for financial metrics
  await knex.schema.alterTable('sales', (table) => {
    table.decimal('total_cost', 12, 2).notNullable().defaultTo(0);
    table.decimal('total_margin', 12, 2).notNullable().defaultTo(0);
    table.integer('total_items').notNullable().defaultTo(0);
    table.string('status').notNullable().defaultTo('PAID');
  });

  // Extend sale_items to preserve cost and margin data
  await knex.schema.alterTable('sale_items', (table) => {
    table.decimal('cost_per_unit', 12, 4).notNullable().defaultTo(0);
    table.decimal('margin', 12, 2).notNullable().defaultTo(0);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('sale_items', (table) => {
    table.dropColumn('cost_per_unit');
    table.dropColumn('margin');
  });

  await knex.schema.alterTable('sales', (table) => {
    table.dropColumn('status');
    table.dropColumn('total_cost');
    table.dropColumn('total_margin');
    table.dropColumn('total_items');
  });

  await knex.schema.dropTableIfExists('payments');
};