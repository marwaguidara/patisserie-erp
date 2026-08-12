exports.up = async function(knex) {
  if (!(await knex.schema.hasColumn('employees', 'hire_date'))) {
    await knex.schema.table('employees', (table) => {
      table.date('hire_date');
      table.string('address');
    });
  }

  if (!(await knex.schema.hasColumn('suppliers', 'lead_time'))) {
    await knex.schema.table('suppliers', (table) => {
      table.string('lead_time');
      table.string('quality');
      table.integer('rating');
    });
  }
};

exports.down = async function(knex) {
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
