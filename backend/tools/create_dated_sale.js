process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');

async function createDatedSale({ productId, quantity = 1, amount = null, date }) {
  const receipt = `TEST-${Date.now()}`;
  const totalAmount = amount !== null ? amount : 1.0;
  const createdAt = new Date(date).toISOString();

  const trx = await db.transaction();
  try {
    const [saleId] = await trx('sales').insert({
      receipt_number: receipt,
      cashier_id: null,
      total_amount: totalAmount,
      payment_method: 'CASH',
      created_at: createdAt,
      updated_at: createdAt
    });

    await trx('sale_items').insert({
      sale_id: saleId,
      product_id: productId,
      quantity,
      unit_price: totalAmount,
      subtotal: totalAmount,
      created_at: createdAt,
      updated_at: createdAt
    });

    await trx('payments').insert({
      sale_id: saleId,
      payment_method: 'CASH',
      amount: totalAmount,
      status: 'PAID',
      provider: 'Cash',
      created_at: createdAt,
      updated_at: createdAt
    });

    await trx.commit();
    return saleId;
  } catch (err) {
    await trx.rollback();
    throw err;
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node create_dated_sale.js <productId> <YYYY-MM-DD> [quantity] [amount]');
    process.exit(1);
  }
  const productId = parseInt(args[0], 10);
  const date = args[1];
  const quantity = parseInt(args[2] || '1', 10);
  const amount = args[3] ? parseFloat(args[3]) : null;

  try {
    const id = await createDatedSale({ productId, quantity, amount, date });
    console.log('Created dated sale id', id);
    await db.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Error creating dated sale:', err);
    await db.destroy();
    process.exit(1);
  }
})();
