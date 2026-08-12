const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

async function hasEmployeeColumn(column) {
  return db.schema.hasColumn('employees', column);
}

// GET /api/employees
router.get('/', requireAuth, requireRole(['ADMIN', 'EMPLOYEE', 'STOCK', 'PRODUCTION', 'CASHIER']), async (req, res, next) => {
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

    if (req.user.role === 'EMPLOYEE') {
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
router.get('/schedules', requireAuth, requireRole(['ADMIN', 'EMPLOYEE']), async (req, res, next) => {
  try {
    let query = db('schedules')
      .join('employees', 'schedules.employee_id', 'employees.id')
      .select(
        'schedules.*',
        'employees.first_name as employee_first_name',
        'employees.last_name as employee_last_name'
      )
      .orderBy('schedules.shift_start', 'asc');

    if (req.user.role === 'EMPLOYEE') {
      const employee = await db('employees').where({ user_id: req.user.id }).first();
      if (!employee) {
        return res.status(403).json({ error: 'No employee profile linked to this user.' });
      }
      query = query.where('schedules.employee_id', employee.id);
    }

    const schedules = await query;
    res.json(schedules);
  } catch (err) {
    next(err);
  }
});

// POST /api/schedules
router.post('/schedules', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
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
router.get('/leaves', requireAuth, requireRole(['ADMIN', 'EMPLOYEE']), async (req, res, next) => {
  try {
    let query = db('leaves')
      .join('employees', 'leaves.employee_id', 'employees.id')
      .select(
        'leaves.*',
        'employees.first_name as employee_first_name',
        'employees.last_name as employee_last_name'
      )
      .orderBy('leaves.start_date', 'desc');

    if (req.user.role === 'EMPLOYEE') {
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

// POST /api/leaves
router.post('/leaves', requireAuth, requireRole(['ADMIN', 'EMPLOYEE']), async (req, res, next) => {
  try {
    const { employee_id, start_date, end_date, reason, status } = req.body;
    if (!employee_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'employee_id, start_date et end_date sont requis.' });
    }

    const employee = await db('employees').where({ id: employee_id }).first();
    if (!employee) {
      return res.status(400).json({ error: 'Employee introuvable.' });
    }

    if (req.user.role === 'EMPLOYEE') {
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
      // Employees cannot self-approve: only ADMIN-set status is respected,
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

// PUT /api/employees/leaves/:id/status
// ADMIN-only: approve, reject or reset a leave request.
router.put('/leaves/:id/status', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
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
router.get('/:id', requireAuth, requireRole(['ADMIN', 'EMPLOYEE', 'STOCK', 'PRODUCTION', 'CASHIER']), async (req, res, next) => {
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

    if (req.user.role === 'EMPLOYEE') {
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
router.post('/', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
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

// PUT /api/employees/:id
router.put('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
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
router.delete('/:id', requireAuth, requireRole(['ADMIN']), async (req, res, next) => {
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