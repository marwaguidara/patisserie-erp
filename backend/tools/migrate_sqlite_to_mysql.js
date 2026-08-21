/**
 * Script de migration de données SQLite vers MySQL XAMPP
 * Express + Knex
 *
 * Source : backend/dev.sqlite3
 * Destination : MySQL localhost:3306 (base : patisserie_erp)
 */

const knex = require('knex');
const path = require('path');
const fs = require('fs');

// Détermination dynamique du chemin de la base SQLite
function resolveSqlitePath() {
  const candidatePaths = [
    process.env.DB_PATH,
    path.join(__dirname, '../dev.sqlite3'),
    path.join(__dirname, 'dev.sqlite3'),
    path.join(process.cwd(), 'backend/dev.sqlite3'),
    path.join(process.cwd(), 'dev.sqlite3')
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return path.resolve(p);
    }
  }

  throw new Error(`[ERREUR] Fichier SQLite introuvable. Chemins vérifiés : ${candidatePaths.join(', ')}`);
}

// Configuration de la base MySQL de destination
const MYSQL_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
  database: process.env.DB_NAME || 'patisserie_erp',
  charset: 'utf8mb4'
};

// Ordre topologique des tables pour préserver les clés étrangères
const ORDERED_TABLES = [
  'users',
  'categories',
  'suppliers',
  'employees',
  'ingredients',
  'products',
  'leaves',
  'schedules',
  'recipe_items',
  'stock_movements',
  'sales',
  'sale_items',
  'purchase_orders',
  'purchase_order_items',
  'customer_orders',
  'customer_order_items',
  'payments',
  'notifications'
];

// Tables système et métadonnées à ignorer lors du transfert de données
const IGNORED_TABLES = [
  'sqlite_sequence',
  'sqlite_stat1',
  'sqlite_master',
  'knex_migrations',
  'knex_migrations_lock'
];

/**
 * Crée la base de données MySQL si elle n'existe pas encore
 */
async function ensureDatabaseExists(config) {
  const rootDb = knex({
    client: 'mysql2',
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      charset: config.charset
    }
  });

  try {
    console.log(`[INFO] Vérification/Création de la base MySQL "${config.database}"...`);
    await rootDb.raw(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    console.log(`[OK] Base MySQL "${config.database}" prête.`);
  } catch (err) {
    console.error(`[ERREUR] Impossible de créer/vérifier la base MySQL "${config.database}":`, err.message);
    throw err;
  } finally {
    await rootDb.destroy();
  }
}

/**
 * Fonction principale de migration
 */
async function migrateData() {
  console.log('\n==================================================');
  console.log('  MIGRATION DONNÉES SQLITE -> MYSQL (PATISSERIE_ERP)');
  console.log('==================================================\n');

  const sqliteFile = resolveSqlitePath();
  console.log(`[SOURCE]      SQLite : ${sqliteFile}`);
  console.log(`[DESTINATION] MySQL  : ${MYSQL_CONFIG.user}@${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}\n`);

  // 1. Assurer l'existence de la base MySQL target
  await ensureDatabaseExists(MYSQL_CONFIG);

  // 2. Instancier le client Knex SQLite
  const sqliteDb = knex({
    client: 'sqlite3',
    connection: { filename: sqliteFile },
    useNullAsDefault: true
  });

  // 3. Instancier le client Knex MySQL
  const mysqlDb = knex({
    client: 'mysql2',
    connection: MYSQL_CONFIG,
    pool: { min: 1, max: 10 }
  });

  try {
    // 4. Exécuter les migrations Knex sur MySQL pour synchroniser la structure des tables
    const migrationsDirCandidates = [
      path.join(__dirname, '../migrations'),
      path.join(__dirname, 'migrations'),
      path.join(process.cwd(), 'backend/migrations'),
      path.join(process.cwd(), 'migrations')
    ];
    const migrationsDir = migrationsDirCandidates.find(d => fs.existsSync(d));

    if (migrationsDir) {
      console.log(`[INFO] Exécution des migrations Knex sur MySQL (${migrationsDir})...`);
      await mysqlDb.migrate.latest({ directory: migrationsDir });
      console.log(`[OK] Structure des tables MySQL synchronisée.\n`);
    } else {
      console.warn(`[WARN] Dossier de migrations non trouvé, migration directe des données...\n`);
    }

    // 5. Lister les tables existantes dans SQLite
    const sqliteTablesRaw = await sqliteDb.raw(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_migrations%'"
    );
    const existingSqliteTables = sqliteTablesRaw.map(t => t.name);

    // Ordonner les tables (Ordre topologique prédéfini + tables supplémentaires éventuelles)
    const tablesToMigrate = [
      ...ORDERED_TABLES.filter(t => existingSqliteTables.includes(t)),
      ...existingSqliteTables.filter(t => !ORDERED_TABLES.includes(t) && !IGNORED_TABLES.includes(t))
    ];

    // 6. Désactiver temporairement les contraintes de clés étrangères sur MySQL
    await mysqlDb.raw('SET FOREIGN_KEY_CHECKS = 0;');

    let totalRowsImported = 0;
    const summary = [];

    // 7. Traitement table par table
    for (const tableName of tablesToMigrate) {
      // Vérifier si la table existe dans MySQL
      const mysqlTableExists = await mysqlDb.schema.hasTable(tableName);
      if (!mysqlTableExists) {
        console.log(`[SKIP] Table "${tableName}" absente dans MySQL, sautée.`);
        summary.push({ Table: tableName, Lignes: 0, Statut: 'Absente MySQL' });
        continue;
      }

      // Récupération des enregistrements SQLite sans aucune suppression
      const rows = await sqliteDb(tableName).select('*');
      if (rows.length === 0) {
        console.log(`[TABLE] ${tableName.padEnd(24)} : 0 ligne (vide)`);
        summary.push({ Table: tableName, Lignes: 0, Statut: 'Vide' });
        continue;
      }

      // Nettoyage et formatage des données (objets/tableaux -> JSON stringified pour MySQL)
      const cleanedRows = rows.map(row => {
        const cleaned = { ...row };
        for (const key of Object.keys(cleaned)) {
          if (cleaned[key] !== null && typeof cleaned[key] === 'object' && !(cleaned[key] instanceof Date)) {
            cleaned[key] = JSON.stringify(cleaned[key]);
          }
        }
        return cleaned;
      });

      // Insertion relançable sans doublons (conservant les IDs d'origine)
      const chunkSize = 50;
      let importedForTable = 0;

      for (let i = 0; i < cleanedRows.length; i += chunkSize) {
        const chunk = cleanedRows.slice(i, i + chunkSize);
        try {
          // Tente onConflict('id').ignore() pris en charge par Knex pour MySQL
          await mysqlDb(tableName).insert(chunk).onConflict('id').ignore();
          importedForTable += chunk.length;
        } catch (err) {
          // Fallback : requête INSERT IGNORE raw pour compatibilité universelle
          const keys = Object.keys(chunk[0]);
          const placeholders = chunk.map(() => `(${keys.map(() => '?').join(', ')})`).join(', ');
          const sql = `INSERT IGNORE INTO \`${tableName}\` (\`${keys.join('`, `')}\`) VALUES ${placeholders}`;
          const values = chunk.flatMap(r => keys.map(k => r[k]));
          await mysqlDb.raw(sql, values);
          importedForTable += chunk.length;
        }
      }

      // Mise à jour de l'AUTO_INCREMENT dans MySQL après conservation des IDs
      const hasIdColumn = await mysqlDb.schema.hasColumn(tableName, 'id');
      if (hasIdColumn) {
        const [maxResult] = await mysqlDb(tableName).max('id as maxId');
        const maxId = maxResult?.maxId || 0;
        if (maxId > 0) {
          await mysqlDb.raw(`ALTER TABLE \`${tableName}\` AUTO_INCREMENT = ${Number(maxId) + 1}`);
        }
      }

      console.log(`[TABLE] ${tableName.padEnd(24)} : ${importedForTable} lignes importées (IDs conservés)`);
      totalRowsImported += importedForTable;
      summary.push({ Table: tableName, Lignes: importedForTable, Statut: 'OK' });
    }

    // 8. Réactiver les contraintes de clés étrangères
    await mysqlDb.raw('SET FOREIGN_KEY_CHECKS = 1;');

    // 9. Afficher le rapport d'exécution final
    console.log('\n==================================================');
    console.log('              RÉSUMÉ DE LA MIGRATION              ');
    console.log('==================================================');
    console.table(summary);
    console.log(`[TOTAL] ${totalRowsImported} lignes importées avec succès.`);
    console.log('==================================================\n');

  } catch (error) {
    console.error('\n[ERREUR FATALE LORS DE LA MIGRATION]:', error);
    process.exitCode = 1;
  } finally {
    await sqliteDb.destroy();
    await mysqlDb.destroy();
  }
}

// Lancement de la migration
migrateData();
