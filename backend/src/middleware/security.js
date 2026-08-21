const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Helper pour vérifier si le rate limiting doit être désactivé (ex: pendant les tests unitaires)
const isTestEnv = process.env.NODE_ENV === 'test';

// Fenêtre temporelle configurable (défaut : 15 minutes en millisecondes)
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);

/**
 * 1. Rate Limiter pour les routes d'Authentification (/api/auth)
 * Limite : 100 requêtes / 15 min
 */
const authRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.AUTH_RATE_LIMIT || 100),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv || process.env.DISABLE_RATE_LIMIT === 'true',
  message: {
    success: false,
    message: 'Trop de tentatives de connexion/authentification. Veuillez réessayer dans 15 minutes.',
    code: 'TOO_MANY_REQUESTS',
    error: 'Too many requests'
  }
});

/**
 * 2. Rate Limiter pour les routes du service IA (/ai)
 * Limite : 200 requêtes / 15 min
 */
const aiRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.AI_RATE_LIMIT || 200),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv || process.env.DISABLE_RATE_LIMIT === 'true',
  message: {
    success: false,
    message: 'Quota de requêtes IA dépassé. Veuillez réessayer dans 15 minutes.',
    code: 'TOO_MANY_REQUESTS',
    error: 'Too many requests'
  }
});

/**
 * 3. Rate Limiter pour les routes publiques et l'API générale (/api)
 * Limite : 500 requêtes / 15 min
 */
const publicRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: Number(process.env.PUBLIC_RATE_LIMIT || 500),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTestEnv || process.env.DISABLE_RATE_LIMIT === 'true',
  message: {
    success: false,
    message: 'Trop de requêtes vers l\'API. Veuillez réessayer ultérieurement.',
    code: 'TOO_MANY_REQUESTS',
    error: 'Too many requests'
  }
});

/**
 * Configuration Helmet (Protection XSS, Clickjacking, Sniffing MIME)
 * Préserve la compatibilité avec Swagger UI et le frontend React
 */
const helmetMiddleware = helmet({
  contentSecurityPolicy: false, // Préserve les scripts inline & styles de Swagger UI et React
  crossOriginEmbedderPolicy: false,
  xFrameOptions: { action: 'sameorigin' }, // Protection contre le clickjacking
  xContentTypeOptions: true, // Protection contre le sniffing MIME (X-Content-Type-Options: nosniff)
  xXssProtection: true // Protection XSS legacy browser filter
});

/**
 * Configuration CORS sécurisée
 */
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
      : ['*'];

    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origine CORS '${origin}' non autorisée.`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
};

module.exports = {
  helmetMiddleware,
  corsOptions: cors(corsOptions),
  authRateLimiter,
  aiRateLimiter,
  publicRateLimiter
};
