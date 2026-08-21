const { ZodError } = require('zod');

/**
 * validate — Zod-backed request validation middleware factory.
 *
 * Accepts either:
 *   1. A single Zod schema   -> validates req.body
 *   2. An object map          -> { body, query, params } validates each source
 *      e.g. validate({ params: idSchema, query: listQuerySchema })
 *
 * On success the parsed (sanitized) value replaces req[source], so downstream
 * handlers receive clean, type-coerced data (unknown keys are stripped).
 *
 * On failure, a 400 response is sent directly — consistent with the existing
 * route-level validation pattern (e.g. auth.js POST /login) and avoids
 * polluting the central "Unhandled Error" handler with expected 400s.
 *
 * The handler body is left completely untouched; validation runs strictly
 * before the route handler reaches any business logic.
 */
function validate(schemas) {
  // A single Zod schema validates the request body by default.
  const sources =
    schemas && typeof schemas === 'object' && 'safeParse' in schemas
      ? { body: schemas }
      : schemas || {};

  return (req, res, next) => {
    try {
      for (const source of Object.keys(sources)) {
        const schema = sources[source];
        const result = schema.safeParse(req[source]);

        if (!result.success) {
          // Zod v4 exposes `.issues` (v3 alias `.errors` is undefined).
          const details = result.error.issues.map((e) => ({
            path: e.path && e.path.length ? e.path.join('.') : source,
            message: e.message,
            code: e.code
          }));

          return res.status(400).json({
            error: `Validation failed for ${source}: ${details
              .map((d) => `${d.path}: ${d.message}`)
              .join('; ')}`,
            details
          });
        }

        // Replace with the sanitized, parsed payload.
        req[source] = result.data;
      }

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues || err.errors || [];
        return res.status(400).json({
          error: `Validation failed: ${details
            .map((e) => e.message)
            .join(', ')}`,
          details
        });
      }
      next(err);
    }
  };
}

module.exports = { validate };
