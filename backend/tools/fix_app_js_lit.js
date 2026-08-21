const fs = require('fs');
const p = 'c:/marwaguidara/summer/frontend/app.js';
let c = fs.readFileSync(p, 'utf8');
// Replace literal \nfunction notifUnreadCount with newline + function notifUnreadCount
const literalBSN = '\\' + 'n' + 'function notifUnreadCount';
c = c.replace(literalBSN, '\nfunction notifUnreadCount');
fs.writeFileSync(p, c);
console.log('Fixed literal backslash-n');
