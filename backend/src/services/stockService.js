const db = require('../db/connection');

class StockService {
  /**
   * Apply a stock movement manually (IN, OUT, WASTE, ADJUSTMENT).
   */
  static async applyMovement({ ingredientId, movementType, quantity, reason, expirationDate, batchNumber, userId }, trxOuter = null) {
    const executeLogic = async (trx) => {
      const ingredient = await trx('ingredients').where({ id: ingredientId }).first();
      if (!ingredient) {
        throw new Error(`Ingredient with ID ${ingredientId} not found.`);
      }

      const qty = parseFloat(quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error('Quantity must be a positive number.');
      }

      let stockChange = 0;
      if (['IN'].includes(movementType)) {
        stockChange = qty;
      } else if (['OUT', 'WASTE'].includes(movementType)) {
        stockChange = -qty;
      } else if (['ADJUSTMENT'].includes(movementType)) {
        // For adjustment, quantity represents the target stock value
        stockChange = qty - parseFloat(ingredient.current_stock);
      } else {
        throw new Error(`Invalid movement type: ${movementType}`);
      }

      // Check for negative stock result
      const newStock = parseFloat(ingredient.current_stock) + stockChange;
      if (newStock < 0) {
        throw new Error(`Insufficient stock for ${ingredient.name}. Current: ${ingredient.current_stock}, Requested deduction: ${Math.abs(stockChange)}.`);
      }

      // Update ingredient table
      const updateData = { current_stock: newStock };
      if (expirationDate) {
        updateData.expiration_date = expirationDate;
      }

      await trx('ingredients').where({ id: ingredientId }).update(updateData);

      // Ensure created_by exists, otherwise set to null to avoid FK constraint
      let createdBy = null;
      if (userId) {
        const userExists = await trx('users').where({ id: userId }).first().catch(() => null);
        createdBy = userExists ? userId : null;
      }

      // Record movement
      await trx('stock_movements').insert({
        ingredient_id: ingredientId,
        movement_type: movementType,
        quantity: Math.abs(qty),
        reason: reason || `Manual movement: ${movementType}`,
        batch_number: batchNumber || null,
        expiration_date: expirationDate || null,
        created_by: createdBy
      });

      const updated = await trx('ingredients').where({ id: ingredientId }).first();
      return updated;
    };

    if (trxOuter) {
      return await executeLogic(trxOuter);
    }
    return await db.transaction(executeLogic);
  }

  /**
   * Produce a batch of products and deduct ingredient stock according to recipe.
   */
  static async produceProduct(productId, batchQuantity, userId) {
    return await db.transaction(async (trx) => {
      const product = await trx('products').where({ id: productId }).first();
      if (!product) {
        throw new Error(`Product with ID ${productId} not found.`);
      }

      const recipeItems = await trx('recipe_items')
        .where({ product_id: productId })
        .join('ingredients', 'recipe_items.ingredient_id', 'ingredients.id')
        .select(
          'ingredients.id as ingredient_id',
          'ingredients.name as ingredient_name',
          'ingredients.current_stock',
          'ingredients.minimum_stock',
          'recipe_items.quantity_required'
        );

      if (recipeItems.length === 0) {
        throw new Error(`Product "${product.name}" has no defined recipe ingredients.`);
      }

      // Check stock sufficiency
      const insufficient = [];
      for (const item of recipeItems) {
        const totalRequired = parseFloat(item.quantity_required) * batchQuantity;
        if (parseFloat(item.current_stock) < totalRequired) {
          insufficient.push({
            ingredient: item.ingredient_name,
            available: item.current_stock,
            required: totalRequired
          });
        }
      }

      if (insufficient.length > 0) {
        const details = insufficient
          .map((i) => `${i.ingredient} (Available: ${i.available}, Required: ${i.required})`)
          .join(', ');
        throw new Error(`Insufficient ingredient stock: ${details}`);
      }

      // Deduct ingredients and record stock movements
      for (const item of recipeItems) {
        const totalDeduction = parseFloat(item.quantity_required) * batchQuantity;

        await trx('ingredients')
          .where({ id: item.ingredient_id })
          .decrement('current_stock', totalDeduction);

        // validate created_by
        let createdByProd = null;
        if (userId) {
          const userExists = await trx('users').where({ id: userId }).first().catch(() => null);
          createdByProd = userExists ? userId : null;
        }

        await trx('stock_movements').insert({
          ingredient_id: item.ingredient_id,
          movement_type: 'PRODUCTION',
          quantity: totalDeduction,
          reason: `Production of ${batchQuantity}x ${product.name}`,
          created_by: createdByProd
        });
      }

      // Increase finished product stock
      await trx('products')
        .where({ id: productId })
        .increment('stock_quantity', batchQuantity);

      const updatedProduct = await trx('products').where({ id: productId }).first();
      const updatedIngredients = await trx('ingredients')
        .whereIn('id', recipeItems.map((r) => r.ingredient_id))
        .select('id', 'name', 'current_stock', 'minimum_stock', 'unit');

      // Check alerts
      const alerts = updatedIngredients.filter((i) => parseFloat(i.current_stock) <= parseFloat(i.minimum_stock));

      return {
        product: updatedProduct,
        produced_quantity: batchQuantity,
        updated_ingredients: updatedIngredients,
        alerts
      };
    });
  }

  /**
   * Reduce finished product inventory when a sale is completed.
   */
  static async sellProduct(productId, quantity, userId, trx = null) {
    const executor = trx || db;
    const product = await executor('products').where({ id: productId }).first();
    if (!product) {
      throw new Error(`Product with ID ${productId} not found.`);
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('Quantity must be a positive number.');
    }

    if (parseInt(product.stock_quantity, 10) < qty) {
      throw new Error(`Insufficient product stock for ${product.name}. Available: ${product.stock_quantity}, requested: ${qty}`);
    }

    await executor('products').where({ id: productId }).decrement('stock_quantity', qty);

    if (trx) {
      return await executor('products').where({ id: productId }).first();
    }

    return await executor('products').where({ id: productId }).first();
  }

  /**
   * Fetch all stock alerts (Low Stock & Close Expiration <= 7 days).
   */
  static async getAlerts() {
    const today = new Date();
    const alertDate = new Date(today);
    alertDate.setDate(today.getDate() + 7);
    const alertDateStr = alertDate.toISOString().split('T')[0];

    const allIngredients = await db('ingredients')
      .leftJoin('suppliers', 'ingredients.supplier_id', 'suppliers.id')
      .select(
        'ingredients.*',
        'suppliers.name as supplier_name'
      );

    const lowStockAlerts = [];
    const expiringSoonAlerts = [];

    for (const ing of allIngredients) {
      const current = parseFloat(ing.current_stock);
      const min = parseFloat(ing.minimum_stock);

      if (current <= min) {
        lowStockAlerts.push(ing);
      }

      if (ing.expiration_date && ing.expiration_date <= alertDateStr) {
        expiringSoonAlerts.push(ing);
      }
    }

    return {
      low_stock_count: lowStockAlerts.length,
      expiring_soon_count: expiringSoonAlerts.length,
      low_stock: lowStockAlerts,
      expiring_soon: expiringSoonAlerts
    };
  }
}

module.exports = StockService;
