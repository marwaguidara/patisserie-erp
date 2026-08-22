const express = require('express');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/categories
router.get('/', async (req, res, next) => {
  try {
    const categories = await db('categories').select('*');
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// POST /api/categories
router.post('/', requireAuth, requireRole(['ADMIN', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required.' });
    }

    const [id] = await db('categories').insert({ name, description });
    const catId = typeof id === 'object' ? id.id : id;

    const created = await db('categories').where({ id: catId }).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/categories/:id
router.put('/:id', requireAuth, requireRole(['ADMIN', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const id = parseInt(req.params.id, 10);

    const existing = await db('categories').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    await db('categories').where({ id }).update({
      name: name !== undefined ? name : existing.name,
      description: description !== undefined ? description : existing.description
    });

    const updated = await db('categories').where({ id }).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/categories/:id
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('categories').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    await db('categories').where({ id }).del();
    res.json({ message: `Category ${id} deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
