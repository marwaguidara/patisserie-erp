// Quick fix script for auth.js escaping issue
const fs = require('fs');
const filePath = 'c:/marwaguidara/summer/backend/src/middleware/auth.js';
let content = fs.readFileSync(filePath, 'utf8');
// Replace the broken string with a clean double-quoted version
content = content.replace(
  /'Accès refusé : vous ne pouvez accéder qu.*à vos propres données\.'/,
  "\"Accès refusé : vous ne pouvez accéder qu'à vos propres données.\""
);
fs.writeFileSync(filePath, content);
console.log('auth.js encoding fixed');
