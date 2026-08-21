const { z } = require('zod');

/**
 * Auth validation schemas (Zod).
 *
 * These describe ONLY the wire contract for the auth endpoints — they are
 * intentionally decoupled from any database or business rule so the same
 * schema can be unit-tested in isolation.
 */

/**
 * POST /api/auth/login
 *
 *   { email: string (RFC-5322-ish), password: string (min 1 char) }
 *
 * Mirrors the seed fixture convention (password123 / admin@bakery.com) and
 * the existing free-typed email field the frontend now submits.
 */
const loginSchema = z.object({
  email: z
    .string({
      required_error: 'Email is required.',
      invalid_type_error: 'Email must be a string.'
    })
    .min(1, 'Email is required.')
    .email('Invalid email address.'),

  password: z
    .string({
      required_error: 'Password is required.',
      invalid_type_error: 'Password must be a string.'
    })
    .min(1, 'Password is required.')
});

module.exports = { loginSchema };
