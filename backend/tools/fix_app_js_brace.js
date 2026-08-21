const fs = require('fs');
const p = 'c:/marwaguidara/summer/frontend/app.js';
let c = fs.readFileSync(p, 'utf8');
// Add missing closing brace for collectNotifications
c = c.replace(
  '  return list;\n\nfunction notifUnreadCount() {',
  '  return list;\n}\n\nfunction notifUnreadCount() {'
);
// Also handle \r\n line endings
c = c.replace(
  '  return list;\r\n\r\nfunction notifUnreadCount() {',
  '  return list;\r\n}\r\n\r\nfunction notifUnreadCount() {'
);
fs.writeFileSync(p, c);
console.log('Added missing closing brace');
