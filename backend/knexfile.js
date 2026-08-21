const path = require('path');

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

module.exports = {
  // Environnement par défaut (SQLite, ou MySQL si DB_CLIENT=mysql2)
  development: process.env.DB_CLIENT === 'mysql2' || process.env.DB_CLIENT === 'mysql'
    ? mysqlConfig
    : sqliteConfig,

  // Configuration SQLite explicite pour rollback immédiat
  sqlite: sqliteConfig,

  // Configuration MySQL XAMPP parallèle
  mysql: mysqlConfig,

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

  production: {
    client: 'pg',
    connection: process.env.DATABASE_URL || {
      host: process.env.DB_HOST || 'postgres',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'bakery_user',
      password: process.env.DB_PASSWORD || 'bakery_password',
      database: process.env.DB_NAME || 'patisserie_erp'
    },
    migrations: {
      directory: path.join(__dirname, 'migrations')
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    }
  }
};

