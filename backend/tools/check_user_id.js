process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');

const id = process.argv[2] || '19';
(async () => {
  try {
    const user = await db('users').where({ id: parseInt(id, 10) }).first();
    if (!user) {
      console.log(`User id=${id} not found.`);
    } else {
      console.log('User found:', JSON.stringify(user, null, 2));
    }
    await db.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Error checking user:', err);
    await db.destroy();
    process.exit(1);
  }
})();
