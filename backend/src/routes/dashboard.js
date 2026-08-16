const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const DashboardService = require('../services/dashboardService');

const router = express.Router();

/**
 * GET /api/dashboard/summary
 * Sprint 5 — ADMIN strategic dashboard.
 * Constraint 1: KPIs read directly from core services (SalesService / StockService) — never recomputed.
 * Constraint 2: IA outputs fetched from already-existing /ai/* endpoints — never recomputed.
 * Constraint 3: 5-min in-memory cache (TTL) because this is the most expensive endpoint.
 * RBAC: ADMIN only (strategic view).
 */
router.get('/summary', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
  try {
    const summary = await DashboardService.getSummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
