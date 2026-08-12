const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'dev.sqlite3');
const db = new sqlite3.Database(dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
  if (err) {
    console.error('Error reading sqlite_master:', err);
    process.exit(1);
  }
  console.log('Tables in', dbPath);
  rows.forEach((r) => console.log('-', r.name));
  db.close(() => process.exit(0));
});
