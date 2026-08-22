const bcrypt = require('bcryptjs');
const { toMySQLDate } = require('../src/utils/datetimeUtils');

exports.seed = async function(knex) {
  // Clear existing data in reverse order of foreign keys.
  // NOTE: payments / customer_orders / purchase_orders tables must be cleared
  // BEFORE their parents (sales, purchase_orders) — otherwise re-seeding a DB
  // that already has sales fails on FK constraints.
  await knex('stock_movements').del();
  await knex('payments').del();
  await knex('recipe_items').del();
  await knex('sale_items').del();
  await knex('sales').del();
  if (await knex.schema.hasTable('customer_order_items')) {
    await knex('customer_order_items').del();
  }
  await knex('customer_orders').del();
  await knex('purchase_order_items').del();
  await knex('purchase_orders').del();
  await knex('products').del();
  await knex('ingredients').del();
  await knex('suppliers').del();
  await knex('categories').del();
  await knex('leaves').del();
  await knex('schedules').del();
  await knex('employees').del();
  await knex('users').del();

  const passwordHash = await bcrypt.hash('password123', 10);

  // 1. Seed Users
  const [adminUser] = await knex('users').insert({
    name: 'Admin Bakery',
    email: 'admin@bakery.com',
    password_hash: passwordHash,
    role: 'ADMIN'
  });

  const [prodUser] = await knex('users').insert({
    name: 'Chef Pâtissier',
    email: 'production@bakery.com',
    password_hash: passwordHash,
    role: 'PRODUCTION'
  });

  const [cashierUser] = await knex('users').insert({
    name: 'Vendeuse Caissière',
    email: 'cashier@bakery.com',
    password_hash: passwordHash,
    role: 'CASHIER'
  });

  const [stockUser] = await knex('users').insert({
    name: 'Gestionnaire Stock',
    email: 'stock@bakery.com',
    password_hash: passwordHash,
    role: 'STOCK'
  });

  const [employeeUser] = await knex('users').insert({
    name: 'Employé Test',
    email: 'employe@bakery.com',
    password_hash: passwordHash,
    role: 'EMPLOYEE'
  });

  const adminId = typeof adminUser === 'object' ? adminUser.id : adminUser;
  const prodId = typeof prodUser === 'object' ? prodUser.id : prodUser;
  const cashierId = typeof cashierUser === 'object' ? cashierUser.id : cashierUser;
  const employeeUserId = typeof employeeUser === 'object' ? employeeUser.id : employeeUser;

  // 1b. Seed Employee Profiles (Sprint 3)
  const [empAdmin] = await knex('employees').insert({
    user_id: adminId,
    first_name: 'Admin',
    last_name: 'Bakery',
    phone: '+33 1 00 00 00 01',
    job_title: 'Directeur',
    hire_date: '2025-01-10',
    address: '12 rue de la Pâtisserie, Paris'
  });

  const [empProd] = await knex('employees').insert({
    user_id: prodId,
    first_name: 'Chef',
    last_name: 'Pâtissier',
    phone: '+33 1 00 00 00 02',
    job_title: 'Chef Pâtissier',
    hire_date: '2025-02-01',
    address: '12 rue de la Pâtisserie, Paris'
  });

  const [empCashier] = await knex('employees').insert({
    user_id: cashierId,
    first_name: 'Vendeuse',
    last_name: 'Caissière',
    phone: '+33 1 00 00 00 03',
    job_title: 'Vendeuse / Caissière',
    hire_date: '2025-03-15',
    address: '12 rue de la Pâtisserie, Paris'
  });

  const [empEmployee] = await knex('employees').insert({
    user_id: employeeUserId,
    first_name: 'Employé',
    last_name: 'Test',
    phone: '+33 1 00 00 00 04',
    job_title: 'Employé polyvalent',
    hire_date: '2025-05-01',
    address: '12 rue de la Pâtisserie, Paris'
  });

  const empAdminId = typeof empAdmin === 'object' ? empAdmin.id : empAdmin;
  const empProdId = typeof empProd === 'object' ? empProd.id : empProd;
  const empCashierId = typeof empCashier === 'object' ? empCashier.id : empCashier;
  const empEmployeeId = typeof empEmployee === 'object' ? empEmployee.id : empEmployee;

  // 2. Seed Categories
  const [catViennoiserie] = await knex('categories').insert({
    name: 'Viennoiserie',
    description: 'Croissants, pains au chocolat, brioches'
  });

  const [catPatisserie] = await knex('categories').insert({
    name: 'Pâtisserie',
    description: 'Gâteaux, tartes, éclairs'
  });

  const catVienId = typeof catViennoiserie === 'object' ? catViennoiserie.id : catViennoiserie;
  const catPatId = typeof catPatisserie === 'object' ? catPatisserie.id : catPatisserie;

  // 3. Seed Suppliers
  const [supplier] = await knex('suppliers').insert({
    name: 'Moulins & Crémerie de France',
    contact_person: 'Jean Dupont',
    email: 'contact@moulinsfrance.fr',
    phone: '+33 1 23 45 67 89'
  });

  const supplierId = typeof supplier === 'object' ? supplier.id : supplier;

  // Dates for expiration testing
  const today = new Date();
  const dateIn5Days = new Date(today);
  dateIn5Days.setDate(today.getDate() + 5);
  const dateIn60Days = new Date(today);
  dateIn60Days.setDate(today.getDate() + 60);

  // 4. Seed Ingredients
  const [ingFlour] = await knex('ingredients').insert({
    name: 'Farine T45',
    unit: 'kg',
    current_stock: 100.0,
    minimum_stock: 20.0,
    cost_per_unit: 1.20,
    expiration_date: toMySQLDate(dateIn60Days),
    supplier_id: supplierId
  });

  const [ingButter] = await knex('ingredients').insert({
    name: 'Beurre Doux 82%',
    unit: 'kg',
    current_stock: 50.0,
    minimum_stock: 10.0,
    cost_per_unit: 8.50,
    expiration_date: toMySQLDate(dateIn5Days), // Near expiration!
    supplier_id: supplierId
  });

  const [ingSugar] = await knex('ingredients').insert({
    name: 'Sucre Cristal',
    unit: 'kg',
    current_stock: 40.0,
    minimum_stock: 5.0,
    cost_per_unit: 1.50,
    expiration_date: toMySQLDate(dateIn60Days),
    supplier_id: supplierId
  });

  const [ingChocolate] = await knex('ingredients').insert({
    name: 'Bâtons de Chocolat',
    unit: 'kg',
    current_stock: 25.0,
    minimum_stock: 5.0,
    cost_per_unit: 12.00,
    expiration_date: toMySQLDate(dateIn60Days),
    supplier_id: supplierId
  });

  const flourId = typeof ingFlour === 'object' ? ingFlour.id : ingFlour;
  const butterId = typeof ingButter === 'object' ? ingButter.id : ingButter;
  const sugarId = typeof ingSugar === 'object' ? ingSugar.id : ingSugar;
  const chocId = typeof ingChocolate === 'object' ? ingChocolate.id : ingChocolate;

  // 5. Seed Products
  const [prodCroissant] = await knex('products').insert({
    name: 'Croissant Pur Beurre',
    description: 'Croissant feuilleté pur beurre',
    price: 1.30,
    category_id: catVienId,
    stock_quantity: 30
  });

  const [prodPainChoc] = await knex('products').insert({
    name: 'Pain au Chocolat',
    description: 'Feuilleté garni de 2 bâtons de chocolat',
    price: 1.40,
    category_id: catVienId,
    stock_quantity: 25
  });

  const croissantId = typeof prodCroissant === 'object' ? prodCroissant.id : prodCroissant;
  const painChocId = typeof prodPainChoc === 'object' ? prodPainChoc.id : prodPainChoc;

  // 6. Seed Recipe Items
  await knex('recipe_items').insert([
    { product_id: croissantId, ingredient_id: flourId, quantity_required: 0.08 },
    { product_id: croissantId, ingredient_id: butterId, quantity_required: 0.04 },
    { product_id: croissantId, ingredient_id: sugarId, quantity_required: 0.01 },

    { product_id: painChocId, ingredient_id: flourId, quantity_required: 0.08 },
    { product_id: painChocId, ingredient_id: butterId, quantity_required: 0.04 },
    { product_id: painChocId, ingredient_id: sugarId, quantity_required: 0.01 },
    { product_id: painChocId, ingredient_id: chocId, quantity_required: 0.02 }
  ]);

  // 7. Seed Initial Stock Movements
  await knex('stock_movements').insert([
    { ingredient_id: flourId, movement_type: 'IN', quantity: 100.0, reason: 'Stock Initial', created_by: adminId },
    { ingredient_id: butterId, movement_type: 'IN', quantity: 50.0, reason: 'Stock Initial', expiration_date: toMySQLDate(dateIn5Days), created_by: adminId },
    { ingredient_id: sugarId, movement_type: 'IN', quantity: 40.0, reason: 'Stock Initial', created_by: adminId },
    { ingredient_id: chocId, movement_type: 'IN', quantity: 25.0, reason: 'Stock Initial', created_by: adminId }
  ]);

  // 8. Seed Schedules (Sprint 3)
  await knex('schedules').insert([
    {
      employee_id: empCashierId,
      shift_start: '2026-08-03 08:00:00',
      shift_end: '2026-08-03 16:00:00',
      notes: 'Service du matin'
    },
    {
      employee_id: empProdId,
      shift_start: '2026-08-03 06:00:00',
      shift_end: '2026-08-03 14:00:00',
      notes: 'Préparation du jour'
    },
    {
      employee_id: empEmployeeId,
      shift_start: '2026-08-04 09:00:00',
      shift_end: '2026-08-04 17:00:00',
      notes: null
    }
  ]);

  // 9. Seed Leave Requests (Sprint 3)
  await knex('leaves').insert([
    {
      employee_id: empEmployeeId,
      start_date: '2026-09-01',
      end_date: '2026-09-05',
      reason: 'Vacances d\'été',
      status: 'PENDING'
    },
    {
      employee_id: empCashierId,
      start_date: '2026-08-20',
      end_date: '2026-08-22',
      reason: 'Rendez-vous personnel',
      status: 'APPROVED'
    },
    {
      employee_id: empProdId,
      start_date: '2026-10-10',
      end_date: '2026-10-12',
      reason: 'Congé demandé',
      status: 'PENDING'
    }
  ]);

  // 10. Seed Purchase Orders (Sprint 4)
  const [poSeed] = await knex('purchase_orders').insert({
    supplier_id: supplierId,
    status: 'ORDERED',
    total_cost: 120.00,
    created_by: adminId
  });
  const poSeedId = typeof poSeed === 'object' ? poSeed.id : poSeed;

  await knex('purchase_order_items').insert({
    purchase_order_id: poSeedId,
    ingredient_id: flourId,
    quantity_ordered: 100.0,
    unit_cost: 1.20
  });

  // 11. Seed Customer Orders (Sprint 4)
  const [coSeed] = await knex('customer_orders').insert({
    customer_name: 'Jean Dupont',
    customer_phone: '+33 6 12 34 56 78',
    delivery_date: toMySQLDate(dateIn5Days),
    status: 'PENDING',
    total_price: 27.00,
    special_instructions: 'Gâteau d\'anniversaire personnalisé',
    user_id: cashierId
  });
  const coSeedId = typeof coSeed === 'object' ? coSeed.id : coSeed;

  if (await knex.schema.hasTable('customer_order_items')) {
    await knex('customer_order_items').insert([
      {
        customer_order_id: coSeedId,
        product_id: croissantId,
        quantity: 10,
        unit_price: 1.30,
        subtotal: 13.00
      },
      {
        customer_order_id: coSeedId,
        product_id: painChocId,
        quantity: 10,
        unit_price: 1.40,
        subtotal: 14.00
      }
    ]);
  }
};