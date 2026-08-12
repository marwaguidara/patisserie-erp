const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const AnalyticsService = require('../services/analyticsService');

const router = express.Router();

// GET /api/analytics/export — consolidated historical dataset for the future
// AI/analytics phase. Read-only; ADMIN only.
router.get('/export', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const data = await AnalyticsService.getExportData();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;