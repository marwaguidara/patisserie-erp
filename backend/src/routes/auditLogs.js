const express = require('express');
const router = express.Router();
const AuditLogService = require('../services/auditLogService');
const { requireAuth, requireRole } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/audit-logs (ou GET /audit-logs)
 * Récupère la liste des journaux d'audit avec pagination et filtres.
 * Restreint aux utilisateurs avec le rôle ADMIN.
 */
router.get('/', requireAuth, requireRole(['ADMIN']), asyncHandler(async (req, res) => {
  const result = await AuditLogService.getLogs(req.query);
  res.json({
    success: true,
    data: result.data,
    pagination: result.pagination
  });
}));

module.exports = router;
