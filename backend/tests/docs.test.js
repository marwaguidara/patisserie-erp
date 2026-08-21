process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/connection');

/**
 * Swagger UI documentation endpoints (GET /docs, GET /docs/openapi.yaml).
 *
 * Purely additive integration: proves the docs are served, that the OpenAPI
 * document loads with every documented path present, and that no existing
 * endpoint behaviour changed (health still 200, unknown API route still 404).
 */
describe('GET /docs — Swagger UI', () => {
  afterAll(async () => {
    await db.destroy();
  });

  test('/docs sert la page Swagger UI (200 + assets référencés)', async () => {
    const res = await request(app).get('/docs');

    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('text/html');
    // Les assets doivent être référencés en chemins ABSOLUS sous /docs/ :
    // le template de swagger-ui-express utilise des chemins relatifs ("./x")
    // qui, servis depuis /docs sans slash final, se résolvent à la racine du
    // domaine (/swagger-ui.css) et renvoient 404 dans le navigateur.
    expect(res.text).toContain('/docs/swagger-ui.css');
    expect(res.text).toContain('/docs/swagger-ui-bundle.js');
    expect(res.text).toContain('/docs/swagger-ui-init.js');
    expect(res.text).not.toContain('href="./');
    expect(res.text).not.toContain('src="./');

    // Chaque asset référencé doit répondre 200.
    const css = await request(app).get('/docs/swagger-ui.css');
    expect(css.statusCode).toEqual(200);
    expect(css.headers['content-type']).toContain('text/css');

    const bundle = await request(app).get('/docs/swagger-ui-bundle.js');
    expect(bundle.statusCode).toEqual(200);

    const initJs = await request(app).get('/docs/swagger-ui-init.js');
    expect(initJs.statusCode).toEqual(200);
  });

  test('/docs/openapi.yaml sert la spécification OpenAPI 3.1 brute', async () => {
    const res = await request(app).get('/docs/openapi.yaml');

    expect(res.statusCode).toEqual(200);
    expect(res.headers['content-type']).toContain('yaml');
    expect(res.text.startsWith('openapi:')).toBe(true);
    expect(res.text).toContain('3.1.0');
    // Un échantillon de chemins documentés doit être présent.
    expect(res.text).toContain('/api/auth/login');
    expect(res.text).toContain('/api/products/{id}/produce');
    expect(res.text).toContain('/ai/forecast');
  });

  test('/docs/swagger.json expose les paths parsés', async () => {
    const res = await request(app).get('/docs/swagger.json');

    expect(res.statusCode).toEqual(200);
    expect(res.body.openapi).toEqual('3.1.0');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(50);
    expect(res.body.paths['/api/sales']).toBeDefined();
    expect(res.body.components.schemas.Sale).toBeDefined();
  });

  test("aucune régression : /api/health reste public et l'API inconnue renvoie 404", async () => {
    const health = await request(app).get('/api/health');
    expect(health.statusCode).toEqual(200);
    expect(health.body.status).toEqual('UP');

    const missing = await request(app).get('/api/does-not-exist');
    expect(missing.statusCode).toEqual(404);
  });
});
