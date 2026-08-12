process.env.NODE_ENV = 'development';
const db = require('../src/db/connection');

const paymentSubquery = db('payments').select('payment_method').whereRaw('payments.sale_id = sales.id').orderBy('created_at', 'desc').limit(1);
const query = db('sales').select('sales.*').select({ payment_method: paymentSubquery }).select(db.raw('(select COALESCE(SUM(quantity),0) from sale_items where sale_items.sale_id = sales.id) as total_items'));
const startDate = new Date();
const sStr = startDate.toISOString().slice(0,10);
query.whereRaw('date(sales.created_at) >= date(?)', [sStr]);
console.log('SQL:', query.toString());
db.destroy();
