const db = require('../db/connection');
const StockService = require('./stockService');

/**
 * Sprint 4 — Orders business logic.
 *
 * Centralizes purchase orders (supplier) and customer orders (special cakes).
 * On purchase-order reception, it reuses StockService.applyMovement (IN) to
 * increment ingredient stock — the SAME shared service used by production and
 * sales (anti-fragmentation rule).
 */
class OrderService {
  // ---------- Purchase orders (supplier) ----------

  static async createPurchaseOrder({ supplierId, items, userId }) {
    if (!supplierId) {
      throw new Error('supplier_id est requis.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items est requis (liste de lignes).');
    }

    return await db.transaction(async (trx) => {
      const supplier = await trx('suppliers').where({ id: supplierId }).first();
      if (!supplier) {
        throw new Error('Fournisseur introuvable.');
      }

      const ingredientIds = items.map((i) => i.ingredient_id);
      const ingredients = await trx('ingredients').whereIn('id', ingredientIds).select('id', 'name', 'unit');
      if (ingredients.length !== new Set(ingredientIds).size) {
        throw new Error('Un ou plusieurs ingrédients sont invalides.');
      }

      let totalCost = 0;
      const rows = items.map((item) => {
        const qty = parseFloat(item.quantity_ordered);
        const unitCost = parseFloat(item.unit_cost);
        if (!qty || qty <= 0 || !unitCost || unitCost < 0) {
          throw new Error('Chaque ligne doit avoir une quantité positive et un coût unitaire valide.');
        }
        totalCost += qty * unitCost;
        return {
          ingredient_id: item.ingredient_id,
          quantity_ordered: qty,
          unit_cost: unitCost
        };
      });

      const [poId] = await trx('purchase_orders').insert({
        supplier_id: supplierId,
        status: 'DRAFT',
        total_cost: parseFloat(totalCost.toFixed(2)),
        created_by: userId || null
      });
      const id = typeof poId === 'object' ? poId.id : poId;

      await trx('purchase_order_items').insert(
        rows.map((r) => ({ ...r, purchase_order_id: id }))
      );

      return await OrderService.getPurchaseOrderById(id, trx);
    });
  }

  static async updatePurchaseOrderStatus(id, status, userId) {
    const VALID = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'];
    if (!VALID.includes(status)) {
      throw new Error(`status invalide. Utilisez l'un de: ${VALID.join(', ')}`);
    }

    return await db.transaction(async (trx) => {
      const po = await trx('purchase_orders').where({ id }).first();
      if (!po) {
        throw new Error('Commande fournisseur introuvable.');
      }

      // Only allow RECEIVED from ORDERED (or DRAFT for direct reception)
      if (status === 'RECEIVED' && !['ORDERED', 'DRAFT'].includes(po.status)) {
        throw new Error(`Impossible de recevoir une commande au statut ${po.status}.`);
      }
      if (status === 'ORDERED' && po.status !== 'DRAFT') {
        throw new Error('Seule une commande DRAFT peut être validée (ORDERED).');
      }
      if (status === 'CANCELLED' && !['DRAFT', 'ORDERED'].includes(po.status)) {
        throw new Error('Seule une commande DRAFT ou ORDERED peut être annulée.');
      }

      const updateData = { status };
      if (status === 'RECEIVED') {
        updateData.received_at = new Date().toISOString();
      }

      await trx('purchase_orders').where({ id }).update(updateData);

      // On reception, increment ingredient stock via the shared StockService
      if (status === 'RECEIVED') {
        const items = await trx('purchase_order_items').where({ purchase_order_id: id });
        for (const item of items) {
          await StockService.applyMovement({
            ingredientId: item.ingredient_id,
            movementType: 'IN',
            quantity: parseFloat(item.quantity_ordered),
            reason: `Réception commande fournisseur #${id}`,
            userId
          }, trx);
          await trx('purchase_order_items')
            .where({ id: item.id })
            .update({ quantity_received: parseFloat(item.quantity_ordered) });
        }
      }

      return await OrderService.getPurchaseOrderById(id, trx);
    });
  }

  static async getPurchaseOrders(filters = {}) {
    const query = db('purchase_orders')
      .join('suppliers', 'purchase_orders.supplier_id', 'suppliers.id')
      .select(
        'purchase_orders.*',
        'suppliers.name as supplier_name'
      )
      .orderBy('purchase_orders.created_at', 'desc');

    if (filters.status) {
      query.where('purchase_orders.status', filters.status);
    }
    if (filters.supplier_id) {
      query.where('purchase_orders.supplier_id', filters.supplier_id);
    }

    return await query;
  }

  static async getPurchaseOrderById(id, trx = null) {
    const executor = trx || db;
    const po = await executor('purchase_orders')
      .join('suppliers', 'purchase_orders.supplier_id', 'suppliers.id')
      .select(
        'purchase_orders.*',
        'suppliers.name as supplier_name'
      )
      .where('purchase_orders.id', id)
      .first();

    if (!po) {
      return null;
    }

    const items = await executor('purchase_order_items')
      .join('ingredients', 'purchase_order_items.ingredient_id', 'ingredients.id')
      .where('purchase_order_items.purchase_order_id', id)
      .select(
        'purchase_order_items.*',
        'ingredients.name as ingredient_name',
        'ingredients.unit'
      );

    return { ...po, items };
  }

  // ---------- Customer orders (special cakes) ----------

  static async createCustomerOrder({ customerName, customerPhone, deliveryDate, items, specialInstructions, userId }) {
    if (!customerName || !deliveryDate) {
      throw new Error('customer_name et delivery_date sont requis.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items est requis (liste de produits).');
    }

    return await db.transaction(async (trx) => {
      const productIds = items.map((i) => i.product_id);
      const products = await trx('products').whereIn('id', productIds).select('id', 'name', 'price');
      if (products.length !== new Set(productIds).size) {
        throw new Error('Un ou plusieurs produits sont invalides.');
      }
      const productsById = Object.fromEntries(products.map((p) => [p.id, p]));

      let totalPrice = 0;
      const rows = items.map((item) => {
        const product = productsById[item.product_id];
        const qty = parseInt(item.quantity, 10);
        if (!product || !qty || qty <= 0) {
          throw new Error('Chaque ligne doit avoir un produit valide et une quantité positive.');
        }
        const subtotal = parseFloat((parseFloat(product.price) * qty).toFixed(2));
        totalPrice += subtotal;
        return {
          product_id: product.id,
          quantity: qty,
          unit_price: parseFloat(product.price),
          subtotal
        };
      });

      const [coId] = await trx('customer_orders').insert({
        customer_name: customerName,
        customer_phone: customerPhone || null,
        delivery_date: deliveryDate,
        status: 'PENDING',
        total_price: parseFloat(totalPrice.toFixed(2)),
        special_instructions: specialInstructions || null,
        user_id: userId || null
      });
      const id = typeof coId === 'object' ? coId.id : coId;

      await trx('customer_order_items').insert(
        rows.map((r) => ({ ...r, customer_order_id: id }))
      );

      return await OrderService.getCustomerOrderById(id, trx);
    });
  }

  static async updateCustomerOrderStatus(id, status) {
    const VALID = ['PENDING', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED'];
    if (!VALID.includes(status)) {
      throw new Error(`status invalide. Utilisez l'un de: ${VALID.join(', ')}`);
    }

    const existing = await db('customer_orders').where({ id }).first();
    if (!existing) {
      throw new Error('Commande client introuvable.');
    }

    await db('customer_orders').where({ id }).update({ status });
    return await OrderService.getCustomerOrderById(id);
  }

  static async getCustomerOrders(filters = {}) {
    const query = db('customer_orders')
      .select('*')
      .orderBy('created_at', 'desc');

    if (filters.status) {
      query.where('status', filters.status);
    }
    if (filters.delivery_date) {
      query.where('delivery_date', filters.delivery_date);
    }

    return await query;
  }

  static async getCustomerOrderById(id, trx = null) {
    const executor = trx || db;
    const co = await executor('customer_orders').where({ id }).first();
    if (!co) {
      return null;
    }

    const items = await executor('customer_order_items')
      .join('products', 'customer_order_items.product_id', 'products.id')
      .where('customer_order_items.customer_order_id', id)
      .select(
        'customer_order_items.*',
        'products.name as product_name'
      );

    return { ...co, items };
  }
}

module.exports = OrderService;