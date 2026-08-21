const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const OrderService = require('../services/orderService');
const { invalidateAllAiCaches } = require('../services/aiCacheService');

const router = express.Router();

const { recordAudit } = require('../middleware/auditHelper');

// POST /api/purchase-orders — create a supplier order (DRAFT)
router.post('/', requireAuth, requireRole(['ADMIN', 'STOCK']), async (req, res, next) => {
  try {
    const { supplier_id, items } = req.body;
    const order = await OrderService.createPurchaseOrder({
      supplierId: supplier_id,
      items,
      userId: req.user.id
    });

    await recordAudit(req, {
      action: 'CREATE_ORDER',
      entity_type: 'purchase_order',
      entity_id: order.id,
      new_values: order
    });

    res.status(201).json(order);
  } catch (err) {
    if (err.message.includes('requis') || err.message.includes('introuvable') || err.message.includes('invalide')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/purchase-orders — list supplier orders
router.get('/', requireAuth, requireRole(['ADMIN', 'STOCK', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { status, supplier_id } = req.query;
    const orders = await OrderService.getPurchaseOrders({ status, supplier_id });
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// GET /api/purchase-orders/:id — detail
router.get('/:id', requireAuth, requireRole(['ADMIN', 'STOCK', 'PRODUCTION']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await OrderService.getPurchaseOrderById(id);
    if (!order) {
      return res.status(404).json({ error: 'Commande fournisseur introuvable.' });
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// PUT /api/purchase-orders/:id/status — change status (DRAFT/ORDERED/RECEIVED/CANCELLED)
router.put('/:id/status', requireAuth, requireRole(['ADMIN', 'STOCK']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    const order = await OrderService.updatePurchaseOrderStatus(id, status, req.user.id);
    // A received supplier order refreshes raw-material stock -> invalidate all AI caches (best-effort).
    if (status === 'RECEIVED') {
      invalidateAllAiCaches().catch((err) => {
        console.warn('[ai-cache] post-receipt invalidation error:', err.message);
      });

      await recordAudit(req, {
        action: 'RECEIVE_ORDER',
        entity_type: 'purchase_order',
        entity_id: id,
        new_values: order
      });
    }
    res.json(order);
  } catch (err) {
    if (err.message.includes('invalide') || err.message.includes('introuvable') || err.message.includes('Impossible') || err.message.includes('Seule')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// PUT /api/purchase-orders/:id — edit a DRAFT order
router.put('/:id', requireAuth, requireRole(['ADMIN', 'STOCK']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await OrderService.getPurchaseOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Commande fournisseur introuvable.' });
    }
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Seule une commande DRAFT peut être modifiée.' });
    }

    const { supplier_id, items } = req.body;
    // Recreate via the service (delete + insert lines) for simplicity
    const db = require('../db/connection');
    await db.transaction(async (trx) => {
      await trx('purchase_order_items').where({ purchase_order_id: id }).del();
      if (supplier_id) {
        await trx('purchase_orders').where({ id }).update({ supplier_id });
      }
      if (Array.isArray(items) && items.length > 0) {
        let totalCost = 0;
        const rows = items.map((item) => {
          const qty = parseFloat(item.quantity_ordered);
          const unitCost = parseFloat(item.unit_cost);
          totalCost += qty * unitCost;
          return { purchase_order_id: id, ingredient_id: item.ingredient_id, quantity_ordered: qty, unit_cost: unitCost };
        });
        await trx('purchase_order_items').insert(rows);
        await trx('purchase_orders').where({ id }).update({ total_cost: parseFloat(totalCost.toFixed(2)) });
      }
    });

    const updated = await OrderService.getPurchaseOrderById(id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/purchase-orders/:id — delete a DRAFT order
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await OrderService.getPurchaseOrderById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Commande fournisseur introuvable.' });
    }
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Seule une commande DRAFT peut être supprimée.' });
    }

    const db = require('../db/connection');
    await db.transaction(async (trx) => {
      await trx('purchase_order_items').where({ purchase_order_id: id }).del();
      await trx('purchase_orders').where({ id }).del();
    });
    res.json({ message: `Commande fournisseur ${id} supprimée.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;