// Sprint 5 — Deployment validation (static analysis; no Docker/nginx/Postgres daemon required).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

let failed = false;
const passed = [];
const issues = [];
function ok(name, detail) { passed.push(`[OK]   ${name}${detail ? ' — ' + detail : ''}`); }
function bad(name, detail) { issues.push(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`); failed = true; }
function warn(name, detail) { issues.push(`[WARN] ${name}${detail ? ' — ' + detail : ''}`); }

const root = path.resolve(__dirname, '..', '..');
const composePath = path.join(root, 'infra', 'docker-compose.yml');
const envExamplePath = path.join(root, '.env.example');
const beDockerPath = path.join(root, 'backend', 'Dockerfile');
const feDockerPath = path.join(root, 'frontend', 'Dockerfile');
const nginxPath = path.join(root, 'frontend', 'nginx.conf');

// ---------- Compose: parse + env interpolation simulation ----------
let compose = null;
try {
  compose = yaml.load(fs.readFileSync(composePath, 'utf8'));
  ok('docker-compose.yml', 'valid YAML, ' + Object.keys(compose.services).length + ' services');
} catch (e) {
  bad('docker-compose.yml', 'YAML error: ' + e.message);
}

const envExampleText = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf8') : '';
const envKeys = new Set((envExampleText.match(/^([A-Z0-9_]+)=/gm) || []).map((m) => m.replace('=', '')));

if (compose) {
  const yamlText = fs.readFileSync(composePath, 'utf8');
  // Required (no default) references must be declared in .env.example
  [...yamlText.matchAll(/\$\{([A-Z0-9_]+):\?/g)].forEach((m) => {
    if (!envKeys.has(m[1])) bad('env-var', `required ${m[1]} in compose is NOT declared in .env.example`);
  });
  [...yamlText.matchAll(/\$\{([A-Z0-9_]+):-(.*?)\}/g)].forEach((m) => ok('env-var', `${m[1]} has default in compose`));

  for (const svc of Object.keys(compose.services)) {
    const s = compose.services[svc];
    ok('compose service', svc + (s.build ? ' (build ' + s.build.context + '/' + s.build.dockerfile + ')' : (s.image ? ' (image ' + s.image + ')' : '')));
    if (s.build) {
      const df = path.join(path.resolve(path.dirname(composePath), s.build.context), s.build.dockerfile || 'Dockerfile');
      if (!fs.existsSync(df)) bad('compose service ' + svc, 'Dockerfile not found at ' + path.relative(root, df));
      else ok('compose build', svc + ' Dockerfile resolves: ' + path.relative(root, df));
    }
    if (s.healthcheck) ok('compose healthcheck', svc + ' defined');
    else warn('compose healthcheck', svc + ' has no healthcheck');
  }
  const backend = compose.services.backend || {};
  if (backend.depends_on && backend.depends_on.postgres && backend.depends_on.postgres.condition === 'service_healthy') {
    ok('compose dependency', 'backend waits for postgres: service_healthy');
  } else {
    bad('compose dependency', 'backend does not wait for postgres healthy');
  }

// ---------- Backend Dockerfile ----------
if (fs.existsSync(beDockerPath)) {
  const be = fs.readFileSync(beDockerPath, 'utf8');
  ok('backend/Dockerfile', 'exists, ' + be.split('\n').length + ' lines');
  ['package.json', 'package-lock.json', 'knexfile.js', 'src', 'migrations', 'seeds'].forEach((f) => {
    if (!fs.existsSync(path.join(root, 'backend', f))) bad('backend/Dockerfile', 'references missing file: ' + f);
    else ok('backend/Dockerfile copy', f);
  });
  if (!/npm ci --omit=dev/.test(be)) warn('backend/Dockerfile', 'does not use npm ci --omit=dev');
  if (!/knex migrate:latest/.test(be) || !/node src\/server\.js/.test(be)) bad('backend/Dockerfile', 'CMD must run migrations and start server');
  else ok('backend/Dockerfile CMD', 'migrate + seed + node src/server.js');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package.json'), 'utf8'));
  if (pkg.dependencies && pkg.dependencies.knex) ok('backend deps', 'knex is a runtime dependency');
  else bad('backend deps', 'knex NOT a runtime dependency (npx knex fails in prod image)');
} else {
  bad('backend/Dockerfile', 'missing');
}

// ---------- Frontend Dockerfile ----------
if (fs.existsSync(feDockerPath)) {
  const fe = fs.readFileSync(feDockerPath, 'utf8');
  ok('frontend/Dockerfile', 'exists, ' + fe.split('\n').length + ' lines');
  ['index.html', 'styles.css', 'app.js', 'nginx.conf'].forEach((f) => {
    if (!fs.existsSync(path.join(root, 'frontend', f))) bad('frontend/Dockerfile', 'references missing file: ' + f);
    else ok('frontend/Dockerfile copy', f);
  });
} else {
  bad('frontend/Dockerfile', 'missing');
}

// ---------- nginx.conf ----------
if (fs.existsSync(nginxPath)) {
  const nx = fs.readFileSync(nginxPath, 'utf8');
  ok('frontend/nginx.conf', 'exists');
  const checks = {
    'listen 80': /listen\s+80\b/.test(nx),
    'root directive': /root\s+\/usr\/share\/nginx\/html/.test(nx),
    '/api proxy': /location\s+\/api\//.test(nx),
    'proxy_pass to backend:5000': /proxy_pass\s+http:\/\/backend:5000;/.test(nx),
    'SPA fallback': /try_files/.test(nx)
  };
  Object.entries(checks).forEach(([k, v]) => v ? ok('nginx', k) : bad('nginx', k));
  if (compose && compose.services && !compose.services['backend']) bad('nginx', 'proxy target "backend" is not a compose service');
  else ok('nginx', 'proxy target "backend" matches a compose service');
} else {
  bad('frontend/nginx.conf', 'missing');
}

// ---------- .env.example ----------
ok('.env.example', fs.existsSync(envExamplePath) ? 'exists' : 'missing');
if (envExampleText && !envKeys.has('JWT_SECRET')) bad('.env.example', 'JWT_SECRET missing');
else if (envKeys.has('JWT_SECRET')) ok('.env.example', 'JWT_SECRET declared');

console.log(passed.join('\n'));
console.log('\n--- ' + (failed ? 'Issues:' : 'No blocking issues found') + ' ---');
issues.forEach((i) => console.log(i));
console.log(failed ? '\nDEPLOYMENT STATIC VALIDATION: FAILED' : '\nDEPLOYMENT STATIC VALIDATION: PASSED');
process.exit(failed ? 1 : 0);
}