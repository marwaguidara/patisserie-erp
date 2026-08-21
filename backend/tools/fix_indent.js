const fs = require('fs');
const p = 'c:/marwaguidara/summer/frontend/app.js';
let c = fs.readFileSync(p, 'utf8');
// Fix the indentation on the dashboard line
c = c.replace('      if (tabName === \'dashboard\' && hasAnyRole(\'ADMIN\')) {',
              '  if (tabName === \'dashboard\' && hasAnyRole(\'ADMIN\')) {');
fs.writeFileSync(p, c);
console.log('Fixed dashboard indent');

// Verify syntax
const { execSync } = require('child_process');
try {
  execSync('node --check c:/marwaguidara/summer/frontend/app.js', { stdio: 'pipe' });
  console.log('Syntax OK');
} catch (e) {
  console.error('Syntax error:', e.stderr.toString());
}
