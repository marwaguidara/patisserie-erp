exports.up = async function(knex) {
  await knex.schema.alterTable('sales', (table) => {
    table.timestamp('completed_at').defaultTo(knex.fn.now());
    table.string('customer_name').defaultTo('Walk-in');
    table.string('customer_phone');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('sales', (table) => {
    table.dropColumn('completed_at');
    table.dropColumn('customer_name');
    table.dropColumn('customer_phone');
  });
};