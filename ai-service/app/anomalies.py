"""
Anomaly detection for the `/ai/anomalies` endpoint (Sprint 3, Prompt 2).

Scope is deliberately narrow — ONLY the two anomaly families below are
considered, nothing else.

1. `sales_drop`
   A simple statistical rule: the most recent day's `units_sold` is flagged
   when it falls below (moving_average - k * stddev) of the preceding 7 days.
   NO complex ML (Isolation Forest / autoencoders) — the dataset is too small
   (a few dozen points per product) for those to be meaningful.

   Products with fewer than `MIN_HISTORY_DAYS` (14) sale rows have NO
   statistical baseline -> they are listed in `excluded_products` (variation on
   a near-empty series is absence of evidence, not an anomaly) and are never
   flagged. This mirrors the `insufficient_data` rule in `forecasting.py`.

2. `stock_discrepancy`
   DEFERRED. A single targeted grep of `backend/src` for
   `inventory | stock_discrepancy | theoretical_stock | discrepancy` found NO
   endpoint or service exposing a real-vs-theoretical stock comparison — the
   only hit was a *write* comment in `stockService.js` ("Reduce finished
   product inventory when a sale is completed"). The AI service is forbidden
   from *recomputing* stock metrics from raw movements (consume existing
   endpoints only), so until a real-inventory endpoint exists, no
   `stock_discrepancy` anomalies are emitted. This is reported (not invented)
   and deferred.

Contracts:
  - Input : a sales-history DataFrame (product_id, sale_date, units_sold, revenue)
            exactly as produced by `app.etl.build_sales_history_dataset()`, which
            itself consumes `app.db.fetch_product_aggregates()` — i.e. we consume
            the backend's already-aggregated sales, never re-aggregate from raw
            movements.
  - Output: the JSON contract documented in Prompt 2.
"""
from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd

from app.cache import get_cached_result, set_cached_result, invalidate_cache
from app.etl import build_sales_history_dataset

ENDPOINT = "anomalies"
PERIOD = "all"                 # one aggregate report over the full sales history
CACHE_TTL_SECONDS = 3600       # ~1h - anomaly reports are batched, no real-time invalidation needed

# Minimum history required to establish a statistical baseline.
# Mirrors forecasting.py's insufficient_data rule (< 14 days -> no forecast).
MIN_HISTORY_DAYS = 14
MOVING_WINDOW = 7              # days of the moving average used as the baseline
Z_THRESHOLD = 2.0             # flag a drop beyond mean - 2*std (simple std-dev threshold)


def detect_sales_drop_anomalies(df: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Flag the most recent day whose `units_sold` is a sharp drop versus the
    moving average of the preceding `MOVING_WINDOW` days.

    Two-tier threshold (per Prompt 2: "ecart-type par rapport a la moyenne
    mobile - PAS de methode complexe"):
      * std > 0 : drop if  last < mean_ref - Z_THRESHOLD * std_ref
      * std == 0 : constant history - drop if  last < mean_ref * 0.5
        (avoids spurious 1-unit noise on a perfectly flat series while still
        catching a genuine production halt, e.g. 30 -> 0).

    Severity/confidence are derived from the *magnitude* of the relative drop
    (drop_pct = (mean_ref - last) / mean_ref), which is auditable and simple.
    """
    if df is None or df.empty:
        return []

    g = df.copy()
    g["units_sold"] = pd.to_numeric(g["units_sold"], errors="coerce").fillna(0.0)

    anomalies: list[dict[str, Any]] = []
    for product_id, grp in g.groupby("product_id"):
        grp = grp.sort_values("sale_date")
        units = grp["units_sold"].astype(float).tolist()

        # Need a baseline window that excludes the last day.
        if len(units) < MIN_HISTORY_DAYS or len(units) < MOVING_WINDOW + 1:
            continue  # insufficient history -> excluded upstream, not a drop signal

        ref = units[-(MOVING_WINDOW + 1):-1]          # prior MOVING_WINDOW days (excl. last)
        mean_ref = float(np.mean(ref))
        std_ref = float(np.std(ref))                 # population std over the window
        last = float(units[-1])

        if mean_ref <= 0 or last >= mean_ref:
            continue                                 # nothing dropped

        drop_pct = (mean_ref - last) / mean_ref
        if std_ref > 0:
            is_drop = last < (mean_ref - Z_THRESHOLD * std_ref)
        else:
            is_drop = drop_pct >= 0.5                # >= 50% drop on flat history

        if not is_drop:
            continue

        if drop_pct >= 0.50:
            severity, level = "haute", "haute"
        elif drop_pct >= 0.30:
            severity, level = "moyenne", "moyenne"
        else:
            severity, level = "faible", "faible"

        detail = (
            f"Last day sales fell {drop_pct * 100:.0f}% below the "
            f"{MOVING_WINDOW}-day moving average "
            f"({last:.0f} units vs ~{mean_ref:.1f} mean, std={std_ref:.1f})."
        )
        anomalies.append({
            "product_id": int(product_id),
            "type": "sales_drop",
            "severity": severity,
            "confidence": {"level": level, "detail": detail},
            "description": detail,
        })
    return anomalies


def _excluded_products(df: pd.DataFrame) -> list[int]:
    """Products with fewer than MIN_HISTORY_DAYS sale rows (insufficient_data)."""
    if df is None or df.empty:
        return []
    counts = df.groupby("product_id").size()
    return sorted(int(p) for p, n in counts.items() if int(n) < MIN_HISTORY_DAYS)


def build_anomaly_report(df: pd.DataFrame) -> dict[str, Any]:
    """
    Build the `/anomalies` JSON contract from a sales-history DataFrame.

    Returns a dict with EXACTLY the keys required by the contract:
    {"anomalies": [...], "excluded_products": [int], "status": "ok"}.
    """
    anomalies = detect_sales_drop_anomalies(df)
    excluded = _excluded_products(df)
    # Defensive: never flag a product that lacks the history to judge it.
    excluded_set = set(excluded)
    anomalies = [a for a in anomalies if a["product_id"] not in excluded_set]

    # NOTE: stock_discrepancy is intentionally NOT produced here - see module
    # docstring. No stock_discrepancy anomalies are emitted until a backend
    # endpoint exposes a real-vs-theoretical inventory comparison.
    return {
        "anomalies": anomalies,
        "excluded_products": excluded,
        "status": "ok",
    }


def detect_anomalies(df: pd.DataFrame | None = None) -> dict[str, Any]:
    """
    Public entry point used by the `/anomalies` route.

    When `df` is None (real request), the sales history is loaded via the
    existing ETL helper and the result is cached for CACHE_TTL_SECONDS (~1h).
    When `df` is supplied (unit tests), the cache is bypassed entirely so tests
    stay deterministic and never touch the shared cache DB.
    """
    if df is None:
        cached = get_cached_result(ENDPOINT, 0, PERIOD, ttl_seconds=CACHE_TTL_SECONDS)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                invalidate_cache(ENDPOINT, 0, PERIOD)

        df = build_sales_history_dataset()
        report = build_anomaly_report(df)
        set_cached_result(ENDPOINT, 0, PERIOD, report, ttl_seconds=CACHE_TTL_SECONDS)
        return report

    return build_anomaly_report(df)
