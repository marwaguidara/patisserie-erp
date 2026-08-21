const AuditLogService = require('../services/auditLogService');

/**
 * Utilitaire pour enregistrer une action d'audit depuis un objet Request Express.
 *
 * @param {Object} req - Express Request
 * @param {Object} auditDetails - { action, entity_type, entity_id, old_values, new_values, user_id }
 */
async function recordAudit(req, { action, entity_type = null, entity_id = null, old_values = null, new_values = null, user_id = null }) {
  const userId = user_id || (req.user ? req.user.id : null);
  const ipAddress = req.ip || (req.connection && req.connection.remoteAddress) || null;
  const userAgent = req.headers ? req.headers['user-agent'] : null;

  return await AuditLogService.logAction({
    user_id: userId,
    action,
    entity_type,
    entity_id,
    old_values,
    new_values,
    ip_address: ipAddress,
    user_agent: userAgent
  });
}

module.exports = { recordAudit };
