const path = require('path');

module.exports = {
  development: {
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
  },

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
      // IMPORTANT: SQLite ':memory:' creates one independent (empty) database per
      // connection. A pool larger than 1 would silently produce multiple empty
      // databases and intermittent "Acquire connection ... timed out" failures
      // when Jest runs all suites in a single process. Pinning the pool to a
      // single persistent connection (min:1, kept alive) guarantees each test
      // file sees exactly one consistent in-memory database.
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
      database: process.env.DB_NAME || 'bakery_db'
    },
    migrations: {
      directory: path.join(__dirname, 'migrations')
    },
    seeds: {
      directory: path.join(__dirname, 'seeds')
    }
  }
};
