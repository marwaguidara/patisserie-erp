/**
 * Swagger UI documentation endpoints.
 *
 * Serves the OpenAPI 3.1 specification located at <repo>/docs/openapi.yaml
 * (single source of truth, shared with the AI service and the CI checks).
 *
 * Mounted routes:
 *   GET /docs                -> Swagger UI (interactive explorer)
 *   GET /docs/openapi.yaml   -> raw OpenAPI YAML document
 *   GET /docs/swagger.json   -> same document converted to JSON
 *
 * This module is purely additive: it registers no business route and does not
 * touch any existing endpoint, middleware or validation logic.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

// Candidate locations for docs/openapi.yaml:
//  - repo root (local dev + tests): backend/src/docs -> ../../../docs
//  - explicit override via SWAGGER_SPEC_PATH (Docker / custom layouts)
const candidates = [
  process.env.SWAGGER_SPEC_PATH,
  path.join(__dirname, '../../../docs/openapi.yaml'),
  path.join(process.cwd(), 'docs/openapi.yaml'),
].filter(Boolean);

function resolveSpecPath() {
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function loadDocument() {
  const specPath = resolveSpecPath();
  if (!specPath) {
    // Never crash the API because the spec file is absent (e.g. slim Docker
    // image that does not ship the docs/ folder): serve an empty document.
    console.warn(
      '[swagger] openapi.yaml introuvable — Swagger UI sera vide. ' +
        `Chemins testés : ${candidates.join(', ')}`
    );
    return {
      openapi: '3.1.0',
      info: { title: 'Bakery Platform API', version: '1.0.0' },
      paths: {},
    };
  }
  const doc = YAML.load(specPath);
  if (!doc || !doc.paths) {
    throw new Error(`[swagger] Spec invalide ou sans section paths : ${specPath}`);
  }
  console.log(`[swagger] Spécification chargée : ${specPath}`);
  return doc;
}

const openapiDocument = loadDocument();
const specPath = resolveSpecPath();
const router = express.Router();

// Raw OpenAPI document (YAML) — served straight from disk.
router.get('/openapi.yaml', (req, res) => {
  res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(specPath);
});

// Same document as JSON (handy for Postman / code generators).
router.get('/swagger.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(openapiDocument);
});

// Interactive Swagger UI on GET /docs.
//
// swagger-ui-express emits asset references with RELATIVE paths
// ("./swagger-ui.css", "./swagger-ui-init.js", ...). Served at /docs WITHOUT a
// trailing slash, the browser resolves them against the domain root
// (/swagger-ui.css) and gets a 404. We therefore generate the page once and
// rewrite those references to absolute /docs/ paths.
// Explicit root handler first — avoids the 301 trailing-slash redirect that
// swaggerUi.serve / express.static would otherwise issue for /docs.
const setupOptions = {
  customSiteTitle: 'Bakery Platform API — Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
  displayRequestDuration: true,
};

const docsHtml = swaggerUi
  .generateHTML(openapiDocument, setupOptions)
  .replace(/(href|src)="\.\/([^"]*)"/g, '$1="/docs/$2"');

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(docsHtml);
});
// Static assets of Swagger UI (swagger-ui-bundle.js, css, init.js, favicons).
router.use('/', swaggerUi.serve);

module.exports = router;
module.exports.openapiDocument = openapiDocument;
