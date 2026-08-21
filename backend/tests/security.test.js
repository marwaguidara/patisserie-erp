process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { helmetMiddleware, corsOptions } = require('../src/middleware/security');

describe('Security Middlewares & Headers Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(helmetMiddleware);
    app.use(corsOptions);

    // Endpoint public de test
    app.get('/test/public', (req, res) => {
      res.json({ message: 'public ok' });
    });

    // Endpoint de test avec Rate Limiting court (3 requêtes max)
    const testRateLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        success: false,
        message: 'Trop de requêtes vers l\'API. Veuillez réessayer ultérieurement.',
        code: 'TOO_MANY_REQUESTS',
        error: 'Too many requests'
      }
    });

    app.get('/test/rate-limited', testRateLimiter, (req, res) => {
      res.json({ message: 'rate limited endpoint ok' });
    });
  });

  describe('1. En-têtes de Sécurité Helmet & HTTP', () => {
    test('Suppression de l\'en-tête X-Powered-By', async () => {
      const res = await request(app).get('/test/public');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    test('Protection Sniffing MIME (X-Content-Type-Options: nosniff)', async () => {
      const res = await request(app).get('/test/public');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('Protection Clickjacking (X-Frame-Options: SAMEORIGIN)', async () => {
      const res = await request(app).get('/test/public');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    test('Protection XSS Filter (X-XSS-Protection)', async () => {
      const res = await request(app).get('/test/public');
      expect(res.headers['x-xss-protection']).toBe('0');
    });
  });

  describe('2. Configuration CORS', () => {
    test('En-têtes CORS présents pour les requêtes autorisées', async () => {
      const res = await request(app)
        .get('/test/public')
        .set('Origin', 'http://localhost:3000');

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('3. Express Rate Limiter', () => {
    test('Autorise les requêtes en dessous du seuil et bloque avec HTTP 429 au dépassement', async () => {
      // 3 requêtes autorisées
      await request(app).get('/test/rate-limited').expect(200);
      await request(app).get('/test/rate-limited').expect(200);
      await request(app).get('/test/rate-limited').expect(200);

      // 4ème requête dépasse le quota -> 429 Too Many Requests
      const res = await request(app).get('/test/rate-limited');
      expect(res.statusCode).toBe(429);
      expect(res.body).toEqual({
        success: false,
        message: 'Trop de requêtes vers l\'API. Veuillez réessayer ultérieurement.',
        code: 'TOO_MANY_REQUESTS',
        error: 'Too many requests'
      });
    });
  });
});
