const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const OrderService = require('../services/orderService');

const router = express.Router();

// POST /api/customer-orders — create a special customer order (PENDING)
router.post('/', requireAuth, requireRole(['ADMIN', 'CASHIER']), async (req, res, next) => {
  try {
    const { customer_name, customer_phone, delivery_date, items, special_instructions } = req.body;
    const order = await OrderService.createCustomerOrder({
      customerName: customer_name,
      customerPhone: customer_phone,
      deliveryDate: delivery_date,
      items,
      specialInstructions: special_instructions,
      userId: req.user.id
    });
    res.status(201).json(order);
  } catch (err) {
    if (err.message.includes('requis') || err.message.includes('invalide')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/customer-orders — list special customer orders
router.get('/', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { status, delivery_date } = req.query;
    const orders = await OrderService.getCustomerOrders({ status, delivery_date });
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// GET /api/customer-orders/:id — detail
router.get('/:id', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await OrderService.getCustomerOrderById(id);
    if (!order) {
      return res.status(404).json({ error: 'Commande client introuvable.' });
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// PUT /api/customer-orders/:id/status — change status (PENDING/IN_PRODUCTION/READY/DELIVERED/CANCELLED)
router.put('/:id/status', requireAuth, requireRole(['ADMIN', 'PRODUCTION']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    const order = await OrderService.updateCustomerOrderStatus(id, status);
    res.json(order);
  } catch (err) {
    if (err.message.includes('invalide') || err.message.includes('introuvable')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// PUT /api/customer-orders/:id — edit a PENDING order
router.put('/:id', requireAuth, requireRole(['ADMIN', 'CASHIER']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await OrderService.getCustomerOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Commande client introuvable.' });
    }
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ error: 'Seule une commande PENDING peut être modifiée.' });
    }

    const { customer_name, customer_phone, delivery_date, items, special_instructions } = req.body;
    const db = require('../db/connection');
    await db.transaction(async (trx) => {
      await trx('customer_order_items').where({ customer_order_id: id }).del();
      await trx('customer_orders').where({ id }).update({
        customer_name: customer_name !== undefined ? customer_name : existing.customer_name,
        customer_phone: customer_phone !== undefined ? customer_phone : existing.customer_phone,
        delivery_date: delivery_date !== undefined ? delivery_date : existing.delivery_date,
        special_instructions: special_instructions !== undefined ? special_instructions : existing.special_instructions
      });
      if (Array.isArray(items) && items.length > 0) {
        const products = await trx('products').whereIn('id', items.map((i) => i.product_id)).select('id', 'price');
        const productsById = Object.fromEntries(products.map((p) => [p.id, p]));
        let totalPrice = 0;
        const rows = items.map((item) => {
          const product = productsById[item.product_id];
          const qty = parseInt(item.quantity, 10);
          const subtotal = parseFloat((parseFloat(product.price) * qty).toFixed(2));
          totalPrice += subtotal;
          return { customer_order_id: id, product_id: item.product_id, quantity: qty, unit_price: parseFloat(product.price), subtotal };
        });
        await trx('customer_order_items').insert(rows);
        await trx('customer_orders').where({ id }).update({ total_price: parseFloat(totalPrice.toFixed(2)) });
      }
    });

    const updated = await OrderService.getCustomerOrderById(id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/customer-orders/:id — delete a PENDING order
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await OrderService.getCustomerOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Commande client introuvable.' });
    }
    if (existing.status !== 'PENDING') {
      return res.status(400).json({ error: 'Seule une commande PENDING peut être supprimée.' });
    }

    const db = require('../db/connection');
    await db.transaction(async (trx) => {
      await trx('customer_order_items').where({ customer_order_id: id }).del();
      await trx('customer_orders').where({ id }).del();
    });
    res.json({ message: `Commande client ${id} supprimée.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;