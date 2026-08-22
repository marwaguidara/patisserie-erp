const path = require('path');

/**
 * Configuration MySQL (mysql2) — moteur PAR DÉFAUT du développement.
 *
 * Connexion pilotée par les variables d'environnement :
 *   DB_HOST     (défaut : 127.0.0.1)
 *   DB_PORT     (défaut : 3306)
 *   DB_USER     (défaut : root)
 *   DB_PASSWORD (défaut : '')
 *   DB_NAME     (défaut : patisserie_erp)
 */
const mysqlConfig = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'patisserie_erp',
    charset: 'utf8mb4'
  },
  migrations: {
    directory: path.join(__dirname, 'migrations')
  },
  seeds: {
    directory: path.join(__dirname, 'seeds')
  },
  pool: {
    min: 2,
    max: 10
  }
};

/**
 * Configuration SQLite — REPLI EXPLICITE uniquement (DB_CLIENT=sqlite3|sqlite).
 * L'environnement de test Jest utilise l'entrée `test` ci-dessous
 * (SQLite en mémoire), qui reste inchangée.
 */
const sqliteConfig = {
  client: 'sqlite3',
  connection: {
    filename: process.env.DB_PATH || path.join(__dirname, 'dev.sqlite3')
  },
  useNullAsDefault: true,
  migrations: {
    directory: path.join(__dirname, 'migrations')
  },
  seeds: {
    directory: path.join(__dirname, 'seeds')
  },
  pool: {
    afterCreate: (conn, cb) => {
      conn.run('PRAGMA foreign_keys = ON', cb);
    }
  }
};

module.exports = {
  // Développement : MySQL (mysql2) PAR DÉFAUT.
  // Repli SQLite possible uniquement via DB_CLIENT=sqlite3 (ou sqlite).
  development: process.env.DB_CLIENT === 'sqlite3' || process.env.DB_CLIENT === 'sqlite'
    ? sqliteConfig
    : mysqlConfig,

  // Configurations explicites (CLI : knex --env mysql / knex --env sqlite)
  mysql: mysqlConfig,
  sqlite: sqliteConfig,

  test: {
    client: 'sqlite3',
    connection: {
      filename: ':memory:'
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'migrations')
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    },
    pool: {
      min: 1,
      max: 1,
      acquireTimeoutMillis: 15000,
      afterCreate: (conn, cb) => {
        conn.run('PRAGMA foreign_keys = ON', cb);
      }
    }
  },

  // Production : MySQL (même moteur que le développement).
  production: {
    client: 'mysql2',
    connection: process.env.DATABASE_URL || {
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'patisserie_erp',
      charset: 'utf8mb4'
    },
    migrations: {
      directory: path.join(__dirname, 'migrations')
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    },
    pool: {
      min: 2,
      max: 10
    }
  }
};

