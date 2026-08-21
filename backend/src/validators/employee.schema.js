const { z } = require('zod');

/**
 * Employee validation schemas (Zod).
 *
 * These describe ONLY the wire contract for the employee endpoints. The
 * conditional business logic (Mode A vs Mode B onboarding, role whitelist,
 * duplicate-email detection, user-existence checks) stays entirely in the
 * route handler — unchanged.
 */

/**
 * POST /api/employees
 *
 * Supports two onboarding modes handled by the route:
 *   A) Link to an existing user   -> { user_id, first_name, last_name, ... }
 *   B) Create user + employee      -> { email, password, role, first_name, ... }
 *
 * `first_name` / `last_name` are required at the schema level (the handler
 * already enforces this). `role` is intentionally a plain optional string —
 * NOT an enum — so the handler keeps returning its own "role invalide" message.
 * `email`/`password`/`role` are optional so Mode A (user_id link) passes
 * validation; the handler enforces Mode-B requirements.
 */
const createEmployeeSchema = z.object({
  user_id: z.number().int().positive().optional(),
  first_name: z.string().min(1, 'first_name is required.'),
  last_name: z.string().min(1, 'last_name is required.'),
  email: z.string().email('Invalid email address.').optional(),
  password: z.string().optional(),
  role: z.string().optional(),
  phone: z.string().optional(),
  job_title: z.string().optional(),
  hire_date: z.string().optional(),
  address: z.string().optional()
});

/**
 * PUT /api/employees/:id
 *
 * Patch-style update: every body field is optional (the handler only persists
 * fields that are present). No `.min(1)` constraints — the handler's existing
 * behaviour is preserved exactly (empty strings would be accepted by the
 * handler, so the schema does not reject them either).
 */
const updateEmployeeSchema = z.object({
  user_id: z.number().int().positive().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  job_title: z.string().optional(),
  hire_date: z.string().optional(),
  address: z.string().optional()
});

module.exports = {
  createEmployeeSchema,
  updateEmployeeSchema
};
