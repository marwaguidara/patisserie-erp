const jwt = require('jsonwebtoken');

// Environment-based JWT secret.
// A hardcoded fallback is provided ONLY for local development and automated
// tests; production REQUIRES JWT_SECRET to be set explicitly (see .env.example).
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_development_key';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET is not set in production. Define the JWT_SECRET environment variable (see .env.example).');
  process.exit(1);
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (req.user.role === 'ADMIN') {
      return next(); // ADMIN has full access
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]`
      });
    }

    next();
  };
}

/**
 * requireSelfOrAdmin — Middleware factory.
 *
 * Ensures that non-ADMIN users can ONLY access data belonging to themselves.
 *
 * The callback `getOwnerUserId(req)` must return the user-id that owns the
 * resource being requested (resolved from params, body, or query). If the
 * authenticated user is ADMIN the request always passes. Otherwise the
 * request is allowed only when `req.user.id === ownerUserId`.
 *
 * Usage:
 *   router.get('/:id', requireAuth, requireSelfOrAdmin((req) => parseInt(req.params.id, 10)), ...);
 */
function requireSelfOrAdmin(getOwnerUserId) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.user.role === 'ADMIN') {
      return next();
    }
    try {
      const ownerId = await getOwnerUserId(req, res);
      if (ownerId === null || ownerId === undefined) {
        // Resource does not exist or has no owner — deny to avoid information leak
        return res.status(404).json({ error: 'Resource not found.' });
      }
      if (parseInt(ownerId, 10) !== parseInt(req.user.id, 10)) {
        return res.status(403).json({ error: "Accès refusé : vous ne pouvez accéder qu'à vos propres données." });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * requirePermission — Permission-based authorization middleware.
 *
 * Unlike `requireRole` (which checks the role string directly), this checks a
 * **permission** key that maps to an allowed-role list. This is the foundation
 * for the future permissions table (2026) and supports a many-to-many
 * role↔permission model.
 *
 * Usage:
 *   router.get('/', requireAuth, requirePermission('view_employees'), handler);
 */
function requirePermission(permission, rolePermissions = DEFAULT_ROLE_PERMISSIONS) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.user.role === 'ADMIN') {
      return next();
    }
    const allowed = rolePermissions[permission] || [];
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Permission '${permission}' requires role(s): [${allowed.join(', ')}]`,
        permission
      });
    }
    next();
  };
}

/**
 * DEFAULT_ROLE_PERMISSIONS — Mapping of permission keys to the roles allowed.
 *
 * This is the single source of truth for role → permission mappings on the
 * backend. When the 2026 permissions DB table is introduced, these defaults
 * can be overridden per-tenant without code changes.
 *
 * RH module permissions:
 *   - view_profile, view_schedule, view_leave, view_hours : ALL authenticated non-admin roles
 *   - create_leave                                     : ALL authenticated non-admin roles
 *   - create_schedule, update_schedule                 : ADMIN only
 *   - approve_leave, reject_leave                      : ADMIN only
 *   - crud_employee                                    : ADMIN only
 *
 * Other module permissions (preserved from existing RBAC):
 *   - view_ai_forecast   : ADMIN, PRODUCTION, STOCK
 *   - run_ai_etl         : ADMIN
 *   - view_ai_anomalies  : ADMIN, STOCK
 *   - view_ai_segmentation: ADMIN
 */
const DEFAULT_ROLE_PERMISSIONS = {
  // ─── RH / Employés ─────────────────────────
  view_profile: ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'],
  view_schedule: ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'],
  view_leave: ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'],
  view_hours: ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'],
  create_leave: ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'],
  create_schedule: ['ADMIN'],
  update_schedule: ['ADMIN'],
  approve_leave: ['ADMIN'],
  reject_leave: ['ADMIN'],
  crud_employee: ['ADMIN'],
  view_employee_directory: ['ADMIN'], // non-ADMIN never sees the full directory

  // ─── Stock / Ingrédients ───────────────────
  view_ingredients: ['ADMIN', 'STOCK', 'PRODUCTION'],
  manage_ingredients: ['ADMIN', 'STOCK', 'PRODUCTION'],
  view_stock_alerts: ['ADMIN', 'STOCK'],

  // ─── Ventes ────────────────────────────────
  view_sales: ['ADMIN', 'CASHIER', 'PRODUCTION'],
  create_sale: ['ADMIN', 'CASHIER', 'PRODUCTION'],

  // ─── Fournisseurs / Achats ──────────────────
  view_suppliers: ['ADMIN', 'STOCK', 'PRODUCTION'],
  manage_suppliers: ['ADMIN', 'STOCK'],
  view_purchase_orders: ['ADMIN', 'STOCK', 'PRODUCTION'],
  manage_purchase_orders: ['ADMIN', 'STOCK'],

  // ─── Commandes Clients ────────────────────
  view_customer_orders: ['ADMIN', 'CASHIER', 'PRODUCTION'],
  manage_customer_orders: ['ADMIN', 'CASHIER'],

  // ─── Catalogue Produits ───────────────────
  view_products: ['ADMIN', 'PRODUCTION', 'STOCK', 'CASHIER', 'EMPLOYEE'],
  manage_products: ['ADMIN', 'PRODUCTION'],

  // ─── IA ────────────────────────────────────
  view_ai_forecast: ['ADMIN', 'PRODUCTION', 'STOCK'],
  run_ai_etl: ['ADMIN'],
  view_ai_anomalies: ['ADMIN', 'STOCK'],
  view_ai_segmentation: ['ADMIN'],
  view_ai_insights: ['ADMIN'],

  // ─── Dashboard ────────────────────────────
  view_dashboard: ['ADMIN'],

  // ─── Notifications ────────────────────────
  view_notifications: ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'],
  // Module-specific notification visibility is checked dynamically at collection time
};

module.exports = { requireAuth, requireRole, requireSelfOrAdmin, requirePermission, DEFAULT_ROLE_PERMISSIONS, JWT_SECRET };
