const db = require('../db/connection');
const StockService = require('./stockService');
const { invalidateForecastCache } = require('./aiCacheService');

class SalesService {
  static async calculateProductCost(productId, executor = db) {
    const recipe = await executor('recipe_items')
      .where('recipe_items.product_id', productId)
      .join('ingredients', 'recipe_items.ingredient_id', 'ingredients.id')
      .select('recipe_items.quantity_required', 'ingredients.cost_per_unit');

    if (!recipe || recipe.length === 0) {
      return 0;
    }

    return recipe.reduce((sum, item) => {
      return sum + parseFloat(item.quantity_required) * parseFloat(item.cost_per_unit || 0);
    }, 0);
  }

  static async createSale({ cashierId, items, paymentMethod, customerName, customerPhone, userId }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Sale items are required.');
    }

    return await db.transaction(async (trx) => {
      // Ensure cashier exists; if not, set to null so FK constraint doesn't fail
      if (cashierId) {
        const cashier = await trx('users').where({ id: cashierId }).first().catch(() => null);
        if (!cashier) {
          console.warn(`Cashier with id=${cashierId} not found. Inserting sale with cashier_id = NULL.`);
          cashierId = null;
        }
      }
      const productIds = items.map((item) => item.product_id);
      const uniqueProductIds = [...new Set(productIds)];
      const products = await trx('products').whereIn('id', uniqueProductIds).select('*');
      const productsById = Object.fromEntries(products.map((product) => [product.id, product]));

      if (products.length !== uniqueProductIds.length) {
        throw new Error('One or more products are invalid.');
      }

      const saleItems = [];
      let totalAmount = 0;
      let totalCost = 0;
      let totalMargin = 0;
      let totalQuantity = 0;

      for (const item of items) {
        const product = productsById[item.product_id];
        const quantity = parseInt(item.quantity, 10);
        if (!product || !quantity || quantity <= 0) {
          throw new Error('Each sale item must have a valid product and positive quantity.');
        }

        if (product.stock_quantity < quantity) {
          throw new Error(`Insufficient stock for product ${product.name}. Available: ${product.stock_quantity}, requested: ${quantity}`);
        }

        const productCost = await SalesService.calculateProductCost(product.id, trx);
        const costPerUnit = parseFloat(productCost.toFixed(4));
        const profitPerUnit = parseFloat(product.price) - costPerUnit;
        const margin = parseFloat((profitPerUnit * quantity).toFixed(2));
        const subtotal = parseFloat((parseFloat(product.price) * quantity).toFixed(2));

        saleItems.push({
          product_id: product.id,
          product_name: product.name,
          quantity,
          unit_price: parseFloat(product.price),
          cost_per_unit: costPerUnit,
          subtotal,
          margin
        });

        totalAmount += subtotal;
        totalCost += costPerUnit * quantity;
        totalMargin += margin;
        totalQuantity += quantity;
      }

      const receiptNumber = `TICK-${Date.now()}`;
      // Insert only columns that exist in the current schema
      const insertResult = await trx('sales').insert({
        receipt_number: receiptNumber,
        cashier_id: cashierId,
        total_amount: parseFloat(totalAmount.toFixed(2)),
        total_cost: parseFloat(totalCost.toFixed(2)),
        total_margin: parseFloat(totalMargin.toFixed(2)),
        total_items: totalQuantity,
        status: 'PAID',
        payment_method: paymentMethod || 'CASH',
        customer_name: customerName || 'Walk-in',
        customer_phone: customerPhone || null
      });

      const saleId = Array.isArray(insertResult)
        ? (typeof insertResult[0] === 'object' ? insertResult[0].id : insertResult[0])
        : (typeof insertResult === 'object' ? insertResult.id : insertResult);

      for (const item of saleItems) {
        await trx('sale_items').insert({
          sale_id: saleId,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          cost_per_unit: item.cost_per_unit,
          margin: item.margin,
          subtotal: item.subtotal
        });

        await StockService.sellProduct(item.product_id, item.quantity, userId, trx);
      }

      await trx('payments').insert({
        sale_id: saleId,
        payment_method: paymentMethod || 'CASH',
        amount: parseFloat(totalAmount.toFixed(2)),
        status: 'PAID',
        provider: paymentMethod === 'CARD' ? 'CardTerminal' : 'Cash'
      });

      const sale = await SalesService.getSaleById(saleId, trx);

      // Invalidate AI forecast cache for sold products (best-effort, outside transaction)
      invalidateForecastCache(uniqueProductIds).catch((err) => {
        console.warn('[ai-cache] post-sale invalidation error:', err.message);
      });

      return sale;
    });
  }

  static async getSaleById(saleId, trx = null) {
    const knexInstance = trx || db;

    const sale = await knexInstance('sales')
      .where('sales.id', saleId)
      .select('sales.*')
      .first();

    if (!sale) {
      return null;
    }

    const items = await knexInstance('sale_items')
      .where('sale_id', saleId)
      .select('id', 'product_id', 'quantity', 'unit_price', 'cost_per_unit', 'margin', 'subtotal');

    // Fetch product names to replace IDs in ticket display
    const productIds = [...new Set(items.map((item) => item.product_id))];
    const products = await knexInstance('products')
      .whereIn('id', productIds)
      .select('id', 'name');

    const productsById = Object.fromEntries(products.map((p) => [p.id, p.name]));

    // Replace product_id with product_name in items
    const itemsWithNames = items.map((item) => ({
      ...item,
      product_name: productsById[item.product_id] || `Produit #${item.product_id}`
    }));

    const payments = await knexInstance('payments')
      .where('sale_id', saleId)
      .select('id', 'payment_method', 'amount', 'status', 'provider', 'created_at');

    return {
      ...sale,
      items: itemsWithNames,
      payments
    };
  }

  static async getSales(filters = {}) {
    const paymentSubquery = db('payments')
      .select('payment_method')
      .whereRaw('payments.sale_id = sales.id')
      .orderBy('created_at', 'desc')
      .limit(1);

    const query = db('sales')
      .select('sales.*')
      .select({ payment_method: paymentSubquery })
      .select(db.raw('(select COALESCE(SUM(quantity),0) from sale_items where sale_items.sale_id = sales.id) as total_items'));

    // Product filter using WHERE EXISTS to avoid duplicate rows
    if (filters.product_id) {
      query.whereExists(function () {
        this.select('*').from('sale_items').whereRaw('sale_items.sale_id = sales.id').andWhere('sale_items.product_id', filters.product_id);
      });
    }

    // Date filters: normalize to created_at (existing column)
    if (filters.start_date) {
      const sd = new Date(filters.start_date);
      if (!isNaN(sd)) {
        const sdStr = sd.toISOString().slice(0, 10);
        query.whereRaw('date(sales.created_at) >= date(?)', [sdStr]);
      }
    }

    if (filters.end_date) {
      const ed = new Date(filters.end_date);
      if (!isNaN(ed)) {
        const edStr = ed.toISOString().slice(0, 10);
        query.whereRaw('date(sales.created_at) <= date(?)', [edStr]);
      }
    }

    if (filters.period) {
      const now = new Date();
      let startDate;
      if (filters.period === 'day') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (filters.period === 'week') {
        const day = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - day);
        startDate.setHours(0, 0, 0, 0);
      } else if (filters.period === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      if (startDate) {
        const sStr = startDate.toISOString().slice(0, 10);
        query.whereRaw('date(sales.created_at) >= date(?)', [sStr]);
      }
    }

    const sales = await query.orderBy('sales.created_at', 'desc');
    return sales;
  }

  static async getSalesHistory({ period, product_id, start_date, end_date } = {}) {
    return SalesService.getSales({ period, product_id, start_date, end_date });
  }

  static async getSalesMetrics() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const metrics = {};
    const periods = [
      { key: 'day', label: startOfDay },
      { key: 'week', label: startOfWeek },
      { key: 'month', label: startOfMonth }
    ];

    for (const period of periods) {
      const rows = await db('sales').where('created_at', '>=', period.label.toISOString()).select(
        db.raw('COUNT(*) as sales_count'),
        db.raw('COALESCE(SUM(total_amount),0) as total_revenue'),
        db.raw('COALESCE(AVG(total_amount),0) as average_ticket')
      );

      metrics[period.key] = {
        sales_count: parseInt(rows[0].sales_count, 10),
        total_revenue: parseFloat(rows[0].total_revenue),
        average_ticket: parseFloat(rows[0].average_ticket)
      };
    }

    const topProducts = await db('sale_items')
      .select('products.id', 'products.name')
      .sum('sale_items.quantity as total_sold')
      .sum('sale_items.subtotal as revenue')
      .join('products', 'sale_items.product_id', 'products.id')
      .groupBy('products.id', 'products.name')
      .orderBy('total_sold', 'desc')
      .limit(10);

    metrics.top_products = topProducts;
    return metrics;
  }

  static async generateTicketHtml(saleId) {
    const sale = await SalesService.getSaleById(saleId);
    if (!sale) {
      return null;
    }

    const lines = sale.items.map((item) => {
      return `<tr><td>${item.quantity}</td><td>${item.product_name || 'Produit inconnu'}</td><td>${item.unit_price.toFixed(2)} DT</td><td>${item.subtotal.toFixed(2)} DT</td></tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Ticket ${sale.receipt_number}</title>
<style>
 body { font-family: Arial, sans-serif; padding: 20px; }
 table { width: 100%; border-collapse: collapse; margin-top: 16px; }
 th, td { border: 1px solid #ddd; padding: 8px; }
 th { background: #f4f4f4; }
</style>
</head>
<body>
<h1>Ticket de Vente</h1>
<p><strong>Référence:</strong> ${sale.receipt_number}</p>
<p><strong>Date:</strong> ${new Date(sale.completed_at).toLocaleString('fr-FR')}</p>
<p><strong>Client:</strong> ${sale.customer_name || 'Walk-in'}</p>
<table>
<thead><tr><th>Qté</th><th>Produit</th><th>PU</th><th>Sous-total</th></tr></thead>
<tbody>${lines}</tbody>
</table>
<p><strong>Total:</strong> ${sale.total_amount.toFixed(2)} DT</p>
<p><strong>Marge:</strong> ${sale.total_margin.toFixed(2)} DT</p>
</body>
</html>`;
  }
}

module.exports = SalesService;
