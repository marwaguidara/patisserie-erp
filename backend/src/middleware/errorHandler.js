const { AppError } = require('../utils/AppError');

/**
 * Mappe un statusCode HTTP vers un code d'erreur lisible par défaut.
 */
function getDefaultCodeForStatus(statusCode) {
  switch (statusCode) {
    case 400: return 'VALIDATION_ERROR';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    default: return 'INTERNAL_ERROR';
  }
}

/**
 * errorHandler — Middleware global de gestion des erreurs pour Express.
 * Formate une réponse JSON standardisée et logue les erreurs serveur.
 */
function errorHandler(err, req, res, next) {
  // Ignorer si les en-têtes ont déjà été envoyés au client
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || getDefaultCodeForStatus(statusCode);

  // Logging de toutes les erreurs serveur (>= 500) avec stack trace
  if (statusCode >= 500) {
    console.error(`[SERVER ERROR 500] ${req.method} ${req.originalUrl} - ${message}`, err.stack || err);
  } else {
    console.warn(`[CLIENT ERROR ${statusCode}] ${req.method} ${req.originalUrl} - [${code}]: ${message}`);
  }

  // Réponse JSON standardisée avec rétrocompatibilité "error" pour les tests existants
  return res.status(statusCode).json({
    success: false,
    message: message,
    code: code,
    timestamp: new Date().toISOString(),
    error: message // Préserve la clé 'error' pour compatibilité avec les tests unitaires Jest
  });
}

module.exports = errorHandler;
