const express = require('express');
const cors = require('cors');
const path = require('path');

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
