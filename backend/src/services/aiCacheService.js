const http = require('http');

const AI_PROXY_TARGET = {
  host: process.env.AI_PROXY_HOST || '127.0.0.1',
  port: Number(process.env.AI_PROXY_PORT || 8000)
};

/**
 * Invalidate AI forecast cache for one or more products after a sale is recorded.
 * Failures are logged but do not block the sale transaction.
 */
async function invalidateForecastCache(productIds) {
  const ids = [...new Set((productIds || []).filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) {
    return;
  }

  await Promise.all(ids.map((productId) => new Promise((resolve) => {
    const req = http.request({
      host: AI_PROXY_TARGET.host,
      port: AI_PROXY_TARGET.port,
      path: `/cache/invalidate?product_id=${productId}`,
      method: 'POST',
      timeout: 3000
    }, (res) => {
      res.resume();
      res.on('end', resolve);
    });

    req.on('error', (err) => {
      console.warn(`[ai-cache] invalidate failed for product_id=${productId}:`, err.message);
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn(`[ai-cache] invalidate timed out for product_id=${productId}`);
      resolve();
    });

    req.end();
  })));
}

/**
 * Invalidate ALL AI caches (forecast + production recommendations) for every product.
 * Used when a supplier order is received (raw-material restock can affect recommendations).
 * Failures are logged but do not block the order flow.
 */
async function invalidateAllAiCaches() {
  await new Promise((resolve) => {
    const req = http.request({
      host: AI_PROXY_TARGET.host,
      port: AI_PROXY_TARGET.port,
      path: `/cache/invalidate`,
      method: 'POST',
      timeout: 3000
    }, (res) => {
      res.resume();
      res.on('end', resolve);
    });

    req.on('error', (err) => {
      console.warn('[ai-cache] invalidate-all failed:', err.message);
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn('[ai-cache] invalidate-all timed out');
      resolve();
    });

    req.end();
  });
}

module.exports = { invalidateForecastCache, invalidateAllAiCaches };
