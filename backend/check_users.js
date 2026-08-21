const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './dev.sqlite3' },
  useNullAsDefault: true,
});

knex.raw('SELECT id, name, email, role FROM users LIMIT 10')
  .then(r => {
    console.log(JSON.stringify(r, null, 2));
    return knex.destroy();
  })
  .catch(e => {
    console.log('ERR:', e.message);
    return knex.destroy();
  });
