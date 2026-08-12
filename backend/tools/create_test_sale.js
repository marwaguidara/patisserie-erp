process.env.NODE_ENV = 'development';
console.log('NODE_ENV in script:', process.env.NODE_ENV);
const db = require('../src/db/connection');
console.log('DB client config:', db.client.config.connection);
const SalesService = require('../src/services/salesService');

(async () => {
  try {
    // Find a cashier user
    const user = await db('users').where({ email: 'cashier@bakery.com' }).first();
    if (!user) {
      console.error('No cashier user found.');
      process.exit(2);
    }

    // Find a product
    const product = await db('products').first();
    if (!product) {
      console.error('No product found in database.');
      process.exit(3);
    }

    const sale = await SalesService.createSale({
      cashierId: user.id,
      items: [{ product_id: product.id, quantity: 1 }],
      paymentMethod: 'CASH',
      customerName: 'Automated Test',
      customerPhone: '0000000000',
      userId: user.id
    });

    console.log('Sale created:', JSON.stringify(sale, null, 2));
    await db.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Error creating test sale:', err);
    await db.destroy();
    process.exit(1);
  }
})();
