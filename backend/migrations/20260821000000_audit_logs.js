/**
 * Migration — Audit Logs / Traçabilité complète des actions utilisateurs
 */
exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('audit_logs');
  if (!exists) {
    await knex.schema.createTable('audit_logs', (table) => {
      table.increments('id').primary();

      // Utilisateur ayant effectué l'action (null si non authentifié lors du login)
      table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');

      // Type d'action (LOGIN, LOGOUT, CREATE_PRODUCT, UPDATE_PRODUCT, DELETE_PRODUCT, etc.)
      table.string('action').notNullable();

      // Entité concernée (product, sale, employee, supplier, order, stock, etc.)
      table.string('entity_type').nullable();
      table.string('entity_id').nullable();

      // Métadonnées d'audit (anciennes et nouvelles valeurs au format JSON)
      table.json('old_values').nullable();
      table.json('new_values').nullable();

      // Informations réseau et navigateur
      table.string('ip_address').nullable();
      table.text('user_agent').nullable();

      // Date de l'action
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });

    // Indexation pour les filtres et performances
    await knex.schema.table('audit_logs', (table) => {
      table.index(['user_id']);
      table.index(['action']);
      table.index(['created_at']);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
};
