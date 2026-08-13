process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');

async function createDatedSale({ productId, quantity = 1, amount = null, date }) {
  const receipt = `TEST-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const totalAmount = amount !== null ? amount : quantity * 1.3;
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
      unit_price: totalAmount / quantity,
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
  // CLI: node create_bulk_sales.js [productId] [startDate YYYY-MM-DD] [days]
  const productId = parseInt(process.argv[2], 10) || 25; // default Croissant Pur Beurre
  const startDate = process.argv[3] || '2026-06-01';
  const days = parseInt(process.argv[4], 10) || 15;

  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  console.log(`Creating ${dates.length} sales for product ${productId} starting ${startDate}...`);
  let count = 0;
  for (const date of dates) {
    try {
      const qty = Math.floor(Math.random() * 4) + 1; // 1-4 units
      const id = await createDatedSale({ productId, quantity: qty, date });
      count++;
      console.log(`  ${date}: sale_id=${id}, qty=${qty}`);
    } catch (err) {
      console.error(`  ${date}: FAILED - ${err.message}`);
    }
  }

  console.log(`\nCreated ${count} sales on ${dates.length} different dates.`);
  await db.destroy();
  process.exit(0);
})();
