process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');
const SalesService = require('../src/services/salesService');

(async () => {
  try {
    const product = await db('products').first();
    if (!product) {
      console.error('No product found');
      process.exit(2);
    }

    const sale = await SalesService.createSale({
      cashierId: 19,
      items: [{ product_id: product.id, quantity: 1 }],
      paymentMethod: 'CASH',
      customerName: 'Cashier19 Test',
      customerPhone: '000',
      userId: 19
    });

    console.log('Created sale with cashierId=19:', JSON.stringify(sale, null, 2));
    await db.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    await db.destroy();
    process.exit(1);
  }
})();
