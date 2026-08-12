/**
 * Sprint 1 Schema Migration - Expiration Date & Batch Tracking
 */
exports.up = async function(knex) {
  // Add expiration_date to ingredients table
  await knex.schema.table('ingredients', (table) => {
    table.date('expiration_date').nullable();
  });

  // Add batch_number and expiration_date to stock_movements table
  await knex.schema.table('stock_movements', (table) => {
    table.string('batch_number').nullable();
    table.date('expiration_date').nullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.table('stock_movements', (table) => {
    table.dropColumn('expiration_date');
    table.dropColumn('batch_number');
  });

  await knex.schema.table('ingredients', (table) => {
    table.dropColumn('expiration_date');
  });
};
