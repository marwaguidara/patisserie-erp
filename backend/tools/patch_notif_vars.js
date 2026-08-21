// Patch script: update collectNotifications() + NOTIF vars with RBAC filtering
const fs = require('fs');
const filePath = 'c:/marwaguidara/summer/frontend/app.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace NOTIF_READ_KEY version
content = content.replace(
  /const NOTIF_READ_KEY = 'bakery_notif_read_v1';/,
  "const NOTIF_READ_KEY = 'bakery_notif_read_v2';"
);

// 2. Add __serverNotifications variable after __aiAnomalies
content = content.replace(
  /let __aiAnomalies = \[\];\nlet __notifRead/,
  "let __aiAnomalies = [];\nlet __serverNotifications = [];\nlet __notifRead"
);

// 3. Add 'rh' to NOTIF_CATEGORY_LABELS
content = content.replace(
  /  system: 'Syst\xc3\xa8me'\n\};/,
  "  system: 'Syst\xc3\xa8me',\n  rh: 'RH'\n};"
);

fs.writeFileSync(filePath, content);
console.log('Frontend notification vars updated');
