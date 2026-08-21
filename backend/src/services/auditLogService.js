const db = require('../db/connection');

class AuditLogService {
  /**
   * Enregistre une entrée d'audit dans la table audit_logs.
   */
  static async logAction({
    user_id = null,
    action,
    entity_type = null,
    entity_id = null,
    old_values = null,
    new_values = null,
    ip_address = null,
    user_agent = null
  }) {
    try {
      const entry = {
        user_id,
        action,
        entity_type,
        entity_id: entity_id !== null && entity_id !== undefined ? String(entity_id) : null,
        old_values: old_values ? (typeof old_values === 'object' ? JSON.stringify(old_values) : old_values) : null,
        new_values: new_values ? (typeof new_values === 'object' ? JSON.stringify(new_values) : new_values) : null,
        ip_address,
        user_agent: user_agent ? String(user_agent).substring(0, 500) : null,
        created_at: new Date().toISOString()
      };

      const [insertedId] = await db('audit_logs').insert(entry).returning('id');
      return typeof insertedId === 'object' ? insertedId.id : insertedId;
    } catch (error) {
      console.error('[AuditLogService] Erreur lors de l\'enregistrement de l\'audit :', error.message);
      // L'échec du log d'audit ne doit pas bloquer la transaction métier principale
      return null;
    }
  }

  /**
   * Récupère les journaux d'audit avec filtres et pagination.
   */
  static async getLogs(query = {}) {
    const page = Math.max(1, parseInt(query.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || 20, 10)));
    const offset = (page - 1) * limit;

    let baseQuery = db('audit_logs')
      .leftJoin('users', 'audit_logs.user_id', 'users.id')
      .select(
        'audit_logs.*',
        'users.name as user_name',
        'users.email as user_email',
        'users.role as user_role'
      );

    // Filtre par utilisateur
    if (query.user_id) {
      baseQuery = baseQuery.where('audit_logs.user_id', query.user_id);
    }

    // Filtre par action
    if (query.action) {
      baseQuery = baseQuery.where('audit_logs.action', query.action);
    }

    // Filtre par plage de dates
    if (query.start_date) {
      baseQuery = baseQuery.where('audit_logs.created_at', '>=', query.start_date);
    }

    if (query.end_date) {
      baseQuery = baseQuery.where('audit_logs.created_at', '<=', query.end_date);
    }

    if (query.date) {
      baseQuery = baseQuery.whereRaw('date(audit_logs.created_at) = ?', [query.date]);
    }

    // Compter le total des lignes correspondant aux filtres
    const countResult = await baseQuery.clone().clearSelect().count('audit_logs.id as total').first();
    const total = countResult ? parseInt(countResult.total, 10) : 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // Récupérer les enregistrements paginés
    const logs = await baseQuery
      .orderBy('audit_logs.created_at', 'desc')
      .orderBy('audit_logs.id', 'desc')
      .limit(limit)
      .offset(offset);

    // Parser les champs JSON old_values et new_values si nécessaire
    const formattedLogs = logs.map(log => {
      let parsedOld = log.old_values;
      let parsedNew = log.new_values;

      if (typeof parsedOld === 'string') {
        try { parsedOld = JSON.parse(parsedOld); } catch (e) {}
      }
      if (typeof parsedNew === 'string') {
        try { parsedNew = JSON.parse(parsedNew); } catch (e) {}
      }

      return {
        ...log,
        old_values: parsedOld,
        new_values: parsedNew
      };
    });

    return {
      data: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }
}

module.exports = AuditLogService;
