const express = require('express');
const NotificationService = require('../services/notificationService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/notifications
 * Returns RBAC-filtered notifications for the authenticated user.
 *
 * Filters:
 *   ?unread=true   — only unread
 *   ?module=stock  — filter by module
 *   ?category=ia   — filter by category
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { unread, module, category, limit } = req.query;
    const filters = {};
    if (unread === 'true') filters.unread_only = true;
    if (module) filters.module = module;
    if (category) filters.category = category;

    const items = await NotificationService.getForUser(req.user.id, req.user.role, filters);
    const result = limit ? items.slice(0, parseInt(limit, 10)) : items;
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/notifications/unread-count
 * Returns the count of unread notifications visible to the current user.
 */
router.get('/unread-count', requireAuth, async (req, res, next) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user.id, req.user.role);
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read (only for the owner).
 */
router.put('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const notifId = parseInt(req.params.id, 10);
    await NotificationService.markRead(notifId, req.user.id);
    res.json({ message: 'Notification marked as read.' });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for the current user.
 */
router.put('/read-all', requireAuth, async (req, res, next) => {
  try {
    await NotificationService.markAllRead(req.user.id);
    res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification (only for the owner).
 */
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const notifId = parseInt(req.params.id, 10);
    await NotificationService.deleteForUser(notifId, req.user.id);
    res.json({ message: 'Notification supprimée.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;