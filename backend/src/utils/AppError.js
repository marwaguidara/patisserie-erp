/**
 * AppError — Classe de base pour les erreurs opérationnelles de l'application.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Erreur 400 — Validation échouée ou requête invalide
 */
class ValidationError extends AppError {
  constructor(message = 'Données de requête invalides', code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

/**
 * Erreur 401 — Authentification requise ou jeton invalide
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentification requise', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

/**
 * Erreur 403 — Accès interdit / Droits insuffisants
 */
class ForbiddenError extends AppError {
  constructor(message = 'Accès refusé', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

/**
 * Erreur 404 — Ressource non trouvée
 */
class NotFoundError extends AppError {
  constructor(message = 'Ressource non trouvée', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

/**
 * Erreur 409 — Conflit d'état (ex: ressource déjà existante)
 */
class ConflictError extends AppError {
  constructor(message = 'Conflit avec l\'état actuel de la ressource', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

/**
 * Erreur 500 — Erreur interne du serveur
 */
class InternalError extends AppError {
  constructor(message = 'Erreur interne du serveur', code = 'INTERNAL_ERROR') {
    super(message, 500, code);
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalError
};
