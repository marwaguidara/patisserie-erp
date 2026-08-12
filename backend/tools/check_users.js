const sqlite3 = require('sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'dev.sqlite3');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('Error opening DB', err);
    process.exit(1);
  }
});

db.get("SELECT count(*) as c FROM users", (err, row) => {
  if (err) {
    console.error('Error querying users:', err);
    process.exit(1);
  }
  console.log('users count:', row.c);
  db.close(() => process.exit(0));
});
