/**
 * NotificationService — RBAC-scoped notification engine.
 *
 * Rules:
 *   1. A notification is NEVER stored for a user who lacks the permission
 *      tied to the `permission` field. Enforced at write time.
 *   2. A personal notification (profile, schedule, leave) is sent ONLY to
 *      the concerned user.
 *   3. At read time, results are always re-filtered by the caller's role
 *      (defence-in-depth).
 */
const db = require('../db/connection');
const { DEFAULT_ROLE_PERMISSIONS } = require('../middleware/auth');

function rolesForPermission(permission) {
  return DEFAULT_ROLE_PERMISSIONS[permission] || [];
}

function roleHasPermission(role, permission) {
  if (role === 'ADMIN') return true;
  return (DEFAULT_ROLE_PERMISSIONS[permission] || []).includes(role);
}

class NotificationService {
    /**
   * createForUsers — create ONE notification per user_id, but only for users
   * whose role satisfies the `permission`. Users without the permission are
   * silently skipped (rule #1).
   */
  static async createForUsers(userIds, module, permission, payload) {
    const notifications = [];
    for (const userId of userIds) {
      const user = await db('users').where({ id: userId }).first('role');
      if (!user || !roleHasPermission(user.role, permission)) {
        continue;
      }
      const [id] = await db('notifications').insert({
        user_id: userId,
        module,
        permission,
        title: payload.title,
        message: payload.message || null,
        category: payload.category || module,
        priority: payload.priority || 'Information',
        target_tab: payload.target_tab || null,
        target_url: payload.target_url || null,
        channels: payload.channels ? JSON.stringify(payload.channels) : null,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      }).returning('id');
      const notifId = typeof id === 'object' ? id.id : id;
      notifications.push(notifId);
    }
    return notifications;
  }

  /**
   * createForRole — broadcast to ALL users whose role is in `allowedRoles`.
   */
  static async createForRole(allowedRoles, module, permission, payload) {
    const authorised = allowedRoles.filter((r) => roleHasPermission(r, permission));
    if (authorised.length === 0) return [];
    const users = await db('users').whereIn('role', authorised).select('id', 'role');
    const userIds = users.map((u) => u.id);
    return this.createForUsers(userIds, module, permission, payload);
  }

  /** createPersonal — send a notification to a single user (rule #2). */
  static async createPersonal(userId, module, permission, payload) {
    return this.createForUsers([userId], module, permission, payload);
  }

    /**
   * getForUser — retrieve notifications for the authenticated user, always
   * re-filtered by role at read time (defence-in-depth).
   */
  static async getForUser(userId, userRole, filters = {}) {
    let query = db('notifications').where(function () {
      this.where('user_id', userId);
      if (userRole !== 'ADMIN') {
        const perms = Object.keys(DEFAULT_ROLE_PERMISSIONS).filter((p) =>
          roleHasPermission(userRole, p)
        );
        this.orWhere(function () {
          this.whereNull('user_id').whereIn('permission', perms);
        });
      }
    });

    if (filters.unread_only) query = query.where('is_read', false);
    if (filters.module) query = query.where('module', filters.module);
    if (filters.category) query = query.where('category', filters.category);

    const all = await query.orderBy('created_at', 'desc').limit(100);
    return all.filter((n) => roleHasPermission(userRole, n.permission));
  }

  static async getUnreadCount(userId, userRole) {
    const items = await this.getForUser(userId, userRole, { unread_only: true });
    return items.length;
  }

  static async markRead(notificationId, userId) {
    return db('notifications').where({ id: notificationId, user_id: userId }).update({ is_read: true });
  }

  static async markAllRead(userId) {
    return db('notifications').where({ user_id: userId, is_read: false }).update({ is_read: true });
  }

  static async deleteForUser(notificationId, userId) {
    return db('notifications').where({ id: notificationId, user_id: userId }).del();
  }
}

module.exports = NotificationService;