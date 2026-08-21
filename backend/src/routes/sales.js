const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const SalesService = require('../services/salesService');

const router = express.Router();
console.log('Loaded routes/sales.js');

const { recordAudit } = require('../middleware/auditHelper');

// POST /api/sales
router.post('/', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { items, paymentMethod, customerName, customerPhone } = req.body;
    const cashierId = req.user.id;

    const sale = await SalesService.createSale({
      cashierId,
      items,
      paymentMethod,
      customerName,
      customerPhone,
      userId: req.user.id
    });

    await recordAudit(req, {
      action: 'CREATE_SALE',
      entity_type: 'sale',
      entity_id: sale.id,
      new_values: sale
    });

    res.status(201).json(sale);
  } catch (err) {
    if (err.message.includes('Required') || err.message.includes('Invalid') || err.message.includes('Insufficient') || err.message.includes('positive quantity')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/sales
router.get('/', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  console.log('Handling GET /api/sales request for user', req.user && req.user.email);
  try {
    const { period, product_id, start_date, end_date } = req.query;
    const sales = await SalesService.getSales({ period, product_id, start_date, end_date });
    res.json(sales);
  } catch (err) {
    next(err);
  }
});

// GET /api/sales/history
router.get('/history', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  try {
    const { period, product_id, start_date, end_date } = req.query;
    const history = await SalesService.getSalesHistory({ period, product_id, start_date, end_date });
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// GET /api/sales/metrics
router.get('/metrics', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  try {
    const metrics = await SalesService.getSalesMetrics();
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

// GET /api/sales/:id/ticket/html
router.get('/:id/ticket/html', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  try {
    const saleId = parseInt(req.params.id, 10);
    const html = await SalesService.generateTicketHtml(saleId);
    if (!html) {
      return res.status(404).json({ error: 'Sale not found.' });
    }
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// GET /api/sales/:id
router.get('/:id', requireAuth, requireRole(['ADMIN', 'CASHIER', 'PRODUCTION']), async (req, res, next) => {
  try {
    const saleId = parseInt(req.params.id, 10);
    const sale = await SalesService.getSaleById(saleId);
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found.' });
    }
    res.json(sale);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
