const db = require('../db/connection');

/**
 * Sprint 5 — Consolidated analytics export.
 *
 * Produces a denormalized, read-only snapshot of the whole business history for a
 * future AI/analytics phase. It reuses the margins already computed by the core
 * backend at sale time (sale_items.cost_per_unit / .margin, sales.total_cost /
 * .total_margin) — it never recomputes business logic.
 */
class AnalyticsService {
  static async getExportData() {
    const [
      sales,
      saleItems,
      payments,
      stockMovements,
      ingredients,
      purchaseOrders,
      purchaseOrderItems,
      products,
      categories,
      suppliers,
      recipeItems
    ] = await Promise.all([
      db('sales').select('*').orderBy('created_at', 'asc'),
      db('sale_items').select('*').orderBy('id', 'asc'),
      db('payments').select('*').orderBy('id', 'asc'),
      db('stock_movements').select('*').orderBy('created_at', 'asc'),
      db('ingredients').select('id', 'name', 'unit', 'cost_per_unit', 'supplier_id').orderBy('id', 'asc'),
      db('purchase_orders').select('*').orderBy('created_at', 'asc'),
      db('purchase_order_items').select('*').orderBy('id', 'asc'),
      db('products').select('*').orderBy('id', 'asc'),
      db('categories').select('*').orderBy('id', 'asc'),
      db('suppliers').select('*').orderBy('id', 'asc'),
      db('recipe_items').select('*')
    ]);

    const ingById = Object.fromEntries(ingredients.map((i) => [i.id, i]));
    const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
    const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));
    const productById = Object.fromEntries(products.map((p) => [p.id, p]));

    // --- sale items (+ product_name) grouped per sale ---
    const saleItemsBySale = {};
    const enrichedSaleItems = saleItems.map((si) => {
      const p = productById[si.product_id];
      return { ...si, product_name: p ? p.name : null };
    });
    enrichedSaleItems.forEach((si) => {
      (saleItemsBySale[si.sale_id] = saleItemsBySale[si.sale_id] || []).push(si);
    });

    // --- payments grouped per sale ---
    const paymentsBySale = {};
    payments.forEach((p) => {
      (paymentsBySale[p.sale_id] = paymentsBySale[p.sale_id] || []).push(p);
    });

    // --- sales history (+ items + payments), margins as computed by backend ---
    const salesHist = sales.map((s) => ({
      ...s,
      items: saleItemsBySale[s.id] || [],
      payments: paymentsBySale[s.id] || []
    }));

    // --- stock movements (+ ingredient_name) ---
    const movements = stockMovements.map((m) => ({
      ...m,
      ingredient_name: ingById[m.ingredient_id] ? ingById[m.ingredient_id].name : null
    }));

    // --- products (+ category_name, recipe + recipe_cost) ---
    const recipeByProduct = {};
    recipeItems.forEach((r) => {
      (recipeByProduct[r.product_id] = recipeByProduct[r.product_id] || []).push(r);
    });
    const productsOut = products.map((p) => {
      const recipe = (recipeByProduct[p.id] || []).map((r) => {
        const ing = ingById[r.ingredient_id];
        return {
          ingredient_id: r.ingredient_id,
          ingredient_name: ing ? ing.name : null,
          quantity_required: r.quantity_required,
          unit_cost: ing ? ing.cost_per_unit : 0
        };
      });
      const recipeCost = recipe.reduce(
        (sum, r) => sum + parseFloat(r.quantity_required || 0) * parseFloat(r.unit_cost || 0),
        0
      );
      return {
        ...p,
        category_name: catById[p.category_id] ? catById[p.category_id].name : null,
        recipe_cost: parseFloat(recipeCost.toFixed(4)),
        recipe
      };
    });

    // --- purchase orders (+ supplier_name, items) ---
    const itemsByPo = {};
    purchaseOrderItems.forEach((i) => {
      (itemsByPo[i.purchase_order_id] = itemsByPo[i.purchase_order_id] || []).push(i);
    });
    const poOut = purchaseOrders.map((po) => ({
      ...po,
      supplier_name: supById[po.supplier_id] ? supById[po.supplier_id].name : null,
      items: (itemsByPo[po.id] || []).map((i) => ({
        ...i,
        ingredient_name: ingById[i.ingredient_id] ? ingById[i.ingredient_id].name : null
      }))
    }));

    // --- deliveries = received purchase orders + their received lines ---
    const deliveries = poOut
      .filter((po) => po.status === 'RECEIVED')
      .flatMap((po) => po.items.map((i) => ({
        purchase_order_id: po.id,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        received_at: po.received_at,
        ingredient_id: i.ingredient_id,
        ingredient_name: i.ingredient_name,
        quantity_ordered: i.quantity_ordered,
        quantity_received: i.quantity_received,
        unit_cost: i.unit_cost
      })));

    // --- suppliers (+ linked ingredient count) ---
    const suppliersOut = suppliers.map((s) => ({
      ...s,
      ingredients_count: ingredients.filter((i) => i.supplier_id === s.id).length
    }));

    return {
      exported_at: new Date().toISOString(),
      counts: {
        sales: salesHist.length,
        sale_items: enrichedSaleItems.length,
        stock_movements: movements.length,
        purchase_orders: poOut.length,
        deliveries: deliveries.length,
        products: productsOut.length,
        categories: categories.length,
        suppliers: suppliersOut.length
      },
      data: {
        sales: salesHist,
        sale_items: enrichedSaleItems,
        stock_movements: movements,
        purchase_orders: poOut,
        deliveries,
        products: productsOut,
        categories,
        suppliers: suppliersOut
      }
    };
  }
}

module.exports = AnalyticsService;