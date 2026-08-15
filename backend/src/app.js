const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const ingredientsRouter = require('./routes/ingredients');
const categoriesRouter = require('./routes/categories');
const salesRouter = require('./routes/sales');
const employeesRouter = require('./routes/employees');
const suppliersRouter = require('./routes/suppliers');
const purchaseOrdersRouter = require('./routes/purchaseOrders');
const customerOrdersRouter = require('./routes/customerOrders');
const analyticsRouter = require('./routes/analytics');

const app = express();

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../../frontend')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'UP',
    timestamp: new Date().toISOString(),
    service: 'Bakery Management Platform Central API',
    walking_skeleton: true,
    sprint1: true
  });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/stocks', ingredientsRouter); // Stock alias
app.use('/api/categories', categoriesRouter);
app.use('/api/sales', salesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/customer-orders', customerOrdersRouter);
app.use('/api/analytics', analyticsRouter);

const { requireAuth, requireRole } = require('./middleware/auth');

// --- AI service reverse proxy with RBAC protection ---
// In Docker the frontend container's nginx proxies "/ai/*" -> http://ai-service:8000/*.
// Locally the backend serves the static frontend, so Express mirrors that mapping here.
// The browser only ever calls the same-origin "/ai/..." path — it never learns the AI
// host/port. Override with AI_PROXY_HOST / AI_PROXY_PORT if the AI service is elsewhere.
const AI_PROXY_TARGET = {
  host: process.env.AI_PROXY_HOST || '127.0.0.1',
  port: Number(process.env.AI_PROXY_PORT || 8000)
};

function proxyToAiService(req, res) {
  const proxyReq = http.request({
    host: AI_PROXY_TARGET.host,
    port: AI_PROXY_TARGET.port,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `${AI_PROXY_TARGET.host}:${AI_PROXY_TARGET.port}` }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[ai-proxy] upstream error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AI service unreachable', status: 502 }));
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

const aiRouter = express.Router();

// Require authentication for all AI endpoints
aiRouter.use(requireAuth);

// Health check endpoint
aiRouter.get('/health', proxyToAiService);

// Sprint 1 Active AI Endpoint: /forecast
// Allowed roles: ADMIN (Administrateur/Gérant), PRODUCTION (Responsable production), STOCK (Responsable stock/achats)
// Forbidden roles (403): CASHIER (Vendeur/Caissier), EMPLOYEE (Employé)
aiRouter.get('/forecast', requireRole(['ADMIN', 'PRODUCTION', 'STOCK']), proxyToAiService);

// ETL run endpoint - restricted to ADMIN
aiRouter.post('/etl/run', requireRole(['ADMIN']), proxyToAiService);

// Sprint 1 (pre-dev): Production Recommendations protection — same RBAC mechanism as /forecast.
// Business logic still returns 501 from the AI service; only the security layer is active here.
// Allowed roles: ADMIN (Gérant), PRODUCTION (Responsable production).
// Forbidden roles (403): STOCK (own endpoint in Sprint 3), CASHIER, EMPLOYEE.
aiRouter.get('/production-recommendations', requireRole(['ADMIN', 'PRODUCTION']), proxyToAiService);

// Sprint 3: Anomalies protection — same RBAC mechanism as /forecast & /production-recommendations.
// /anomalies is stock-oriented (anomalies de stock) => allowed: ADMIN (Gérant), STOCK (Responsable stock/achats).
// Forbidden (403): PRODUCTION (pas dans son périmètre), CASHIER (Vendeur/Caissier), EMPLOYEE (Employé).
// Business logic still returns 501 from the AI service; only the security layer is active here.
aiRouter.get('/anomalies', requireRole(['ADMIN', 'STOCK']), proxyToAiService);

// Fallback proxy for all other /ai routes (requires auth)
aiRouter.use(proxyToAiService);

app.use('/ai', aiRouter);

// 404 JSON Fallback Middleware for unmatched API routes
app.use((req, res) => {
  res.status(404).json({
    error: `Endpoint '${req.method} ${req.originalUrl}' not found`,
    status: 404
  });
});

// Central Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    path: req.originalUrl
  });
});

module.exports = app;
