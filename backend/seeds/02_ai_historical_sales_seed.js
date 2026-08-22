/**
 * Seed 02 — Génération d'un Dataset Historique Complet sur 180 Jours (Pâtisserie ERP)
 *
 * Objectif :
 *  Alimenter les modules IA & Analytics (forecast, recommandations production,
 *  anomalies, segmentation, dashboard) avec un jeu de données réaliste.
 *
 * Contraintes respectées :
 *  - Ne supprime AUCUNE donnée existante (pas de del/truncate).
 *  - Ajoute uniquement de nouvelles données.
 *  - Respecte toutes les clés étrangères (users, categories, products, sales, sale_items).
 *  - Réutilise les produits et catégories déjà existants.
 *  - 180 jours d'historique quotidien.
 *  - Minimum 5,000 ventes dans `sales` et 10,000 articles dans `sale_items`.
 */

const { toMySQLDate, toMySQLDatetime } = require('../src/utils/datetimeUtils');

exports.seed = async function (knex) {
  // Ignorer l'exécution automatique pendant les tests unitaires Jest (NODE_ENV=test)
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  console.log('\n==================================================');
  console.log('  SEED 02 : GÉNÉRATION DU DATASET HISTORIQUE IA  ');
  console.log('==================================================\n');

  // ----------------------------------------------------
  // 1. Récupération ou création des Utilisateurs (Caissiers/Admins)
  // ----------------------------------------------------
  const existingUsers = await knex('users').select('id', 'role');
  let cashierId = null;

  if (existingUsers.length > 0) {
    const cashier = existingUsers.find(u => u.role === 'CASHIER' || u.role === 'ADMIN');
    cashierId = cashier ? cashier.id : existingUsers[0].id;
  } else {
    const [newUserId] = await knex('users').insert({
      name: 'Vendeuse Caissière',
      email: 'cashier_seed02@bakery.com',
      password_hash: '$2a$10$wJzV5v4Q2Y7nL3wK6.u1u.O0a5w6q7r8s9t0u1v2w3x4y5z6a7b8c',
      role: 'CASHIER'
    });
    cashierId = typeof newUserId === 'object' ? newUserId.id : newUserId;
  }

  // ----------------------------------------------------
  // 2. Récupération ou création des Catégories
  // ----------------------------------------------------
  const CATEGORIES_DEF = [
    { name: 'Viennoiserie', description: 'Croissants, pains au chocolat, brioches' },
    { name: 'Pains', description: 'Baguettes, pains de campagne, pains complets' },
    { name: 'Gâteaux', description: 'Forêt noire, fraisier, opéra, millefeuille' },
    { name: 'Pâtisseries individuelles', description: 'Éclairs, Paris-Brest, religieuses, tartelettes' },
    { name: 'Produits saisonniers', description: 'Bûches de Noël, Galettes des rois, Makroudh, Bambalouni' }
  ];

  const categoryMap = {}; // name -> id

  for (const catDef of CATEGORIES_DEF) {
    const existing = await knex('categories').where({ name: catDef.name }).first();
    if (existing) {
      categoryMap[catDef.name] = existing.id;
    } else {
      const [inserted] = await knex('categories').insert({
        name: catDef.name,
        description: catDef.description
      });
      const catId = typeof inserted === 'object' ? inserted.id : inserted;
      categoryMap[catDef.name] = catId;
    }
  }

  // ----------------------------------------------------
  // 3. Récupération ou création des 22 Produits requis
  // ----------------------------------------------------
  const PRODUCTS_DEF = [
    // Viennoiseries
    { name: 'Croissant Pur Beurre', price: 1.30, cost: 0.45, category: 'Viennoiserie', default_stock: 60 },
    { name: 'Pain au Chocolat', price: 1.40, cost: 0.50, category: 'Viennoiserie', default_stock: 50 },
    { name: 'Croissant Amande', price: 1.80, cost: 0.65, category: 'Viennoiserie', default_stock: 35 },
    { name: 'Chausson aux Pommes', price: 1.60, cost: 0.55, category: 'Viennoiserie', default_stock: 40 },
    { name: 'Brioche', price: 2.20, cost: 0.80, category: 'Viennoiserie', default_stock: 30 },

    // Pains
    { name: 'Baguette Tradition', price: 1.10, cost: 0.35, category: 'Pains', default_stock: 120 },
    { name: 'Pain Complet', price: 1.90, cost: 0.60, category: 'Pains', default_stock: 40 },
    { name: 'Pain de Campagne', price: 2.40, cost: 0.80, category: 'Pains', default_stock: 30 },
    { name: 'Pain aux Céréales', price: 2.60, cost: 0.90, category: 'Pains', default_stock: 25 },

    // Gâteaux
    { name: 'Forêt Noire', price: 22.00, cost: 8.50, category: 'Gâteaux', default_stock: 10 },
    { name: 'Fraisier', price: 24.00, cost: 9.00, category: 'Gâteaux', default_stock: 8 },
    { name: 'Opéra', price: 25.00, cost: 9.50, category: 'Gâteaux', default_stock: 8 },
    { name: 'Millefeuille', price: 18.00, cost: 6.50, category: 'Gâteaux', default_stock: 12 },
    { name: 'Tarte Citron', price: 16.00, cost: 5.50, category: 'Gâteaux', default_stock: 15 },

    // Pâtisseries individuelles
    { name: 'Éclair Chocolat', price: 2.80, cost: 0.95, category: 'Pâtisseries individuelles', default_stock: 45 },
    { name: 'Éclair Café', price: 2.80, cost: 0.95, category: 'Pâtisseries individuelles', default_stock: 40 },
    { name: 'Paris-Brest', price: 3.50, cost: 1.20, category: 'Pâtisseries individuelles', default_stock: 25 },
    { name: 'Religieuse', price: 3.20, cost: 1.10, category: 'Pâtisseries individuelles', default_stock: 20 },
    { name: 'Tartelette Fruits', price: 3.80, cost: 1.30, category: 'Pâtisseries individuelles', default_stock: 30 },

    // Produits saisonniers
    { name: 'Bûche de Noël', price: 28.00, cost: 10.00, category: 'Produits saisonniers', default_stock: 15 },
    { name: 'Galette des Rois', price: 20.00, cost: 7.00, category: 'Produits saisonniers', default_stock: 20 },
    { name: 'Makroudh', price: 2.50, cost: 0.80, category: 'Produits saisonniers', default_stock: 80 },
    { name: 'Bambalouni', price: 1.50, cost: 0.40, category: 'Produits saisonniers', default_stock: 100 }
  ];

  const productList = []; // array of objects { id, name, price, cost, category }

  for (const pDef of PRODUCTS_DEF) {
    const catId = categoryMap[pDef.category];
    let product = await knex('products').where({ name: pDef.name }).first();

    if (!product) {
      const [insertedId] = await knex('products').insert({
        name: pDef.name,
        description: `${pDef.name} de fabrication artisanale`,
        price: pDef.price,
        category_id: catId,
        stock_quantity: pDef.default_stock,
        is_active: true
      });

      const prodId = typeof insertedId === 'object' ? insertedId.id : insertedId;
      product = {
        id: prodId,
        name: pDef.name,
        price: pDef.price,
        cost: pDef.cost,
        category: pDef.category
      };
    } else {
      product = {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        cost: pDef.cost,
        category: pDef.category
      };
    }
    productList.push(product);
  }

  console.log(`[INFO] Total des produits prêts pour la génération : ${productList.length}`);

  // ----------------------------------------------------
  // 4. Génération de l'historique sur 180 Jours
  // ----------------------------------------------------
  const TOTAL_DAYS = 180;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - TOTAL_DAYS);

  const salesToInsert = [];
  const saleItemsToInsert = [];
  let receiptCounter = 10000;

  // Préparation du générateur pseudo-aléatoire déterministe
  function pseudoRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  let randomSeed = 42;

  console.log(`[INFO] Génération des ventes du ${toMySQLDate(startDate)} au ${toMySQLDate(endDate)}...`);

  // Boucle jour par jour (180 jours)
  for (let dayIndex = 0; dayIndex < TOTAL_DAYS; dayIndex++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + dayIndex);

    const dateStr = toMySQLDate(currentDate);
    const month = currentDate.getMonth() + 1; // 1..12
    const dayOfWeek = currentDate.getDay(); // 0 = Dimanche, 6 = Samedi
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

    // Anomalies
    const isBadWeatherAnomaly = (dayIndex === 45); // Chute brutale de ventes (-80%)
    const isSpecialEventAnomaly = (dayIndex === 90); // Pic exceptionnel (+300%)

    // Nombre de transactions de vente pour la journée (base = 30 par jour)
    let dailyTransactionCount = 30;
    if (isWeekend) dailyTransactionCount = Math.floor(dailyTransactionCount * 1.25); // +25% le week-end
    if (isBadWeatherAnomaly) dailyTransactionCount = Math.floor(dailyTransactionCount * 0.20); // -80% tempête
    if (isSpecialEventAnomaly) dailyTransactionCount = Math.floor(dailyTransactionCount * 2.5); // Event traiteur

    for (let t = 0; t < dailyTransactionCount; t++) {
      receiptCounter++;
      const receiptNumber = `REC-${dateStr.replace(/-/g, '')}-${dayIndex}-${t}-${Math.floor(pseudoRandom(randomSeed++) * 89999 + 10000)}`;

      // Heure aléatoire de la vente dans la journée (entre 07h00 et 19h00)
      const hour = 7 + Math.floor(pseudoRandom(randomSeed++) * 12);
      const minute = Math.floor(pseudoRandom(randomSeed++) * 60);
      const second = Math.floor(pseudoRandom(randomSeed++) * 60);

      const saleCreatedAt = `${dateStr} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

      // Choix de 1 à 4 produits distincts pour cette transaction
      const itemsInSaleCount = 1 + Math.floor(pseudoRandom(randomSeed++) * 3);
      const shuffledProducts = [...productList].sort(() => 0.5 - pseudoRandom(randomSeed++));
      const selectedProducts = shuffledProducts.slice(0, itemsInSaleCount);

      let saleTotalAmount = 0;
      let saleTotalCost = 0;
      let saleTotalMargin = 0;
      let saleTotalItemsCount = 0;

      const currentItemsForThisSale = [];

      for (const prod of selectedProducts) {
        // Multiplicateurs saisonniers par produit
        let seasonalMultiplier = 1.0;

        if (prod.name === 'Bûche de Noël') {
          seasonalMultiplier = (month === 12) ? 5.0 : 0.05; // Pic en Décembre
        } else if (prod.name === 'Galette des Rois') {
          seasonalMultiplier = (month === 1) ? 5.0 : 0.05; // Pic en Janvier
        } else if (prod.name === 'Makroudh' || prod.name === 'Bambalouni') {
          seasonalMultiplier = (month === 2 || month === 3) ? 3.5 : 1.0; // Pic Ramadan
        }

        // Quantité vendue pour ce produit
        let baseQty = 1 + Math.floor(pseudoRandom(randomSeed++) * 4);
        if (prod.category === 'Pains' || prod.category === 'Viennoiserie') {
          baseQty = 1 + Math.floor(pseudoRandom(randomSeed++) * 6);
        }

        let qty = Math.max(1, Math.round(baseQty * seasonalMultiplier));
        if (isSpecialEventAnomaly && (prod.name === 'Croissant Pur Beurre' || prod.name === 'Pain au Chocolat')) {
          qty += 25; // Commande géante lors de l'anomalie événementielle
        }

        const unitPrice = prod.price;
        const costPerUnit = prod.cost;
        const subtotal = Number((qty * unitPrice).toFixed(2));
        const totalCostItem = Number((qty * costPerUnit).toFixed(2));
        const itemMargin = Number((subtotal - totalCostItem).toFixed(2));

        saleTotalAmount += subtotal;
        saleTotalCost += totalCostItem;
        saleTotalMargin += itemMargin;
        saleTotalItemsCount += qty;

        currentItemsForThisSale.push({
          product_id: prod.id,
          quantity: qty,
          unit_price: unitPrice,
          subtotal: subtotal,
          cost_per_unit: costPerUnit,
          margin: itemMargin,
          created_at: saleCreatedAt,
          updated_at: saleCreatedAt
        });
      }

      salesToInsert.push({
        receipt_number: receiptNumber,
        cashier_id: cashierId,
        total_amount: Number(saleTotalAmount.toFixed(2)),
        total_cost: Number(saleTotalCost.toFixed(2)),
        total_margin: Number(saleTotalMargin.toFixed(2)),
        total_items: saleTotalItemsCount,
        payment_method: pseudoRandom(randomSeed++) > 0.3 ? 'CASH' : 'CARD',
        status: 'PAID',
        completed_at: saleCreatedAt,
        created_at: saleCreatedAt,
        updated_at: saleCreatedAt,
        _items: currentItemsForThisSale // temporaire pour association d'IDs
      });
    }
  }

  console.log(`[INFO] Préparation de ${salesToInsert.length} ventes et leurs articles correspondants...`);

  // ----------------------------------------------------
  // 5. Insertion par lots (Chunking) dans la base de données
  // ----------------------------------------------------
  const CHUNK_SIZE = 30;
  const ITEM_CHUNK_SIZE = 30;
  let insertedSalesCount = 0;
  let insertedItemsCount = 0;

  for (let i = 0; i < salesToInsert.length; i += CHUNK_SIZE) {
    const salesChunk = salesToInsert.slice(i, i + CHUNK_SIZE);

    // Préparer les objets ventes sans la propriété temporaire `_items`
    const salesDbRows = salesChunk.map(({ _items, ...saleRow }) => saleRow);

    // Insertion du lot de ventes
    await knex('sales').insert(salesDbRows);

    // mysql2 ne renvoie que le PREMIER insertId sur une insertion multi-lignes
    // (.returning() y est sans effet) : relecture des IDs par receipt_number,
    // unique en base. Compatible SQLite et MySQL.
    const receiptNumbers = salesDbRows.map((r) => r.receipt_number);
    const insertedRows = await knex('sales')
      .whereIn('receipt_number', receiptNumbers)
      .select('id', 'receipt_number');
    const idByReceipt = new Map(insertedRows.map((r) => [r.receipt_number, r.id]));
    const insertedIds = salesDbRows.map((r) => idByReceipt.get(r.receipt_number));

    // Récupération des IDs générés et association des articles
    const itemsChunkToInsert = [];
    salesChunk.forEach((saleObj, idx) => {
      const insertedSaleId = typeof insertedIds[idx] === 'object' ? insertedIds[idx].id : insertedIds[idx];
      saleObj._items.forEach(item => {
        itemsChunkToInsert.push({
          sale_id: insertedSaleId,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
          cost_per_unit: item.cost_per_unit,
          margin: item.margin,
          created_at: item.created_at,
          updated_at: item.updated_at
        });
      });
    });

    // Insertion des articles par sous-lots de 50 pour éviter la limite SQLite (too many terms in compound SELECT)
    for (let j = 0; j < itemsChunkToInsert.length; j += ITEM_CHUNK_SIZE) {
      const subChunk = itemsChunkToInsert.slice(j, j + ITEM_CHUNK_SIZE);
      await knex('sale_items').insert(subChunk);
    }
    insertedItemsCount += itemsChunkToInsert.length;
    insertedSalesCount += salesChunk.length;
  }

  // ----------------------------------------------------
  // 6. Insertion d'une anomalie de Gaspillage (Stock Movement WASTE)
  // ----------------------------------------------------
  const ingredientFlour = await knex('ingredients').first();
  if (ingredientFlour) {
    await knex('stock_movements').insert({
      ingredient_id: ingredientFlour.id,
      movement_type: 'WASTE',
      quantity: 15.5,
      reason: 'Gaspillage / Péremption ingrédient (Anomalie détectée)',
      created_by: cashierId,
      created_at: toMySQLDatetime(new Date())
    });
  }

  // ----------------------------------------------------
  // 7. Vérifications & Rapport d'exécution
  // ----------------------------------------------------
  const totalSalesInDb = await knex('sales').count('* as count').first();
  const totalItemsInDb = await knex('sale_items').count('* as count').first();
  const totalProductsInDb = await knex('products').count('* as count').first();

  console.log('\n==================================================');
  console.log('        RÉSUMÉ DU SEED 02 (DATASET IA)           ');
  console.log('==================================================');
  console.log(`- Nouvelles ventes insérées    : ${insertedSalesCount}`);
  console.log(`- Nouveaux articles insérés   : ${insertedItemsCount}`);
  console.log(`- Total ventes en base        : ${totalSalesInDb.count}`);
  console.log(`- Total articles en base      : ${totalItemsInDb.count}`);
  console.log(`- Total produits en base      : ${totalProductsInDb.count}`);
  console.log('==================================================\n');
};
