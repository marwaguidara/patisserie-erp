// Patch: replace collectNotifications() body with RBAC-filtered version
const fs = require('fs');
const filePath = 'c:/marwaguidara/summer/frontend/app.js';
let content = fs.readFileSync(filePath, 'utf8');

// Replace the entire collectNotifications function using regex (handles \r\n)
const funcRegex = /function collectNotifications\(\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction notifUnreadCount/;
if (!funcRegex.test(content)) {
  console.error('collectNotifications function pattern not found');
  process.exit(1);
}

const newFunc = `function collectNotifications() {
  const list = [];
  const role = getRole();

  // --- Server notifications (already RBAC-filtered at DB level) ---
  (__serverNotifications || []).forEach((n) => {
    list.push({
      id: 'srv:' + n.id,
      category: n.category || 'system',
      title: n.title,
      message: n.message || '',
      priority: n.priority || 'Information',
      date: new Date(n.created_at || n.date || Date.now()),
      tab: n.target_tab || null,
      is_read: n.is_read || false,
    });
  });

  // --- Stock critique (ADMIN + STOCK only) ---
  if (can('view_stock_alerts')) {
    const lowStock = (__stockAlerts && Array.isArray(__stockAlerts.low_stock)) ? __stockAlerts.low_stock : [];
    lowStock.forEach((ing) => {
      list.push({
        id: 'stock:' + ing.id,
        category: 'stock',
        title: 'Stock faible \\u2014 ' + (ing.name || ('Ingr\\u00e9dient #' + ing.id)),
        message: 'Niveau actuel ' + ing.current_stock + ' ' + (ing.unit || '') + ' (minimum ' + ing.minimum_stock + ').',
        priority: 'Critique',
        date: new Date(),
        tab: 'ingredients'
      });
    });
  }

  // --- Peremptions (ADMIN + STOCK only) ---
  if (can('view_stock_alerts')) {
    const expiring = (__stockAlerts && Array.isArray(__stockAlerts.expiring_soon)) ? __stockAlerts.expiring_soon : [];
    expiring.forEach((ing) => {
      list.push({
        id: 'expiry:' + ing.id,
        category: 'expiry',
        title: 'Peremption proche \\u2014 ' + (ing.name || ('Ingr\\u00e9dient #' + ing.id)),
        message: 'Expire le ' + (ing.expiration_date || 'sous peu') + '.',
        priority: 'Important',
        date: new Date(),
        tab: 'ingredients'
      });
    });
  }

  // --- IA anomalies (ADMIN + STOCK only) ---
  if (can('view_ai_anomalies')) {
    __aiAnomalies.forEach((a) => {
      const name = anomalyProductName(a.product_id);
      const typeLabel = ANOMALY_TYPE_LABELS[a.type] || a.type;
      const detail = (a.confidence && a.confidence.detail) ? a.confidence.detail : typeLabel;
      list.push({
        id: 'ia:' + a.product_id + ':' + a.type,
        category: 'ia',
        title: 'Anomalie IA \\u2014 ' + name,
        message: detail,
        priority: a.severity === 'haute' ? 'Critique' : 'Important',
        date: new Date(),
        tab: 'dashboard'
      });
    });
  }

  // --- Commandes fournisseur (ADMIN + STOCK + PRODUCTION only) ---
  if (can('view_purchase_orders')) {
    (purchaseOrdersList || []).forEach((po) => {
      if (po && po.status && po.status !== 'RECEIVED' && po.status !== 'CANCELLED') {
        list.push({
          id: 'orders:po:' + po.id,
          category: 'orders',
          title: 'Commande fournisseur #' + po.id,
          message: 'Statut : ' + po.status + '.',
          priority: 'Important',
          date: new Date(),
          tab: 'purchase-orders'
        });
      }
    });
  }

  // --- Commandes client (ADMIN + CASHIER + PRODUCTION only) ---
  if (can('view_customer_orders')) {
    (customerOrdersList || []).forEach((co) => {
      if (co && co.status && co.status !== 'DELIVERED' && co.status !== 'CANCELLED') {
        list.push({
          id: 'orders:co:' + co.id,
          category: 'orders',
          title: 'Commande client #' + co.id,
          message: 'Statut : ' + co.status + '.',
          priority: 'Important',
          date: new Date(),
          tab: 'customer-orders'
        });
      }
    });
  }

  // --- System (informational -- all authenticated roles) ---
  const statusEl = document.getElementById('api-status');
  list.push({
    id: 'system:session',
    category: 'system',
    title: 'Session',
    message: currentUser
      ? (currentUser.name + ' (' + currentUser.role + ') \\u2014 ' + (statusEl ? statusEl.textContent : ''))
      : 'Non connect\\u00e9',
    priority: 'Information',
    date: new Date(),
    tab: null
  });

  return list;
\\nfunction notifUnreadCount`;

content = content.replace(funcRegex, newFunc);
fs.writeFileSync(filePath, content);
console.log('collectNotifications() replaced with RBAC-filtered version');

