const http = require('http');
const SalesService = require('./salesService');
const StockService = require('./stockService');

/**
 * Sprint 5 — ADMIN consolidated dashboard service.
 *
 * CONSTRAINT 1 (KPIs core)     : read directly from existing core services — never recomputed.
 *   - revenue              ← SalesService.getSalesMetrics()  (month.total_revenue)
 *   - critical_stock_count ← StockService.getAlerts()        (low_stock_count)
 *   - top_products         ← SalesService.getSalesMetrics()  (top_products)
 *
 * CONSTRAINT 2 (IA outputs)     : fetched from already-existing /ai/* endpoints via the
 *   same reverse-proxy mapping used elsewhere (AI_PROXY_HOST / AI_PROXY_PORT). They are
 *   summaries only — no business logic is recomputed downstream either.
 *
 * CONSTRAINT 3 (cache)          : short TTL (5 min) using an in-memory Map keyed by the
 *   requesting tenant (admin). No invalidation needed for this sprint.
 */
const AI_PROXY_HOST = process.env.AI_PROXY_HOST || '127.0.0.1';
const AI_PROXY_PORT = Number(process.env.AI_PROXY_PORT || 8000);
const AI_PROXY_PROTOCOL = process.env.AI_PROXY_PROTOCOL || 'http';

// 5-minute short TTL cache for the expensive consolidated snapshot.
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

class DashboardService {
  static async _fetchAi(path) {
    const url = `${AI_PROXY_PROTOCOL}://${AI_PROXY_HOST}:${AI_PROXY_PORT}${path}`;
    try {
      const body = await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
            catch (e) { reject(new Error(`AI service JSON parse: ${e.message}`)); }
          });
        });
        req.on('error', reject);
        req.setTimeout(3000, () => { req.destroy(new Error('AI service timeout')); });
      });
      if (body.status >= 200 && body.status < 300) return body.json;
      console.warn(`[dashboard:ai] ${path} -> ${body.status}; using fallback`);
      return null;
    } catch (err) {
      console.warn(`[dashboard:ai] ${path} unreachable: ${err.message}; using fallback`);
      return null;
    }
  }

  /**
   * Compose the admin dashboard summary: KPIs core (source of truth = core services)
   * + IA summaries (source of truth = existing /ai endpoints).
   * No KPI computation/revenue recalculation occurs here — we pass through the
   * values already produced by SalesService / StockService.
   */
  static async getSummary() {
    const now = Date.now();
    const cached = _cache.get('admin');
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return { ...cached.payload, cached: true };
    }

    // --- KPIs CORE : read from existing services (never recomputed) ---
    const [metrics, alerts] = await Promise.all([
      SalesService.getSalesMetrics().catch((e) => {
        console.error('[dashboard:kpi] sales metrics failed:', e.message);
        return { day: { total_revenue: 0 }, week: { total_revenue: 0 }, month: { total_revenue: 0 }, top_products: [] };
      }),
      StockService.getAlerts().catch((e) => {
        console.error('[dashboard:kpi] stock alerts failed:', e.message);
        return { low_stock_count: 0, expiring_soon_count: 0, low_stock_items: [], expiring_soon_items: [] };
      }),
    ]);

    // --- IA summaries : fetched from already-existing /ai endpoints ---
    const [forecast, anomalies, segmentation] = await Promise.all([
      this._fetchAi('/forecast?product_id=32&horizon_days=7'),
      this._fetchAi('/anomalies'),
      this._fetchAi('/segmentation'),
    ]);

    // Build top_products in the contract shape (product_id / name / units_sold)
    const top_products = (metrics.top_products || []).map((p) => ({
      product_id: p.id,
      name: p.name,
      units_sold: p.total_sold ? parseInt(p.total_sold, 10) : 0,
    }));

    // Forecast summary : surface only what the UI shows (next step + horizon), no recalculation.
    const forecast_summary = forecast ? {
      product_id: forecast.product_id || 32,
      product_name: forecast.product_name || forecast.product || 'Produit 32',
      horizon_days: forecast.horizon_days || 7,
      forecast_next: Array.isArray(forecast.next_7_days) && forecast.next_7_days.length > 0
        ? parseFloat(forecast.next_7_days[0]) : 0,
      status: forecast.status || 'ok',
    } : { product_id: 32, horizon_days: 7, forecast_next: 0, status: 'unavailable' };

    // Anomalies summary : count ONLY (never recomputed detection).
    const active_anomalies_count = Array.isArray(anomalies?.anomalies) ? anomalies.anomalies.length : 0;

    // Segmentation summary : count segments (never recomputed).
    const segmentation_summary = segmentation ? {
      segments_count: Array.isArray(segmentation.segments) ? segmentation.segments.length : 0,
      segments: segmentation.segments || [],
    } : { segments_count: 0, segments: [] };

    const payload = {
      kpis: {
        revenue: parseFloat(metrics.month.total_revenue) || 0,
        critical_stock_count: alerts.low_stock_count || 0,
        top_products,
      },
      forecast_summary,
      active_anomalies_count,
      segmentation_summary,
      status: 'ok',
    };

    _cache.set('admin', { ts: now, payload });
    return { ...payload, cached: false };
  }

  static _clearCache() {
    _cache.clear();
  }
}

module.exports = DashboardService;
