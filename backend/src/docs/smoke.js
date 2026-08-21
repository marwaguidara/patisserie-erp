/**
 * Smoke check for the Swagger UI integration (not part of the Jest suite).
 * Run: node src/docs/smoke.js
 */
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = 'true';

const request = require('supertest');
const app = require('../app');

(async () => {
  let failed = false;

  const ui = await request(app).get('/docs');
  console.log(`GET /docs                -> ${ui.statusCode} (${ui.headers['content-type']})`);
  const initJs = await request(app).get('/docs/swagger-ui-init.js');
  const htmlOk =
    ui.statusCode === 200 &&
    /swagger-ui\.css/.test(ui.text) &&
    /swagger-ui-init\.js/.test(ui.text);
  // swagger-ui-express v5 injects the spec through swagger-ui-init.js
  const specEmbedded =
    initJs.statusCode === 200 &&
    initJs.text.includes('"/api/auth/login"') &&
    initJs.text.includes('"openapi": "3.1.0"');
  console.log('  Swagger UI page            :', htmlOk ? 'OK' : 'KO');
  console.log('  OpenAPI charge (init.js)   :', specEmbedded ? 'OK' : 'KO');
  if (!htmlOk || !specEmbedded) failed = true;

  const yaml = await request(app).get('/docs/openapi.yaml');
  console.log(`GET /docs/openapi.yaml   -> ${yaml.statusCode} (${yaml.headers['content-type']})`);
  const yamlOk =
    yaml.statusCode === 200 &&
    yaml.text.startsWith('openapi:') &&
    yaml.text.includes('/api/auth/login');
  console.log('  YAML brut valide           :', yamlOk ? 'OK' : 'KO');
  if (!yamlOk) failed = true;

  const json = await request(app).get('/docs/swagger.json');
  console.log(`GET /docs/swagger.json   -> ${json.statusCode}`);
  const jsonOk = json.statusCode === 200 && json.body.paths && Object.keys(json.body.paths).length > 0;
  console.log('  JSON paths                 :', jsonOk ? `OK (${Object.keys(json.body.paths).length} chemins)` : 'KO');
  if (!jsonOk) failed = true;

  // Existing endpoints must be unaffected.
  const health = await request(app).get('/api/health');
  console.log(`GET /api/health          -> ${health.statusCode}`, health.ok ? '(non affecté)' : 'KO');
  if (!health.ok) failed = true;

  // Unknown API route must still return the JSON 404 fallback.
  const missing = await request(app).get('/api/does-not-exist');
  console.log(`GET /api/does-not-exist  -> ${missing.statusCode} (404 attendu)`);
  if (missing.statusCode !== 404) failed = true;

  console.log(failed ? '\nSMOKE: KO' : '\nSMOKE: OK');
  process.exit(failed ? 1 : 0);
})();
