/**
 * Migration — Index de performance (MySQL principal, compatible SQLite).
 *
 * Basée sur l'audit réel des requêtes backend (routes/, services/, middleware/) :
 *
 *  1. sales(created_at)
 *     - SalesService.getSalesMetrics() : 3 agrégats WHERE created_at >= ?
 *       (GET /api/sales/metrics + dashboard ADMIN) ;
 *     - ORDER BY sales.created_at DESC de GET /api/sales et de l'export
 *       AnalyticsService (ORDER BY created_at asc) ;
 *     - `sales` est la table la plus volumineuse (historique continu).
 *
 *  2. payments(sale_id, created_at)
 *     - Sous-requête corrélée exécutée PAR LIGNE dans SalesService.getSales() :
 *       `SELECT payment_method FROM payments WHERE sale_id = sales.id
 *        ORDER BY created_at DESC LIMIT 1`.
 *       L'index FK simple (sale_id) ne couvre pas le tri ; le composé évite un
 *       filesort par ligne sur l'endpoint le plus consulté.
 *
 *  3. stock_movements(ingredient_id, created_at)
 *     - GET /api/ingredients/:id : WHERE ingredient_id = ? ORDER BY created_at
 *       DESC LIMIT 20 (routes/ingredients.js). Étend l'auto-index FK (leading
 *       column identique) avec le tri.
 *
 *  4. customer_orders(delivery_date)
 *     - OrderService.getCustomerOrders({ delivery_date }) : filtre opérationnel
 *       « livraisons du jour » — aucune contrainte existante sur cette colonne.
 *
 *  5. notifications(user_id, created_at)
 *     - NotificationService.getForUser() : polling frontend
 *       (/api/notifications et /unread-count) avec ORDER BY created_at DESC
 *       LIMIT 100. Étend l'index existant (user_id, is_read) avec le tri.
 *
 *  Volontairement EXCLU (redondant ou non justifié) :
 *   - sale_items.product_id (GROUP BY top produits) : couvert par l'auto-index FK ;
 *   - colonnes FK simples déjà indexées par InnoDB ;
 *   - notifications(module,permission) / audit_logs.* : index existants suffisants ;
 *   - LIKE '%…%' sur products/ingredients : non-sargable par construction ;
 *   - purchase_orders(status,…) : cardinalité trop faible.
 */

const INDEXES = [
  { table: 'sales', columns: ['created_at'], name: 'idx_sales_created_at' },
  { table: 'payments', columns: ['sale_id', 'created_at'], name: 'idx_payments_sale_created' },
  { table: 'stock_movements', columns: ['ingredient_id', 'created_at'], name: 'idx_stock_movements_ing_created' },
  { table: 'customer_orders', columns: ['delivery_date'], name: 'idx_customer_orders_delivery_date' },
  { table: 'notifications', columns: ['user_id', 'created_at'], name: 'idx_notifications_user_created' },
];

/**
 * Index simples à restaurer dans down() : InnoDB substitue son index FK
 * auto-créé par tout nouvel index dont la colonne de tête est identique.
 * Supprimer le composite échouerait alors (« needed in a foreign key
 * constraint ») tant qu'aucun index ne couvre à nouveau la colonne. On
 * recrée donc l'équivalent de l'index FK auto-initial avant suppression.
 */
const FK_BACKUP_INDEXES = [
  { table: 'payments', column: 'sale_id', name: 'idx_payments_sale_id' },
  { table: 'stock_movements', column: 'ingredient_id', name: 'idx_stock_movements_ingredient_id' },
  { table: 'notifications', column: 'user_id', name: 'idx_notifications_user_id' },
];

exports.up = async function (knex) {
  // 1. Créer les index composites (la FK doit toujours conserver un index :
  //    on crée avant de supprimer tout couverture simple résiduelle).
  for (const { table, columns, name } of INDEXES) {
    await knex.schema.table(table, (t) => {
      t.index(columns, name);
    });
  }

  // 2. Nettoyer les index FK de secours laissés par un éventuel down()
  //    antérieur : ils sont désormais redondants avec les composites.
  //    Absents au premier passage → erreur ignorée sans effet.
  const isMysql = knex.client.config.client === 'mysql2';
  for (const { table, name } of FK_BACKUP_INDEXES) {
    try {
      if (isMysql) {
        await knex.raw('DROP INDEX ?? ON ??', [name, table]);
      } else {
        await knex.schema.table(table, (t) => {
          t.dropIndex(name);
        });
      }
    } catch (e) { /* premier passage : l'index de secours n'existe pas */ }
  }
};

exports.down = async function (knex) {
  // NB: knex/mysql2 préfixe/suffixe le nom passé à t.dropIndex(name)
  // (`{table}_{name}_index`), qui ne correspond plus au nom créé par up().
  // SQL brut côté MySQL ; voie knex conservée pour SQLite (tests).
  const isMysql = knex.client.config.client === 'mysql2';

  // 1. Restaurer une couverture simple sur les colonnes FK porteuses.
  for (const { table, column, name } of FK_BACKUP_INDEXES) {
    await knex.schema.table(table, (t) => {
      t.index([column], name);
    });
  }

  // 2. Supprimer les index composites (ordre inverse pour rester symétrique).
  for (const { table, name } of [...INDEXES].reverse()) {
    if (isMysql) {
      await knex.raw('DROP INDEX ?? ON ??', [name, table]);
    } else {
      await knex.schema.table(table, (t) => {
        t.dropIndex(name);
      });
    }
  }
};
