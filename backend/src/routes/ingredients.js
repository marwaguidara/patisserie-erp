const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');
const StockService = require('../services/stockService');

const router = express.Router();

// GET /api/ingredients/alerts or /api/stocks/alerts
router.get('/alerts', async (req, res, next) => {
  try {
    const alerts = await StockService.getAlerts();
    res.json(alerts);
  } catch (err) {
    next(err);
  }
});

// GET /api/ingredients
router.get('/', async (req, res, next) => {
  try {
    const { search, status } = req.query;

    let query = db('ingredients')
      .leftJoin('suppliers', 'ingredients.supplier_id', 'suppliers.id')
      .select(
        'ingredients.id',
        'ingredients.name',
        'ingredients.unit',
        'ingredients.current_stock',
        'ingredients.minimum_stock',
        'ingredients.cost_per_unit',
        'ingredients.expiration_date',
        'suppliers.id as supplier_id',
        'suppliers.name as supplier_name'
      );

    if (search) {
      query = query.where('ingredients.name', 'like', `%${search}%`);
    }

    const ingredients = await query;

    const today = new Date();
    const alert7Days = new Date(today);
    alert7Days.setDate(today.getDate() + 7);
    const alert7DaysStr = alert7Days.toISOString().split('T')[0];

    const result = ingredients.map((ing) => {
      const isLowStock = parseFloat(ing.current_stock) <= parseFloat(ing.minimum_stock);
      const isExpiringSoon = ing.expiration_date && ing.expiration_date <= alert7DaysStr;
      return {
        ...ing,
        is_low_stock: isLowStock,
        is_expiring_soon: isExpiringSoon
      };
    });

    if (status === 'low_stock') {
      return res.json(result.filter((i) => i.is_low_stock));
    } else if (status === 'expiring_soon') {
      return res.json(result.filter((i) => i.is_expiring_soon));
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/ingredients/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ingredient = await db('ingredients')
      .leftJoin('suppliers', 'ingredients.supplier_id', 'suppliers.id')
      .where('ingredients.id', id)
      .select(
        'ingredients.*',
        'suppliers.name as supplier_name'
      )
      .first();

    if (!ingredient) {
      return res.status(404).json({ error: 'Ingredient not found.' });
    }

    const movements = await db('stock_movements')
      .where({ ingredient_id: id })
      .orderBy('created_at', 'desc')
      .limit(20);

    res.json({ ingredient, movements });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingredients
router.post('/', requireAuth, requireRole(['ADMIN', 'STOCK', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { name, unit, current_stock, minimum_stock, cost_per_unit, expiration_date, supplier_id } = req.body;

    if (!name || !unit) {
      return res.status(400).json({ error: 'Ingredient name and unit are required.' });
    }

    const [id] = await db('ingredients').insert({
      name,
      unit,
      current_stock: current_stock !== undefined ? current_stock : 0,
      minimum_stock: minimum_stock !== undefined ? minimum_stock : 0,
      cost_per_unit: cost_per_unit !== undefined ? cost_per_unit : 0,
      expiration_date: expiration_date || null,
      supplier_id: supplier_id || null
    });

    const ingId = typeof id === 'object' ? id.id : id;
    const created = await db('ingredients').where({ id: ingId }).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/ingredients/:id
router.put('/:id', requireAuth, requireRole(['ADMIN', 'STOCK', 'PRODUCTION']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, unit, minimum_stock, cost_per_unit, expiration_date, supplier_id } = req.body;

    const existing = await db('ingredients').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Ingredient not found.' });
    }

    await db('ingredients').where({ id }).update({
      name: name !== undefined ? name : existing.name,
      unit: unit !== undefined ? unit : existing.unit,
      minimum_stock: minimum_stock !== undefined ? minimum_stock : existing.minimum_stock,
      cost_per_unit: cost_per_unit !== undefined ? cost_per_unit : existing.cost_per_unit,
      expiration_date: expiration_date !== undefined ? expiration_date : existing.expiration_date,
      supplier_id: supplier_id !== undefined ? supplier_id : existing.supplier_id
    });

    const updated = await db('ingredients').where({ id }).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/ingredients/:id
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('ingredients').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Ingredient not found.' });
    }

    // Check if ingredient is used in any active product recipes
    const usedInRecipes = await db('recipe_items').where({ ingredient_id: id });
    if (usedInRecipes.length > 0) {
      return res.status(400).json({
        error: `Impossible de supprimer l'ingrédient "${existing.name}" car il est utilisé dans ${usedInRecipes.length} recette(s) produit.`
      });
    }

    await db.transaction(async (trx) => {
      await trx('stock_movements').where({ ingredient_id: id }).del();
      await trx('ingredients').where({ id }).del();
    });

    res.json({ message: `Ingredient ${id} deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

const { recordAudit } = require('../middleware/auditHelper');

// POST /api/ingredients/:id/movement or POST /api/stocks/movement
router.post('/:id/movement', requireAuth, requireRole(['ADMIN', 'STOCK', 'PRODUCTION']), async (req, res, next) => {
  try {
    const ingredientId = parseInt(req.params.id, 10);
    const { movement_type, quantity, reason, expiration_date, batch_number } = req.body;

    const updated = await StockService.applyMovement({
      ingredientId,
      movementType: movement_type,
      quantity,
      reason,
      expirationDate: expiration_date,
      batchNumber: batch_number,
      userId: req.user ? req.user.id : null
    });

    await recordAudit(req, {
      action: 'STOCK_ADJUSTMENT',
      entity_type: 'ingredient',
      entity_id: ingredientId,
      new_values: { movement_type, quantity, reason, expiration_date, batch_number, updated_stock: updated.current_stock }
    });

    res.json({ message: 'Stock movement recorded successfully.', ingredient: updated });
  } catch (err) {
    if (err.message.includes('Insufficient stock') || err.message.includes('not found') || err.message.includes('Invalid')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
