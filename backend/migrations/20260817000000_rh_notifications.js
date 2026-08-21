/**
 * Migration — RH Self-Service + Notifications (Sprint 6)
 *
 * Adds:
 *   1. `notifications` table — central store for all in-app notifications
 *      (In-App / Email / SMS / WhatsApp — future 2026).
 *      Every notification is RBAC-scoped at WRITE time (only sent to users
 *      with the required permission) and filtered at READ time.
 *
 * No destructive changes — only new tables and idempotent column checks.
 */
exports.up = async function (knex) {
  // ── notifications table ──────────────────────────────────────────
  // Idempotent: skip if the table already exists (safe re-run).
  const exists = await knex.schema.hasTable('notifications');
  if (!exists) {
    await knex.schema.createTable('notifications', (table) => {
      table.increments('id').primary();

      // The user this notification is about (receiver). Nullable for broadcast
      // / system-wide notifications that are filtered by role at read time.
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');

      // Module that generated the notification — drives RBAC filter.
      // Values: 'stock', 'expiry', 'orders', 'ia', 'system', 'rh', 'profile', 'schedule', 'leave'
      table.string('module').notNullable().defaultTo('system');

      // The permission key that must be granted for the user to see this
      // notification (e.g. 'view_stock_alerts', 'view_ai_anomalies').
      table.string('permission').notNullable().defaultTo('view_notifications');

      // Human-readable fields
      table.string('title').notNullable();
      table.text('message');
      table.string('category').defaultTo('system'); // legacy category for backward-compat
      table.enu('priority', ['Critique', 'Important', 'Information']).defaultTo('Information');
      table.boolean('is_read').defaultTo(false);

      // Target tab / URL fragment for deep-linking from the notification panel
      table.string('target_tab').nullable();
      table.string('target_url').nullable();

      // Delivery channels (future: Email, SMS, WhatsApp Business)
      table.json('channels').nullable();

      // Metadata for debugging / audit
      table.json('metadata').nullable();

      table.timestamps(true, true);
    });

    // Indexes for fast RBAC-scoped queries
    await knex.schema.table('notifications', (table) => {
      table.index(['user_id', 'is_read']);
      table.index(['module', 'permission']);
      table.index(['is_read', 'created_at']);
    });
  }

  // ── employees: add hours_tracked column (for future "Mes Heures" enrichment) ──
  if (!(await knex.schema.hasColumn('employees', 'hours_tracked'))) {
    await knex.schema.table('employees', (table) => {
      table.decimal('hours_tracked', 8, 2).defaultTo(0);
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('notifications');
  if (await knex.schema.hasColumn('employees', 'hours_tracked')) {
    await knex.schema.table('employees', (table) => {
      table.dropColumn('hours_tracked');
    });
  }
};