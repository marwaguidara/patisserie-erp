const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/suppliers
router.get('/', requireAuth, requireRole(['ADMIN', 'STOCK', 'PRODUCTION']), async (req, res, next) => {
  try {
    const suppliers = await db('suppliers').select('*');
    res.json(suppliers);
  } catch (err) {
    next(err);
  }
});

// GET /api/suppliers/:id
router.get('/:id', requireAuth, requireRole(['ADMIN', 'STOCK', 'PRODUCTION']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const supplier = await db('suppliers').where({ id }).first();
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found.' });
    }

    const purchaseOrders = await db('purchase_orders')
      .where({ supplier_id: id })
      .orderBy('created_at', 'desc');

    const ordersCount = await db('purchase_orders').where({ supplier_id: id }).count('id as count').first();
    const totalCostRow = await db('purchase_orders').where({ supplier_id: id }).sum('total_cost as total_cost').first();

    const ingredientCountRow = await db('ingredients').where({ supplier_id: id }).count('id as count').first();
    const ingredients = await db('ingredients').where({ supplier_id: id }).select('id', 'name', 'current_stock', 'cost_per_unit');

    const performance = {
      purchase_orders: ordersCount ? Number(ordersCount.count) : 0,
      total_spend: totalCostRow ? Number(totalCostRow.total_cost || 0) : 0,
      ingredients_count: ingredientCountRow ? Number(ingredientCountRow.count) : 0
    };

    res.json({ ...supplier, purchase_orders: purchaseOrders, performance, ingredients });
  } catch (err) {
    next(err);
  }
});

const { recordAudit } = require('../middleware/auditHelper');

// POST /api/suppliers
router.post('/', requireAuth, requireRole(['ADMIN', 'STOCK']), async (req, res, next) => {
  try {
    const { name, contact_person, email, phone, address, lead_time, quality, rating } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Supplier name is required.' });
    }

    const [id] = await db('suppliers').insert({
      name,
      contact_person: contact_person || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      lead_time: lead_time || null,
      quality: quality || null,
      rating: rating !== undefined ? rating : null
    }).returning('id');

    const supplierId = typeof id === 'object' ? id.id : id;
    const created = await db('suppliers').where({ id: supplierId }).first();

    await recordAudit(req, {
      action: 'CREATE_SUPPLIER',
      entity_type: 'supplier',
      entity_id: supplierId,
      new_values: created
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/suppliers/:id
router.put('/:id', requireAuth, requireRole(['ADMIN', 'STOCK']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('suppliers').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Supplier not found.' });
    }

    const { name, contact_person, email, phone, address, lead_time, quality, rating } = req.body;
    await db('suppliers').where({ id }).update({
      name: name !== undefined ? name : existing.name,
      contact_person: contact_person !== undefined ? contact_person : existing.contact_person,
      email: email !== undefined ? email : existing.email,
      phone: phone !== undefined ? phone : existing.phone,
      address: address !== undefined ? address : existing.address,
      lead_time: lead_time !== undefined ? lead_time : existing.lead_time,
      quality: quality !== undefined ? quality : existing.quality,
      rating: rating !== undefined ? rating : existing.rating
    });

    const updated = await db('suppliers').where({ id }).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/suppliers/:id
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('suppliers').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Supplier not found.' });
    }

    const ingredientsUsing = await db('ingredients').where({ supplier_id: id }).first();
    if (ingredientsUsing) {
      return res.status(400).json({ error: 'Impossible de supprimer le fournisseur car des ingrédients y sont rattachés.' });
    }

    // Guard against the schema-level CASCADE: deleting a supplier with
    // purchase orders would silently destroy order history. Refuse deletion
    // so purchase_order / purchase_order_items records are preserved.
    const purchaseOrderUsing = await db('purchase_orders').where({ supplier_id: id }).first();
    if (purchaseOrderUsing) {
      return res.status(400).json({ error: 'Impossible de supprimer le fournisseur car des commandes fournisseur (purchase_orders) y sont rattachées.' });
    }

    await db('suppliers').where({ id }).del();
    res.json({ message: `Supplier ${id} deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
