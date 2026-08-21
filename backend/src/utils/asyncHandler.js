/**
 * asyncHandler — Wrapper utilitaire pour encapsuler les routes asynchrones Express.
 * Capture automatiquement les promesses rejetées et les transmet au middleware d'erreur via next().
 *
 * @param {Function} fn - Handler de route asynchrone (req, res, next)
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
