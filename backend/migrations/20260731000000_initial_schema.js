/**
 * Initial Schema Migration
 * Defines all 15 core tables upfront to enforce single source of truth and rule #2.
 */
exports.up = async function(knex) {
  // 1. Users
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('email').unique().notNullable();
    table.string('password_hash').notNullable();
    table.enum('role', ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE']).notNullable().defaultTo('EMPLOYEE');
    table.timestamps(true, true);
  });

  // 2. Employees
  await knex.schema.createTable('employees', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.string('first_name').notNullable();
    table.string('last_name').notNullable();
    table.string('phone');
    table.string('job_title');
    table.decimal('salary', 10, 2);
    table.timestamps(true, true);
  });

  // 3. Leaves
  await knex.schema.createTable('leaves', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.date('start_date').notNullable();
    table.date('end_date').notNullable();
    table.string('reason');
    table.enum('status', ['PENDING', 'APPROVED', 'REJECTED']).defaultTo('PENDING');
    table.timestamps(true, true);
  });

  // 4. Schedules
  await knex.schema.createTable('schedules', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.datetime('shift_start').notNullable();
    table.datetime('shift_end').notNullable();
    table.string('notes');
    table.timestamps(true, true);
  });

  // 5. Categories
  await knex.schema.createTable('categories', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.string('description');
    table.timestamps(true, true);
  });

  // 6. Suppliers
  await knex.schema.createTable('suppliers', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('contact_person');
    table.string('email');
    table.string('phone');
    table.string('address');
    table.timestamps(true, true);
  });

  // 7. Ingredients
  await knex.schema.createTable('ingredients', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.string('unit').notNullable(); // e.g. 'kg', 'g', 'l', 'unit'
    table.decimal('current_stock', 12, 3).notNullable().defaultTo(0);
    table.decimal('minimum_stock', 12, 3).notNullable().defaultTo(0);
    table.decimal('cost_per_unit', 10, 2).defaultTo(0);
    table.integer('supplier_id').unsigned().references('id').inTable('suppliers').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  // 8. Products
  await knex.schema.createTable('products', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.string('description');
    table.decimal('price', 10, 2).notNullable();
    table.integer('category_id').unsigned().references('id').inTable('categories').onDelete('SET NULL');
    table.integer('stock_quantity').notNullable().defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.timestamps(true, true);
  });

  // 9. Recipe Items
  await knex.schema.createTable('recipe_items', (table) => {
    table.increments('id').primary();
    table.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('CASCADE');
    table.integer('ingredient_id').unsigned().notNullable().references('id').inTable('ingredients').onDelete('CASCADE');
    table.decimal('quantity_required', 12, 3).notNullable();
    table.unique(['product_id', 'ingredient_id']);
    table.timestamps(true, true);
  });

  // 10. Stock Movements
  await knex.schema.createTable('stock_movements', (table) => {
    table.increments('id').primary();
    table.integer('ingredient_id').unsigned().notNullable().references('id').inTable('ingredients').onDelete('CASCADE');
    table.enum('movement_type', ['IN', 'OUT', 'PRODUCTION', 'ADJUSTMENT', 'WASTE']).notNullable();
    table.decimal('quantity', 12, 3).notNullable();
    table.string('reason');
    table.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  // 11. Sales
  await knex.schema.createTable('sales', (table) => {
    table.increments('id').primary();
    table.string('receipt_number').unique().notNullable();
    table.integer('cashier_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.decimal('total_amount', 10, 2).notNullable();
    table.string('payment_method').defaultTo('CASH'); // CASH, CARD, etc.
    table.timestamps(true, true);
  });

  // 12. Sale Items
  await knex.schema.createTable('sale_items', (table) => {
    table.increments('id').primary();
    table.integer('sale_id').unsigned().notNullable().references('id').inTable('sales').onDelete('CASCADE');
    table.integer('product_id').unsigned().notNullable().references('id').inTable('products').onDelete('RESTRICT');
    table.integer('quantity').notNullable();
    table.decimal('unit_price', 10, 2).notNullable();
    table.decimal('subtotal', 10, 2).notNullable();
    table.timestamps(true, true);
  });

  // 13. Purchase Orders
  await knex.schema.createTable('purchase_orders', (table) => {
    table.increments('id').primary();
    table.integer('supplier_id').unsigned().notNullable().references('id').inTable('suppliers').onDelete('CASCADE');
    table.enum('status', ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED']).defaultTo('DRAFT');
    table.decimal('total_cost', 10, 2).defaultTo(0);
    table.timestamps(true, true);
  });

  // 14. Purchase Order Items
  await knex.schema.createTable('purchase_order_items', (table) => {
    table.increments('id').primary();
    table.integer('purchase_order_id').unsigned().notNullable().references('id').inTable('purchase_orders').onDelete('CASCADE');
    table.integer('ingredient_id').unsigned().notNullable().references('id').inTable('ingredients').onDelete('RESTRICT');
    table.decimal('quantity_ordered', 12, 3).notNullable();
    table.decimal('unit_cost', 10, 2).notNullable();
    table.timestamps(true, true);
  });

  // 15. Customer Orders
  await knex.schema.createTable('customer_orders', (table) => {
    table.increments('id').primary();
    table.string('customer_name').notNullable();
    table.string('customer_phone');
    table.date('delivery_date').notNullable();
    table.enum('status', ['PENDING', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED']).defaultTo('PENDING');
    table.decimal('total_price', 10, 2).notNullable();
    table.text('special_instructions');
    table.timestamps(true, true);
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('customer_orders');
  await knex.schema.dropTableIfExists('purchase_order_items');
  await knex.schema.dropTableIfExists('purchase_orders');
  await knex.schema.dropTableIfExists('sale_items');
  await knex.schema.dropTableIfExists('sales');
  await knex.schema.dropTableIfExists('stock_movements');
  await knex.schema.dropTableIfExists('recipe_items');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('ingredients');
  await knex.schema.dropTableIfExists('suppliers');
  await knex.schema.dropTableIfExists('categories');
  await knex.schema.dropTableIfExists('schedules');
  await knex.schema.dropTableIfExists('leaves');
  await knex.schema.dropTableIfExists('employees');
  await knex.schema.dropTableIfExists('users');
};
