const router = require('../src/routes/sales');

console.log('router.stack length:', router.stack.length);
router.stack.forEach((layer, idx) => {
  console.log(idx, 'path:', layer.route ? layer.route.path : layer.name, 'methods:', layer.route ? Object.keys(layer.route.methods) : layer.name);
});
