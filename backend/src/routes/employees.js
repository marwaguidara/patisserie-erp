const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { requireAuth, requireRole, requirePermission } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createEmployeeSchema, updateEmployeeSchema } = require('../validators/employee.schema');

const router = express.Router();

/**
 * Helper: resolve the employee.id that belongs to the authenticated user.
 * Returns null when no employee profile is linked (caller decides what to do).
 */
async function getSelfEmployeeId(userId) {
  const employee = await db('employees').where({ user_id: userId }).first();
  return employee ? employee.id : null;
}

async function hasEmployeeColumn(column) {
  return db.schema.hasColumn('employees', column);
}

// ─────────────────────────────────────────────────────────────────────
//  RH Self-Service endpoints (available to ALL authenticated roles)
// ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/employees/profile
 * Self-scoped profile for all authenticated roles.
 */
router.get('/profile', requireAuth, requirePermission('view_profile'), async (req, res, next) => {
  try {
    const employeeId = await getSelfEmployeeId(req.user.id);
    if (!employeeId) {
      return res.status(404).json({ error: 'No employee profile linked to this user.' });
    }
    const employee = await db('employees')
      .where('employees.id', employeeId)
      .join('users', 'employees.user_id', 'users.id')
      .select(
        'employees.id',
        'employees.user_id',
        'employees.first_name',
        'employees.last_name',
        'employees.phone',
        'employees.job_title',
        'employees.hire_date',
        'employees.address',
        'employees.created_at',
        'employees.updated_at',
        'users.name as user_name',
        'users.email as user_email',
        'users.role as user_role'
      )
      .first();
    res.json(employee);
  } catch (err) { next(err); }
});

/**
 * GET /api/employees/hours
 * Self-scoped work-hours summary for all authenticated roles.
 */
router.get('/hours', requireAuth, requirePermission('view_hours'), async (req, res, next) => {
  try {
    const employeeId = await getSelfEmployeeId(req.user.id);
    if (!employeeId) {
      return res.status(404).json({ error: 'No employee profile linked to this user.' });
    }
    const { start_date, end_date } = req.query;
    let query = db('schedules').where('schedules.employee_id', employeeId);
    if (start_date) query = query.where('schedules.shift_start', '>=', start_date);
    if (end_date) query = query.where('schedules.shift_start', '<=', end_date);
    const schedules = await query.select('shift_start', 'shift_end', 'notes');

    let totalHours = 0;
    const scheduleList = schedules.map((s) => {
      const hours = (new Date(s.shift_end) - new Date(s.shift_start)) / 36e5;
      totalHours += hours;
      return { shift_start: s.shift_start, shift_end: s.shift_end, hours, notes: s.notes };
    });

    let leaveQuery = db('leaves').where('leaves.employee_id', employeeId);
    if (start_date) leaveQuery = leaveQuery.where('leaves.start_date', '>=', start_date);
    if (end_date) leaveQuery = leaveQuery.where('leaves.end_date', '<=', end_date);
    const leaves = await leaveQuery.select('start_date', 'end_date', 'status', 'reason');

    res.json({ employee_id: employeeId, total_hours: totalHours, schedules: scheduleList, leaves });
  } catch (err) { next(err); }
});

// GET /api/employees
// ADMIN: full directory (all employees). Non-ADMIN: self only.
// Gate permission: view_profile (available to every authenticated role) because
// the endpoint self-filters non-ADMIN results. 'view_employee_directory'
// (ADMIN-only) is kept in DEFAULT_ROLE_PERMISSIONS as the fine-grained gate for
// a future raw full-directory endpoint; it must not reject the self-scoped case.
router.get('/', requireAuth, requirePermission('view_profile'), async (req, res, next) => {
  try {
    // Explicit column whitelist — never expose HR-private columns (e.g. salary)
    // via this endpoint. Kept consistent with the GET /api/employees/:id payload.
    let query = db('employees')
      .join('users', 'employees.user_id', 'users.id')
      .select(
        'employees.id',
        'employees.user_id',
        'employees.first_name',
        'employees.last_name',
        'employees.phone',
        'employees.job_title',
        'employees.hire_date',
        'employees.address',
        'employees.created_at',
        'employees.updated_at',
        'users.name as user_name',
        'users.email as user_email',
        'users.role as user_role'
      );

        // Non-ADMIN users see ONLY their own employee record
    if (req.user.role !== 'ADMIN') {
      const employee = await db('employees').where({ user_id: req.user.id }).first();
      if (!employee) {
        return res.status(403).json({ error: 'No employee profile linked to this user.' });
      }
      query = query.where('employees.id', employee.id);
    }

    const employees = await query;
    res.json(employees);
  } catch (err) {
    next(err);
  }
});

// GET /api/schedules
// Returns schedules joined with employee names so the frontend can render
// "who works when" without a second round-trip.
router.get('/schedules', requireAuth, requirePermission('view_schedule'), async (req, res, next) => {
  try {
    let query = db('schedules')
      .join('employees', 'schedules.employee_id', 'employees.id')
      .select(
        'schedules.*',
        'employees.first_name as employee_first_name',
        'employees.last_name as employee_last_name'
      )
      .orderBy('schedules.shift_start', 'asc');

                // Non-ADMIN users see ONLY their own schedules
    if (req.user.role !== 'ADMIN') {
      const employeeId = await getSelfEmployeeId(req.user.id);
      if (!employeeId) {
        return res.status(403).json({ error: 'No employee profile linked to this user.' });
      }
      query = query.where('schedules.employee_id', employeeId);
    }

    const schedules = await query;
    res.json(schedules);
  } catch (err) {
    next(err);
  }
});

// POST /api/schedules
router.post('/schedules', requireAuth, requirePermission('create_schedule'), async (req, res, next) => {
  try {
    const { employee_id, shift_start, shift_end, notes } = req.body;
    if (!employee_id || !shift_start || !shift_end) {
      return res.status(400).json({ error: 'employee_id, shift_start et shift_end sont requis.' });
    }

    const employee = await db('employees').where({ id: employee_id }).first();
    if (!employee) {
      return res.status(400).json({ error: 'Employee introuvable.' });
    }

    const [id] = await db('schedules').insert({
      employee_id,
      shift_start,
      shift_end,
      notes: notes || null
    }).returning('id');

    const scheduleId = typeof id === 'object' ? id.id : id;
    const created = await db('schedules').where({ id: scheduleId }).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// GET /api/leaves
// Returns leaves joined with employee names + leave status so the frontend
// can render the full leave board for ADMIN and self-filtered for EMPLOYEE.
router.get('/leaves', requireAuth, requirePermission('view_leave'), async (req, res, next) => {
  try {
    let query = db('leaves')
      .join('employees', 'leaves.employee_id', 'employees.id')
      .select(
        'leaves.*',
        'employees.first_name as employee_first_name',
        'employees.last_name as employee_last_name'
      )
      .orderBy('leaves.start_date', 'desc');

                // Non-ADMIN users see ONLY their own leaves
    if (req.user.role !== 'ADMIN') {
      const employee = await db('employees').where({ user_id: req.user.id }).first();
      if (!employee) {
        return res.status(403).json({ error: 'No employee profile linked to this user.' });
      }
      query = query.where('leaves.employee_id', employee.id);
    }

    const leaves = await query;
    res.json(leaves);
  } catch (err) {
    next(err);
  }
});
router.post('/leaves', requireAuth, requirePermission('create_leave'), async (req, res, next) => {
  try {
    const { employee_id, start_date, end_date, reason, status } = req.body;
    if (!employee_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'employee_id, start_date et end_date sont requis.' });
    }

    const employee = await db('employees').where({ id: employee_id }).first();
    if (!employee) {
      return res.status(400).json({ error: 'Employee introuvable.' });
    }

    // Non-ADMIN users can only create leaves for their OWN profile
    if (req.user.role !== 'ADMIN') {
      const linkedEmployee = await db('employees').where({ user_id: req.user.id }).first();
      if (!linkedEmployee || linkedEmployee.id !== employee_id) {
        return res.status(403).json({ error: 'Vous pouvez seulement créer des congés pour votre propre profil.' });
      }
    }

    const [id] = await db('leaves').insert({
      employee_id,
      start_date,
      end_date,
      reason: reason || null,
      // Non-ADMIN users cannot self-approve: only ADMIN-set status is respected,
      // everyone else is forced to PENDING (H-1 security fix).
      status: req.user.role === 'ADMIN' ? (status || 'PENDING') : 'PENDING'
    }).returning('id');

    const leaveId = typeof id === 'object' ? id.id : id;
    const created = await db('leaves').where({ id: leaveId }).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/leaves/me
// Self-service leave request : the employee is ALWAYS resolved from req.user.id
// (never from the body) and the status is ALWAYS forced to 'PENDING', so an
// employee can never self-approve (a submitted status is silently ignored).
// This is a self-service variant of POST /api/employees/leaves (admin route),
// which is left untouched.
router.post('/leaves/me', requireAuth, async (req, res, next) => {
  try {
    const { start_date, end_date, reason } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date et end_date sont requis.' });
    }

    const start = new Date(`${start_date}T00:00:00`);
    const end = new Date(`${end_date}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Dates invalides.' });
    }

    // start_date <= end_date
    if (start > end) {
      return res.status(400).json({ error: 'La date de début doit être antérieure ou égale à la date de fin.' });
    }

    // Neither date may be in the past (today is allowed).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start < today || end < today) {
      return res.status(400).json({ error: 'Les dates de congé ne peuvent pas être dans le passé.' });
    }

    // Single source of truth: the authenticated user (from the token).
    const employeeId = await getSelfEmployeeId(req.user.id);
    if (!employeeId) {
      return res.status(403).json({ error: 'Aucun profil employé lié à ce compte.' });
    }

    const [id] = await db('leaves').insert({
      employee_id: employeeId,
      start_date,
      end_date,
      reason: reason || null,
      // Always PENDING — the employee can never self-approve.
      status: 'PENDING'
    }).returning('id');

    const leaveId = typeof id === 'object' ? id.id : id;
    const created = await db('leaves').where({ id: leaveId }).first();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/leaves/:id/status
// ADMIN-only: approve, reject or reset a leave request.
router.put('/leaves/:id/status', requireAuth, requirePermission('approve_leave'), async (req, res, next) => {
  try {
    const leaveId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'status invalide. Utilisez PENDING, APPROVED ou REJECTED.' });
    }

    const existing = await db('leaves').where({ id: leaveId }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Leave not found.' });
    }

    await db('leaves').where({ id: leaveId }).update({ status });
    const updated = await db('leaves').where({ id: leaveId }).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id
// ADMIN: any employee. Non-ADMIN: self only.
router.get('/:id', requireAuth, requirePermission('view_profile'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const employee = await db('employees')
      .where('employees.id', id)
      .join('users', 'employees.user_id', 'users.id')
      .select(
        'employees.id',
        'employees.user_id',
        'users.name as user_name',
        'users.email as user_email',
        'users.role as user_role',
        'employees.first_name',
        'employees.last_name',
        'employees.phone',
        'employees.job_title',
        'employees.hire_date',
        'employees.address',
        'employees.created_at',
        'employees.updated_at'
      )
      .first();

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Non-ADMIN users can only view their OWN profile
    if (req.user.role !== 'ADMIN') {
      const linkedEmployee = await db('employees').where({ user_id: req.user.id }).first();
      if (!linkedEmployee || linkedEmployee.id !== id) {
        return res.status(403).json({ error: 'Accès refusé à ce profil.' });
      }
    }

    res.json(employee);
  } catch (err) {
    next(err);
  }
});

// POST /api/employees
// Two modes:
//  A) Backward-compatible: provide an existing `user_id` to link a profile.
//  B) Onboarding: provide `email`, `password`, `role` to atomically create
//     the user account + employee profile in a single transaction.
router.post('/', requireAuth, requirePermission('crud_employee'), validate(createEmployeeSchema), async (req, res, next) => {
  try {
    const { user_id, first_name, last_name, email, password, role, phone, job_title, hire_date, address } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'first_name et last_name sont requis.' });
    }

    // Mode A: link to an existing user (backward compatible)
    if (user_id) {
      const userExists = await db('users').where({ id: user_id }).first();
      if (!userExists) {
        return res.status(400).json({ error: 'Utilisateur lié introuvable.' });
      }

      const existingEmployee = await db('employees').where({ user_id }).first();
      if (existingEmployee) {
        return res.status(400).json({ error: 'Cet utilisateur est déjà lié à un employé.' });
      }

      const insertData = {
        user_id,
        first_name,
        last_name,
        phone: phone || null,
        job_title: job_title || null
      };

      if (await hasEmployeeColumn('hire_date')) {
        insertData.hire_date = hire_date || null;
      }
      if (await hasEmployeeColumn('address')) {
        insertData.address = address || null;
      }

      const [id] = await db('employees').insert(insertData).returning('id');
      const employeeId = typeof id === 'object' ? id.id : id;
      const created = await db('employees').where({ id: employeeId }).first();
      return res.status(201).json(created);
    }

    // Mode B: onboarding — create user + employee atomically
    if (!email || !password) {
      return res.status(400).json({ error: 'email et password sont requis pour créer un compte.' });
    }
    const VALID_ROLES = ['ADMIN', 'PRODUCTION', 'CASHIER', 'STOCK', 'EMPLOYEE'];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role invalide. Utilisez l'un de: ${VALID_ROLES.join(', ')}` });
    }

    // Resolve the HR columns BEFORE opening the transaction. Calling
    // db.schema.hasColumn() inside a transaction would try to acquire a
    // second connection from the pool — a deadlock on SQLite (single
    // connection), causing "Knex: Timeout acquiring a connection".
    const insertData = {
      first_name,
      last_name,
      phone: phone || null,
      job_title: job_title || null
    };
    if (await hasEmployeeColumn('hire_date')) {
      insertData.hire_date = hire_date || null;
    }
    if (await hasEmployeeColumn('address')) {
      insertData.address = address || null;
    }

    const created = await db.transaction(async (trx) => {
      const existingUser = await trx('users').where({ email }).first();
      if (existingUser) {
        throw new Error('Cet email est déjà utilisé.');
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const [newUserId] = await trx('users').insert({
        name: `${first_name} ${last_name}`,
        email,
        password_hash: passwordHash,
        role: role || 'EMPLOYEE'
      }).returning('id');
      const uid = typeof newUserId === 'object' ? newUserId.id : newUserId;

      const [empId] = await trx('employees').insert({ ...insertData, user_id: uid }).returning('id');
      const eid = typeof empId === 'object' ? empId.id : empId;
      return await trx('employees').where({ id: eid }).first();
    });

    res.status(201).json(created);
  } catch (err) {
    if (err.message.includes('déjà utilisé')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// PUT /api/employees/me/password
// Self-service password change — available to every authenticated role.
// The employee is ALWAYS resolved from req.user.id (the JWT subject), and any
// user/employee id in the body or params is deliberately ignored, so no user
// can change someone else's password. Reuses the same bcrypt mechanism used
// at employee creation (auth.js / POST /api/employees) — nothing is duplicated.
router.put('/me/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'Le mot de passe actuel est requis.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
    }

    // Single source of truth: the authenticated user (from the token), never body/params.
    const user = await db('users').where({ id: req.user.id }).first();
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db('users').where({ id: user.id }).update({ password_hash: passwordHash });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/me/profile
// Self-service update of the employee's OWN contact info (phone / address only).
// This is a self-service variant of PUT /api/employees/:id (admin route).
// Whitelist constraint: ONLY `phone` and `address` are ever written. Any
// protected field (email, role, job_title, hire_date, name, user_id) that a
// caller might smuggle into the body is deliberately IGNORED.
// The target employee is ALWAYS resolved from req.user.id — never from an id
// in the body or params.
router.put('/me/profile', requireAuth, async (req, res, next) => {
  try {
    const { phone, address } = req.body;

    // Basic validation: if provided, values must be non-empty strings.
    if (phone !== undefined && (typeof phone !== 'string' || phone.trim() === '')) {
      return res.status(400).json({ error: 'Le téléphone doit être une chaîne non vide.' });
    }
    if (address !== undefined && (typeof address !== 'string' || address.trim() === '')) {
      return res.status(400).json({ error: 'L\'adresse doit être une chaîne non vide.' });
    }

    // Single source of truth: the authenticated user (from the token), never body/params.
    const employeeId = await getSelfEmployeeId(req.user.id);
    if (!employeeId) {
      return res.status(403).json({ error: 'Aucun profil employé lié à ce compte.' });
    }

    // Build a strictly whitelisted update — no email / role / job_title /
    // hire_date / name can be written here, regardless of what the body contains.
    const updateData = {};
    if (phone !== undefined) updateData.phone = phone.trim();
    if (address !== undefined && (await hasEmployeeColumn('address'))) {
      updateData.address = address.trim();
    }

    if (Object.keys(updateData).length === 0) {
      // Nothing whitelisted was provided (e.g. only email/role in the body).
      const current = await db('employees').where({ id: employeeId }).first();
      return res.json(current);
    }

    await db('employees').where({ id: employeeId }).update(updateData);
    const updated = await db('employees').where({ id: employeeId }).first();

    // Return the same public shape as GET /profile (phone + address are the only
    // writable fields the frontend consumes here).
    res.json({
      id: updated.id,
      first_name: updated.first_name,
      last_name: updated.last_name,
      phone: updated.phone,
      job_title: updated.job_title,
      hire_date: updated.hire_date,
      address: updated.address
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id
router.put('/:id', requireAuth, requirePermission('crud_employee'), validate(updateEmployeeSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('employees').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const { user_id, first_name, last_name, phone, job_title, hire_date, address } = req.body;

    if (user_id && user_id !== existing.user_id) {
      const userExists = await db('users').where({ id: user_id }).first();
      if (!userExists) {
        return res.status(400).json({ error: 'Utilisateur lié introuvable.' });
      }
      const duplicate = await db('employees').where({ user_id }).andWhereNot({ id }).first();
      if (duplicate) {
        return res.status(400).json({ error: 'Cet utilisateur est déjà lié à un autre employé.' });
      }
    }

    const updateData = {
      user_id: user_id !== undefined ? user_id : existing.user_id,
      first_name: first_name !== undefined ? first_name : existing.first_name,
      last_name: last_name !== undefined ? last_name : existing.last_name,
      phone: phone !== undefined ? phone : existing.phone,
      job_title: job_title !== undefined ? job_title : existing.job_title
    };

    if (await hasEmployeeColumn('hire_date')) {
      updateData.hire_date = hire_date !== undefined ? hire_date : existing.hire_date;
    }
    if (await hasEmployeeColumn('address')) {
      updateData.address = address !== undefined ? address : existing.address;
    }

    await db('employees').where({ id }).update(updateData);

    const updated = await db('employees').where({ id }).first();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id
router.delete('/:id', requireAuth, requirePermission('crud_employee'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db('employees').where({ id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    await db('employees').where({ id }).del();
    res.json({ message: `Employee ${id} deleted successfully.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;