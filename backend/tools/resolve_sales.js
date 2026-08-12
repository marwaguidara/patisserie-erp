try {
  const resolved = require.resolve('../src/routes/sales');
  console.log('Resolved path:', resolved);
  const mod = require('../src/routes/sales');
  console.log('Module type:', typeof mod);
  console.log('Module keys:', Object.keys(mod));
} catch (err) {
  console.error('Resolve error:', err);
}
