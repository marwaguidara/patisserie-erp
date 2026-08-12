// Sprint 5 P0 — deployment validation (static, runs without Docker daemon).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let failed = false;
function check(name, cond, detail) {
  console.log((cond ? '[OK]   ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
  if (!cond) failed = true;
}

const root = path.resolve(__dirname, '..', '..');
const composePath = path.join(root, 'infra', 'docker-compose.yml');

// 1. docker-compose.yml is valid YAML and declares the three services.
try {
  const doc = yaml.load(fs.readFileSync(composePath, 'utf8'));
  const services = Object.keys(doc.services || {});
  check('compose YAML parses', true, 'services: ' + services.join(', '));
  check('compose has postgres, backend, frontend',
    services.includes('postgres') && services.includes('backend') && services.includes('frontend'));
  // Frontend nginx proxies to the compose service name 'backend'
  const nginx = fs.readFileSync(path.join(root, 'frontend', 'nginx.conf'), 'utf8');
  check('nginx proxies /api/ to http://backend:5000', /proxy_pass\s+http:\/\/backend:5000;/.test(nginx));
  // Frontend Dockerfile copies the three static files it relies on
  const feDocker = fs.readFileSync(path.join(root, 'frontend', 'Dockerfile'), 'utf8');
  ['index.html', 'styles.css', 'app.js', 'nginx.conf'].forEach((f) => {
    check('frontend file exists: ' + f, fs.existsSync(path.join(root, 'frontend', f)));
    check('frontend Dockerfile copies: ' + f, feDocker.includes('COPY ' + f));
  });
  // Backend Dockerfile references files that exist
  const beDocker = fs.readFileSync(path.join(root, 'backend', 'Dockerfile'), 'utf8');
  ['package.json', 'package-lock.json', 'knexfile.js', 'src', 'migrations', 'seeds'].forEach((f) => {
    check('backend build file exists: ' + f, fs.existsSync(path.join(root, 'backend', f)));
    check('backend Dockerfile copies/uses: ' + f, beDocker.includes(f));
  });
  // .env.example exists and exposes JWT_SECRET + DATABASE vars
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  ['JWT_SECRET', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'].forEach((k) => {
    check('.env.example defines ' + k, envExample.includes(k + '='));
  });
  // compose must NOT contain a hardcoded JWT secret
  check('compose JWT_SECRET is env-based (no hardcoded value)',
    /\${JWT_SECRET:/.test(fs.readFileSync(composePath, 'utf8'))
    && !/JWT_SECRET:\s+[a-zA-Z0-9_]{8,}/.test(fs.readFileSync(composePath, 'utf8')));
} catch (e) {
  console.log('[FAIL] YAML parse error: ' + e.message);
  failed = true;
}

console.log(failed ? '\nVALIDATION: FAILED' : '\nVALIDATION: PASSED');
process.exit(failed ? 1 : 0);