/**
 * Seed 02 — Dataset Historique IA (ADDITIF & IDEMPOTENT)
 * Fichier : backend/seeds/02_ai_historical_dataset.js
 *
 * Objectif :
 *   Alimenter les modules IA & Analytics (Forecast, Production Recommendations,
 *   Stock Analytics, Anomaly Detection, Product Segmentation, Dashboard Analytics)
 *   en garantissant MINIMUM 60 observations et idéalement 180 jours d'historique
 *   par produit, avec saisonnalité réaliste, pics de ventes, week-ends plus élevés,
 *   anomalies contrôlées, ruptures de stock réalistes et achats fournisseurs cohérents.
 *
 * Contraintes :
 *   - Ne SUPPRIME AUCUNE donnée (aucun del/truncate).
 *   - N'AJOUTE QUE les données MANQUANTES (audit temps réel avant génération).
 *   - Réutilise produits, catégories, utilisateurs, fournisseurs et ingrédients
 *     EXISTANTS — ne crée/touche jamais ces référentiels.
 *   - Évite TOUT doublon :
 *       * Ventes : un (product, date) déjà présent est ignoré.
 *       * Reçus  : préfixe `REC-AI-` distinct + compteur monotone.
 *       * PO     : ajout conditionné à l'absence d'un PO même date de réception.
 *       * Mouve. : vérification (ingredient, type, date, reason).
 *   - Compatible SQLite ET MySQL :
 *       * Identifiants d'articles récupérés via `WHERE receipt_number IN (...)`
 *         et NON via `.returning()` (non supporté par mysql2).
 *       * Timestamps 'YYYY-MM-DD HH:MM:SS' valides sur les deux SGBD.
 *       * Insertions par lots (évite la limite SQLite « too many terms in compound
 *         SELECT »).
 *   - Respecte toutes les clés étrangères (users, categories, products, sales,
 *     sale_items, suppliers, ingredients, purchase_orders, purchase_order_items,
 *     stock_movements).
 *   - Ignore l'exécution automatique sous Jest (NODE_ENV=test).
 */

exports.seed = async function (knex) {
  // Ignorer l'exécution automatique pendant les tests unitaires Jest.
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  console.log('\n====================================================');
  console.log('  SEED 02 : DATASET HISTORIQUE IA (ADDITIF)         ');
  console.log('====================================================\n');

  // ------------------------------------------------------------
  // 0. Petits utilitaires locaux
  // ------------------------------------------------------------
  function pseudoRandom(seed) {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // Normalise un timestamp DB (Date, chaîne ISO ou 'YYYY-MM-DD HH:MM:SS') en 'YYYY-MM-DD'.
  const dateOnly = (ts) => {
    if (!ts) return null;
    return String(ts).slice(0, 10);
  };
  const rng = { n: 20260821 }; // graine déterministe partagée

  // ------------------------------------------------------------
  // 1. Récupération des référentiels EXISTANTS (jamais modifiés)
  // ------------------------------------------------------------
  const products = await knex('products').select('id', 'name', 'price', 'category_id', 'stock_quantity');
  const categories = await knex('categories').select('id', 'name');
  const users = await knex('users').select('id', 'role');

  if (products.length === 0) {
    console.log('[INFO] Aucun produit en base — seed ignoré (rien à compléter).');
    return;
  }

  const cashierRow = users.find((u) => u.role === 'CASHIER') || users.find((u) => u.role === 'ADMIN') || users[0];
  const stockUserRow = users.find((u) => u.role === 'STOCK') || users.find((u) => u.role === 'ADMIN') || users[0];
  const cashierId = cashierRow ? cashierRow.id : null;
  const stockUserId = stockUserRow ? stockUserRow.id : null;

  const ingredients = await knex('ingredients').select('id', 'name', 'supplier_id');
  const suppliers = await knex('suppliers').select('id', 'name');

// ------------------------------------------------------------
  // 2. Profils de génération par produit (clé stable = NOM)
  //    base = quantité quotidienne de référence ; weekend = boost week-end ;
  //    seasonal = {mois: multiplicateur} ; seasonalOff = multiplicateur hors période.
  // ------------------------------------------------------------
  const PROFILE = {
    'Croissant Pur Beurre': { base: 20, weekend: 1.20 },
    'Pain au Chocolat': { base: 12, weekend: 1.20 },
    'Croissant Amande': { base: 9, weekend: 1.15 },
    'Chausson aux Pommes': { base: 7, weekend: 1.15 },
    'Brioche': { base: 6, weekend: 1.10 },
    'Baguette Tradition': { base: 32, weekend: 1.15 },
    'Pain Complet': { base: 7, weekend: 1.10 },
    'Pain de Campagne': { base: 6, weekend: 1.10 },
    'Pain aux Céréales': { base: 5, weekend: 1.10 },
    'Forêt Noire': { base: 2, weekend: 1.15 },
    'Fraisier': { base: 2, weekend: 1.10 },
    'Opéra': { base: 2, weekend: 1.10 },
    'Millefeuille': { base: 3, weekend: 1.10 },
    'Tarte Citron': { base: 3, weekend: 1.10 },
    'Éclair Chocolat': { base: 10, weekend: 1.10 },
    'Éclair Café': { base: 8, weekend: 1.10 },
    'Paris-Brest': { base: 5, weekend: 1.10 },
    'Religieuse': { base: 5, weekend: 1.10 },
    'Tartelette Fruits': { base: 6, weekend: 1.10 },
    'Bûche de Noël': { base: 2, weekend: 1.10, seasonal: { 12: 8.0 }, seasonalOff: 0.20 },
    'Galette des Rois': { base: 2, weekend: 1.10, seasonal: { 1: 8.0 }, seasonalOff: 0.20 },
    'Makroudh': { base: 6, weekend: 1.10, seasonal: { 2: 3.0, 3: 3.0 }, seasonalOff: 0.70 },
    'Bambalouni': { base: 8, weekend: 1.10, seasonal: { 2: 3.0, 3: 3.0 }, seasonalOff: 0.70 }
  };

  // Ruptures de stock déterministes : { nomProduit: [indices-jours depuis le début de la fenêtre] }.
  // Ces jours sont VOLONTAIREMENT exclus de la génération (vrai trou d'historique).
  const STOCKOUTS = {
    'Bûche de Noël': [45, 46],     // panne hors saison
    'Forêt Noire': [120, 121],     // rupture ingrédient
    'Baguette Tradition': [33],    // grève fournisseur (1 jour)
    'Croissant Pur Beurre': [88]   // four cassé (1 jour)
  };

  // ------------------------------------------------------------
  // 3. Fenêtre glissante de 180 jours (fin = aujourd'hui)
  // ------------------------------------------------------------
  const TOTAL_DAYS = 180;
  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setDate(today.getDate() - TOTAL_DAYS);

  console.log(`[INFO] ${products.length} produits réutilisés, ${categories.length} catégories, fenêtre de ${TOTAL_DAYS} jours (${toDateStr(windowStart)} → ${toDateStr(today)}).`);

  // ------------------------------------------------------------
  // 4. Historique EXISTANT : ensemble (product_id -> Set<'YYYY-MM-DD'>)
  //    Sert d'exclusion anti-doublons lors de la génération.
  // ------------------------------------------------------------
  const existingSaleDates = {};
  const rawPairs = await knex('sale_items as si')
    .join('sales as s', 's.id', 'si.sale_id')
    .select('si.product_id', 's.created_at');
  for (const row of rawPairs) {
    const d = dateOnly(row.created_at);
    if (d === null) continue;
    if (!existingSaleDates[row.product_id]) existingSaleDates[row.product_id] = new Set();
    existingSaleDates[row.product_id].add(d);
  }

  // Views pré-existantes par produit DANS la fenêtre (pour le rapport de validation).
  const obsBefore = {};
  for (const p of products) {
    obsBefore[p.id] = 0;
    const set = existingSaleDates[p.id];
    if (!set) continue;
    for (let i = 0; i < TOTAL_DAYS; i++) {
      const d = new Date(windowStart);
      d.setDate(windowStart.getDate() + i);
      if (set.has(toDateStr(d))) obsBefore[p.id]++;
    }
  }

  // ------------------------------------------------------------
  // 5. Génération ADDITIVE des seuls jours manquants
  // ------------------------------------------------------------
  const salesToInsert = [];  // lignes `sales`
  const pendingItems = [];   // { receipt_number, item, ts }
  let receiptCounter = 0;    // compteur monotone -> reçus uniques (jamais recréés)
  let generatedObs = 0;

  // Coût approximatif par produit (ratio sur le prix EXISTANT) pour alimenter
  // sale_items.cost_per_unit / margin de manière cohérente avec le backend.
  const costRatio = (name) => {
    if (!name) return 0.40;
    if (name.includes('Bûche') || name.includes('Galette') || name.includes('Opéra')) return 0.38;
    if (name.includes('Forêt') || name.includes('Fraisier')) return 0.42;
    return 0.45;
  };

  for (let dayIndex = 0; dayIndex < TOTAL_DAYS; dayIndex++) {
    const currentDate = new Date(windowStart);
    currentDate.setDate(windowStart.getDate() + dayIndex);
    const dateStr = toDateStr(currentDate);
    const month = currentDate.getMonth() + 1;   // 1..12
    const dayOfWeek = currentDate.getDay();      // 0=Dimanche, 6=Samedi
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

    // Anomalies contrôlées (mêmes indices que le seed initial pour cohérence).
    const isBadWeather = (dayIndex === 45);   // chute brutale (-80% de volume)
    const isSpecialEvent = (dayIndex === 90); // pic événementiel (+300%)

    // Produits à vendre ce jour = ceux SANS observation existante ET hors rupture.
    const needed = [];
    for (const p of products) {
      const set = existingSaleDates[p.id];
      if (set && set.has(dateStr)) continue;              // déjà présent -> jamais de doublon
      const outs = STOCKOUTS[p.name];
      if (outs && outs.includes(dayIndex)) continue;      // rupture de stock volontaire
      needed.push(p);
    }

    let daySaleCount = 0;

    // Répartir les produits nécessaires en paniers de 1 à 3 produits (1 vente/panier).
    while (needed.length > 0) {
      const basket = needed.splice(0, 1 + Math.floor(pseudoRandom(rng.n++) * 3));
      const items = [];
      let total = 0;
      let totalCost = 0;

      for (const p of basket) {
        const prof = PROFILE[p.name] || { base: 3, weekend: 1.1 };
        let qty = prof.base || 3;
        if (isWeekend) qty = qty * (prof.weekend || 1.1);
        if (prof.seasonal) {
          qty = qty * (prof.seasonal[month] !== undefined ? prof.seasonal[month]
            : (prof.seasonalOff !== undefined ? prof.seasonalOff : 1));
        }
        // Variabilité journalière réaliste (+/- 22%).
        qty = qty * (0.78 + pseudoRandom(rng.n++) * 0.44);

        // Anomalie événementielle : sur-brûlure sur les produits du panier.
        if (isSpecialEvent) qty = qty * 3.0;

        qty = Math.max(1, Math.round(qty));
        // Anomalie météo : forte baisse ce jour-là (chute réelle).
        if (isBadWeather) qty = Math.max(0, qty - Math.round(qty * 0.6));

        if (qty <= 0) continue; // jour de fermeture/anomalie => aucun article

        const unitPrice = Number(p.price);
        const costPerUnit = Number((unitPrice * costRatio(p.name)).toFixed(4));
        const subtotal = Number((qty * unitPrice).toFixed(2));
        const margin = Number((subtotal - qty * costPerUnit).toFixed(2));
        total += subtotal;
        totalCost += qty * costPerUnit;

        items.push({
          product_id: p.id,
          quantity: qty,
          unit_price: unitPrice,
          subtotal: subtotal,
          cost_per_unit: costPerUnit,
          margin: margin
        });
        generatedObs++;
      }

      if (items.length === 0) continue;

      const hour = 7 + Math.floor(pseudoRandom(rng.n++) * 12);
      const minute = Math.floor(pseudoRandom(rng.n++) * 60);
      const second = Math.floor(pseudoRandom(rng.n++) * 60);
      const saleTs = `${dateStr} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
      const receiptNumber = `REC-AI-${dateStr.replace(/-/g, '')}-${String(receiptCounter++).padStart(5, '0')}`;

      salesToInsert.push({
        receipt_number: receiptNumber,
        cashier_id: cashierId,
        total_amount: Number(total.toFixed(2)),
        total_cost: Number(totalCost.toFixed(2)),
        total_margin: Number((total - totalCost).toFixed(2)),
        total_items: items.reduce((s, it) => s + it.quantity, 0),
        payment_method: pseudoRandom(rng.n++) > 0.3 ? 'CASH' : 'CARD',
        status: 'PAID',
        customer_name: 'Walk-in',
        completed_at: saleTs,
        created_at: saleTs,
        updated_at: saleTs
      });

      for (const it of items) {
        pendingItems.push({ receipt_number: receiptNumber, item: it, ts: saleTs });
      }
      daySaleCount++;
    }

    if (daySaleCount > 0 && isSpecialEvent) {
      console.log(`  [anomalie] Pic événementiel jour ${dayIndex} (${dateStr}).`);
    }
    if (daySaleCount > 0 && isBadWeather) {
      console.log(`  [anomalie] Chute météo jour ${dayIndex} (${dateStr}) : forte baisse de volume.`);
    }
    for (const outs of Object.entries(STOCKOUTS)) {
      if (outs[1].includes(dayIndex)) {
        console.log(`  [rupture] ${outs[0]} : aucune vente le jour ${dayIndex} (${dateStr}).`);
      }
    }
  }

  console.log(`[INFO] Observations manquantes générées : ${generatedObs} ; nouvelles ventes : ${salesToInsert.length}.`);

  // Index articles par reçu pour une jointure rapide.
  const itemsByReceipt = {};
  for (const pi of pendingItems) {
    if (!itemsByReceipt[pi.receipt_number]) itemsByReceipt[pi.receipt_number] = [];
    itemsByReceipt[pi.receipt_number].push(pi);
  }

  // ------------------------------------------------------------
  // 6. Insertion ADDITIVE des ventes (lots) et de leurs articles
  // ------------------------------------------------------------
  let insertedSales = 0;
  let insertedItems = 0;
  const SALE_CHUNK = 50;
  const ITEM_CHUNK = 50;

  for (let i = 0; i < salesToInsert.length; i += SALE_CHUNK) {
    const chunk = salesToInsert.slice(i, i + SALE_CHUNK);

    // Insertion multi-lignes par sous-lots (évite la limite SQLite).
    for (let j = 0; j < chunk.length; j += ITEM_CHUNK) {
      await knex('sales').insert(chunk.slice(j, j + ITEM_CHUNK));
    }
    insertedSales += chunk.length;

    // Récupérer les IDs réels via receipt_number (compatible SQLite & MySQL,
    // contrairement à `.returning()` non supporté par mysql2).
    const receipts = chunk.map((s) => s.receipt_number);
    const insertedRows = await knex('sales')
      .select('id', 'receipt_number')
      .whereIn('receipt_number', receipts);

    const idByReceipt = {};
    for (const r of insertedRows) idByReceipt[r.receipt_number] = r.id;

    const itemsToInsert = [];
    for (const s of chunk) {
      const saleId = idByReceipt[s.receipt_number];
      if (saleId === undefined) continue;
      for (const pi of itemsByReceipt[s.receipt_number] || []) {
        itemsToInsert.push({
          sale_id: saleId,
          product_id: pi.item.product_id,
          quantity: pi.item.quantity,
          unit_price: pi.item.unit_price,
          subtotal: pi.item.subtotal,
          cost_per_unit: pi.item.cost_per_unit,
          margin: pi.item.margin,
          created_at: pi.ts,
          updated_at: pi.ts
        });
      }
    }

    for (let j = 0; j < itemsToInsert.length; j += ITEM_CHUNK) {
      await knex('sale_items').insert(itemsToInsert.slice(j, j + ITEM_CHUNK));
    }
    insertedItems += itemsToInsert.length;
  }

  // ------------------------------------------------------------
  // 7. Mouvements de stock cohérents (IDEMPOTENT par raison distinctive)
  //    Un mouvement n'est inséré que s'il n'existe pas déjà (even clé).
  // ------------------------------------------------------------
  const REASON = 'Dataset IA';
  const movementsToInsert = [];
  const stockActor = stockUserId || cashierId;
  const restockDays = [150, 120, 90, 60, 30]; // jours de réapprovisionnement (partagés avec les PO)

  // Réceptions fournisseurs (IN) -> réapprovisionnement des ingrédients.
  for (const d of restockDays) {
    const dt = new Date(windowStart);
    dt.setDate(windowStart.getDate() + d);
    const ts = `${toDateStr(dt)} 08:00:00`;
    for (const ing of ingredients) {
      movementsToInsert.push({
        ingredient_id: ing.id,
        movement_type: 'IN',
        quantity: ing.name.includes('Farine') ? 80 : (ing.name.includes('Beurre') ? 40 : (ing.name.includes('Chocolat') ? 20 : 30)),
        reason: `Réception fournisseur (${REASON})`,
        created_by: stockActor,
        created_at: ts,
        updated_at: ts
      });
    }
  }

  // Production (PRODUCTION) -> consommation farine/beurre sur quelques jours.
  const prodDays = [160, 140, 110, 80, 50, 20];
  for (const d of prodDays) {
    const dt = new Date(windowStart);
    dt.setDate(windowStart.getDate() + d);
    const ts = `${toDateStr(dt)} 06:00:00`;
    for (const ing of ingredients) {
      if (ing.name.includes('Chocolat') || ing.name.includes('Sucre')) continue;
      movementsToInsert.push({
        ingredient_id: ing.id,
        movement_type: 'PRODUCTION',
        quantity: -30.0,
        reason: `Production du jour (${REASON})`,
        created_by: stockActor,
        created_at: ts,
        updated_at: ts
      });
    }
  }

  // Gaspillage (WASTE) -> anomalie contrôlée.
  const wasteTs = `${toDateStr(windowStart)} 18:30:00`;
  movementsToInsert.push({
    ingredient_id: ingredients[1] ? ingredients[1].id : null,
    movement_type: 'WASTE',
    quantity: -6.0,
    reason: `Gaspillage / péremption (${REASON})`,
    created_by: stockActor,
    created_at: wasteTs,
    updated_at: wasteTs
  });

  // Ajustement de rupture (ADJUSTMENT) -> remise à zéro après pénurie farine.
  const adjDt = new Date(windowStart);
  adjDt.setDate(windowStart.getDate() + 33);
  const adjTs = `${toDateStr(adjDt)} 20:00:00`;
  movementsToInsert.push({
    ingredient_id: ingredients[0] ? ingredients[0].id : null,
    movement_type: 'ADJUSTMENT',
    quantity: -15.0,
    reason: `Ajustement rupture (${REASON})`,
    created_by: stockActor,
    created_at: adjTs,
    updated_at: adjTs
  });

  // Insertion idempotente : on saute un mouvement déjà présent (même clé).
  let insertedMovements = 0;
  for (const mv of movementsToInsert) {
    if (mv.ingredient_id === null || mv.ingredient_id === undefined) continue;
    const exists = await knex('stock_movements')
      .where({
        ingredient_id: mv.ingredient_id,
        movement_type: mv.movement_type,
        reason: mv.reason,
        created_at: mv.created_at
      })
      .first();
    if (!exists) {
      await knex('stock_movements').insert(mv);
      insertedMovements++;
    }
  }

  // ------------------------------------------------------------
  // 8. Achats fournisseurs cohérents avec les réceptions (IDEMPOTENT)
  // ------------------------------------------------------------
  let insertedPOs = 0;
  if (suppliers.length > 0 && ingredients.length > 0) {
    const sup = suppliers[0];
    const unitCosts = { 'Farine T45': 1.20, 'Beurre Doux 82%': 8.50, 'Sucre Cristal': 1.50, 'Bâtons de Chocolat': 12.00 };

    for (const d of restockDays) {
      const dt = new Date(windowStart);
      dt.setDate(windowStart.getDate() + d);
      const recvTs = `${toDateStr(dt)} 09:00:00`;

      // Éviter les doublons : un seul PO RECEIVED par fournisseur/date de réception.
      const existingPO = await knex('purchase_orders')
        .where({ supplier_id: sup.id, status: 'RECEIVED', received_at: recvTs })
        .first();
      if (existingPO) continue;

      let totalCost = 0;
      const poItems = ingredients.map((ing) => {
        const qty = ing.name.includes('Farine') ? 80
          : (ing.name.includes('Beurre') ? 40
            : (ing.name.includes('Chocolat') ? 20 : 30));
        const uc = unitCosts[ing.name] || 1.0;
        totalCost += qty * uc;
        return { ingredient_id: ing.id, quantity_ordered: qty, unit_cost: uc, quantity_received: qty };
      });

      await knex('purchase_orders').insert({
        supplier_id: sup.id,
        status: 'RECEIVED',
        total_cost: Number(totalCost.toFixed(2)),
        received_at: recvTs,
        created_by: stockActor,
        created_at: recvTs,
        updated_at: recvTs
      });

      // Re-sélection via la clé (compatible SQLite/MySQL, pas de .returning()).
      const poRow = await knex('purchase_orders')
        .where({ supplier_id: sup.id, status: 'RECEIVED', received_at: recvTs })
        .first();
      if (!poRow) continue;
      const poId = poRow.id;

      const rows = poItems.map((it) => ({
        purchase_order_id: poId,
        ingredient_id: it.ingredient_id,
        quantity_ordered: it.quantity_ordered,
        unit_cost: it.unit_cost,
        quantity_received: it.quantity_received
      }));
      for (let j = 0; j < rows.length; j += ITEM_CHUNK) {
        await knex('purchase_order_items').insert(rows.slice(j, j + ITEM_CHUNK));
      }
      insertedPOs++;
    }
  }

  // ------------------------------------------------------------
  // 9. Rapport de validation
  // ------------------------------------------------------------
  const totalProducts = await knex('products').count('* as c').first();
  const totalSales = await knex('sales').count('* as c').first();
  const totalItems = await knex('sale_items').count('* as c').first();

  // Observations (jours distincts) par produit APRÈS génération, DANS la fenêtre.
  const afterPairs = await knex('sale_items as si')
    .join('sales as s', 's.id', 'si.sale_id')
    .select('si.product_id', 's.created_at');
  const afterDates = {};
  for (const row of afterPairs) {
    const dd = dateOnly(row.created_at);
    if (dd === null) continue;
    if (!afterDates[row.product_id]) afterDates[row.product_id] = new Set();
    afterDates[row.product_id].add(dd);
  }

  console.log('\n--- VALIDATION PAR PRODUIT (jours distincts, fenêtre de 180 j) ---');
  let forecastable = 0;
  let insufficient = 0;
  const insufficientList = [];
  for (const p of products) {
    const set = afterDates[p.id];
    let inWindow = 0;
    if (set) {
      for (let i = 0; i < TOTAL_DAYS; i++) {
        const d = new Date(windowStart);
        d.setDate(windowStart.getDate() + i);
        if (set.has(toDateStr(d))) inWindow++;
      }
    }
    const isOk = inWindow >= 14;
    if (isOk) forecastable++; else { insufficient++; insufficientList.push(`${p.name}(${inWindow})`); }
    console.log(`  pid=${String(p.id).padEnd(3)} ${String(p.name).padEnd(24)} obs=${String(inWindow).padEnd(4)} ${isOk ? 'FORECASTABLE' : 'INSUFFICIENT'}`);
  }

  console.log('\n====================================================');
  console.log('      RÉSUMÉ DU SEED 02 (DATASET IA ADDITIF)         ');
  console.log('====================================================');
  console.log(`- Nouvelles ventes insérées       : ${insertedSales}`);
  console.log(`- Nouveaux articles insérés      : ${insertedItems}`);
  console.log(`- Nouveaux mouvements de stock   : ${insertedMovements}`);
  console.log(`- Nouveaux bons de commande      : ${insertedPOs}`);
  console.log(`- Total produit en base          : ${totalProducts.c}`);
  console.log(`- Total ventes en base           : ${totalSales.c}`);
  console.log(`- Total articles en base         : ${totalItems.c}`);
  console.log(`- Produits FORECASTABLES         : ${forecastable}/${products.length}`);
  console.log(`- Produits encore INSUFFISANTS   : ${insufficient}${insufficientList.length ? ' -> ' + insufficientList.join(', ') : ''}`);
  console.log('====================================================\n');
};