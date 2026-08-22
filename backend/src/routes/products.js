const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');
const StockService = require('../services/stockService');
const { invalidateForecastCache } = require('../services/aiCacheService');

const router = express.Router();

// GET /api/products
router.get('/', async (req, res, next) => {
  try {
    const { category_id, search } = req.query;

    let query = db('products')
      .leftJoin('categories', 'products.category_id', 'categories.id')
      .select(
        'products.id',
        'products.name',
        'products.description',
        'products.price',
        'products.stock_quantity',
        'products.is_active',
        'categories.id as category_id',
        'categories.name as category_name'
      );

    if (category_id) {
      query = query.where('products.category_id', category_id);
    }

    if (search) {
      query = query.where('products.name', 'like', `%${search}%`);
    }

    const products = await query;

    for (const product of products) {
      const recipe = await db('recipe_items')
        .join('ingredients', 'recipe_items.ingredient_id', 'ingredients.id')
        .where('recipe_items.product_id', product.id)
        .select(
          'ingredients.id as ingredient_id',
          'ingredients.name as ingredient_name',
          'ingredients.unit',
          'ingredients.current_stock',
          'ingredients.minimum_stock',
          'recipe_items.quantity_required'
        );
      product.ingredients = recipe;
    }

    res.json(products);
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const product = await db('products')
      .leftJoin('categories', 'products.category_id', 'categories.id')
      .where('products.id', id)
      .select(
        'products.*',
        'categories.name as category_name'
      )
      .first();

    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const recipe = await db('recipe_items')
      .join('ingredients', 'recipe_items.ingredient_id', 'ingredients.id')
      .where('recipe_items.product_id', id)
      .select(
        'ingredients.id as ingredient_id',
        'ingredients.name as ingredient_name',
        'ingredients.unit',
        'ingredients.current_stock',
        'recipe_items.quantity_required'
      );

    product.ingredients = recipe;
    res.json(product);
  } catch (err) {
    next(err);
  }
});

const { recordAudit } = require('../middleware/auditHelper');

// POST /api/products
router.post('/', requireAuth, requireRole(['ADMIN', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { name, description, price, category_id, stock_quantity, recipe } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Product name and price are required.' });
    }

    const [productId] = await db('products').insert({
      name,
      description,
      price,
      category_id: category_id || null,
      stock_quantity: stock_quantity || 0
    });

    const id = typeof productId === 'object' ? productId.id : productId;

    if (Array.isArray(recipe) && recipe.length > 0) {
      const recipeRows = recipe.map((item) => ({
        product_id: id,
        ingredient_id: item.ingredient_id,
        quantity_required: item.quantity_required
      }));
      await db('recipe_items').insert(recipeRows);
    }

    const created = await db('products').where({ id }).first();

    await recordAudit(req, {
      action: 'CREATE_PRODUCT',
      entity_type: 'product',
      entity_id: id,
      new_values: created
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/products/:id
router.put('/:id', requireAuth, requireRole(['ADMIN', 'PRODUCTION']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, description, price, category_id, stock_quantity, is_active } = req.body;

    const existing = await db('products').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    await db('products').where({ id }).update({
      name: name !== undefined ? name : existing.name,
      description: description !== undefined ? description : existing.description,
      price: price !== undefined ? price : existing.price,
      category_id: category_id !== undefined ? category_id : existing.category_id,
      stock_quantity: stock_quantity !== undefined ? stock_quantity : existing.stock_quantity,
      is_active: is_active !== undefined ? is_active : existing.is_active
    });

    const updated = await db('products').where({ id }).first();

    await recordAudit(req, {
      action: 'UPDATE_PRODUCT',
      entity_type: 'product',
      entity_id: id,
      old_values: existing,
      new_values: updated
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/products/:id
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('products').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    await db('products').where({ id }).del();

    await recordAudit(req, {
      action: 'DELETE_PRODUCT',
      entity_type: 'product',
      entity_id: id,
      old_values: existing
    });

    res.json({ message: `Product ${id} deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id/recipe
router.get('/:id/recipe', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const recipe = await db('recipe_items')
      .join('ingredients', 'recipe_items.ingredient_id', 'ingredients.id')
      .where('recipe_items.product_id', id)
      .select(
        'recipe_items.id as recipe_item_id',
        'ingredients.id as ingredient_id',
        'ingredients.name as ingredient_name',
        'ingredients.unit',
        'recipe_items.quantity_required'
      );
    res.json(recipe);
  } catch (err) {
    next(err);
  }
});

// POST /api/products/:id/recipe (Set or update recipe ingredients)
router.post('/:id/recipe', requireAuth, requireRole(['ADMIN', 'PRODUCTION']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { items } = req.body; // Array of { ingredient_id, quantity_required }

    const product = await db('products').where({ id }).first();
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array of recipe items.' });
    }

    await db.transaction(async (trx) => {
      // Clear existing recipe items for this product
      await trx('recipe_items').where({ product_id: id }).del();

      if (items.length > 0) {
        const rows = items.map((item) => ({
          product_id: id,
          ingredient_id: item.ingredient_id,
          quantity_required: item.quantity_required
        }));
        await trx('recipe_items').insert(rows);
      }
    });

    const updatedRecipe = await db('recipe_items')
      .join('ingredients', 'recipe_items.ingredient_id', 'ingredients.id')
      .where('recipe_items.product_id', id)
      .select(
        'ingredients.id as ingredient_id',
        'ingredients.name as ingredient_name',
        'ingredients.unit',
        'recipe_items.quantity_required'
      );

    res.json({ message: 'Recipe updated successfully.', recipe: updatedRecipe });
  } catch (err) {
    next(err);
  }
});

// POST /api/products/:id/produce
router.post('/:id/produce', requireAuth, requireRole(['ADMIN', 'PRODUCTION']), async (req, res, next) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const { quantity } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Production quantity must be a positive integer.' });
    }

    const result = await StockService.produceProduct(productId, quantity, req.user ? req.user.id : null);
    // Production changed the finished-good stock -> invalidate AI caches for this product (best-effort).
    invalidateForecastCache([productId]).catch((err) => {
      console.warn('[ai-cache] post-production invalidation error:', err.message);
    });
    res.json({
      message: `Successfully produced ${quantity} units. Ingredient stock updated.`,
      result
    });
  } catch (err) {
    if (err.message.includes('Insufficient ingredient stock') || err.message.includes('not found')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
