process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const errorHandler = require('../src/middleware/errorHandler');
const asyncHandler = require('../src/utils/asyncHandler');
const {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalError
} = require('../src/utils/AppError');

describe('Centralized Error Handling Unit & Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Route 400 - ValidationError
    app.get('/test/400', asyncHandler(async (req, res) => {
      throw new ValidationError('Validation échouée sur les paramètres');
    }));

    // Route 401 - UnauthorizedError
    app.get('/test/401', asyncHandler(async (req, res) => {
      throw new UnauthorizedError('Token d\'accès absent');
    }));

    // Route 403 - ForbiddenError
    app.get('/test/403', asyncHandler(async (req, res) => {
      throw new ForbiddenError('Droits insuffisants');
    }));

    // Route 404 - NotFoundError
    app.get('/test/404', asyncHandler(async (req, res) => {
      throw new NotFoundError('Produit non trouvé');
    }));

    // Route 409 - ConflictError
    app.get('/test/409', asyncHandler(async (req, res) => {
      throw new ConflictError('Email déjà utilisé');
    }));

    // Route 500 - InternalError
    app.get('/test/500', asyncHandler(async (req, res) => {
      throw new InternalError('Erreur base de données');
    }));

    // Route avec erreur générique (non interceptée par AppError)
    app.get('/test/generic-error', asyncHandler(async (req, res) => {
      throw new Error('Erreur imprévue du système');
    }));

    // Attachement du middleware d'erreur global
    app.use(errorHandler);
  });

  test('1. ValidationError -> Status 400 & JSON Standard', async () => {
    const res = await request(app).get('/test/400');
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: 'Validation échouée sur les paramètres',
      code: 'VALIDATION_ERROR',
      error: 'Validation échouée sur les paramètres',
      timestamp: expect.any(String)
    });
  });

  test('2. UnauthorizedError -> Status 401 & JSON Standard', async () => {
    const res = await request(app).get('/test/401');
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body.success).toBe(false);
  });

  test('3. ForbiddenError -> Status 403 & JSON Standard', async () => {
    const res = await request(app).get('/test/403');
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.success).toBe(false);
  });

  test('4. NotFoundError -> Status 404 & JSON Standard', async () => {
    const res = await request(app).get('/test/404');
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.success).toBe(false);
  });

  test('5. ConflictError -> Status 409 & JSON Standard', async () => {
    const res = await request(app).get('/test/409');
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.success).toBe(false);
  });

  test('6. InternalError -> Status 500 & JSON Standard', async () => {
    const res = await request(app).get('/test/500');
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body.success).toBe(false);
  });

  test('7. Generic Error -> Status 500 & Fallback JSON Standard', async () => {
    const res = await request(app).get('/test/generic-error');
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe('Erreur imprévue du système');
    expect(res.body.success).toBe(false);
  });
});
