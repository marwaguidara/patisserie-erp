"""Production recommendations business logic.

Formula (exact):
    recommended_quantity = forecast + safety_margin - stock + waste_adjustment

Convention: waste_adjustment is always >= 0 (extra quantity to produce to
compensate historical losses — never a subtraction).

Current finished-good stock is consumed from `products.stock_quantity`, the field
maintained by the backend StockService (Phase 3) — read in ONE batch query, never
recomputed from raw movements by the AI service.
"""
from __future__ import annotations

import json
from typing import Any

from app.cache import get_cached_result, set_cached_result, invalidate_cache
from app.db import fetch_current_stocks
from app.forecasting import get_forecast_for_product, ForecastResponse

ENDPOINT = "production-recommendations"

# Deterministic business parameters (auditable, not hardcoded per product).
SAFETY_MARGIN_RATE = 0.10   # +10% buffer on top of the forecast
WASTE_RATE = 0.05           # +5% to compensate historical losses (always >= 0)


def _forecast_payload(f: ForecastResponse) -> dict[str, Any]:
    """Exact `/forecast` response shape for full traceability in based_on_forecast."""
    return {
        "value": f.value,
        "confidence": f.confidence,
        "status": f.status,
        "model_version": f.model_version,
    }


def manual_review_response(forecast: ForecastResponse | None = None) -> dict[str, Any]:
    _f = forecast or ForecastResponse(
        value=None,
        confidence={"level": "faible", "interval": [0.0, 0.0]},
        status="insufficient_data",
        model_version="baseline-v1",
    )
    return {
        "recommended_quantity": None,
        "forecast": _f.value,
        "stock": 0.0,
        "safety_margin": 0.0,
        "waste_adjustment": 0.0,
        "confidence": _f.confidence,
        "status": "manual_review_required",
        "model_version": _f.model_version,
        "based_on_forecast": _forecast_payload(_f),
    }


def _insufficient_data_response(forecast: ForecastResponse, stock: float) -> dict[str, Any]:
    return {
        "recommended_quantity": None,
        "forecast": None,  # never invent a value
        "stock": round(stock, 2),
        "safety_margin": 0.0,
        "waste_adjustment": 0.0,
        "confidence": forecast.confidence,  # faible / [0.0, 0.0]
        "status": "insufficient_data",
        "model_version": forecast.model_version,
        "based_on_forecast": _forecast_payload(forecast),
    }


def build_recommendation(forecast: ForecastResponse, stock: float | None) -> dict[str, Any]:
    if forecast.status == "insufficient_data":
        return _insufficient_data_response(forecast, stock if stock is not None else 0.0)

    # Forecast is reliable but stock is technically unavailable -> ask a human.
    if stock is None:
        return manual_review_response(forecast)

    safety_margin = round(float(forecast.value) * SAFETY_MARGIN_RATE, 2)
    waste_adjustment = round(float(forecast.value) * WASTE_RATE, 2)  # always >= 0
    recommended_quantity = round(
        float(forecast.value) + safety_margin - float(stock) + waste_adjustment, 2
    )

    return {
        "recommended_quantity": recommended_quantity,
        "forecast": float(forecast.value),
        "stock": round(float(stock), 2),
        "safety_margin": safety_margin,
        "waste_adjustment": waste_adjustment,
        "confidence": forecast.confidence,
        "status": "ok",
        "model_version": forecast.model_version,
        "based_on_forecast": _forecast_payload(forecast),
    }


def get_production_recommendation(product_id: int, days: int = 7) -> dict[str, Any]:
    forecast = get_forecast_for_product(product_id, days=days)
    period = f"{days}d"

    # Cache by (product_id + horizon + model_version).
    cached = get_cached_result(ENDPOINT, product_id, period, model_version=forecast.model_version)
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            invalidate_cache(ENDPOINT, product_id, period)

    stocks = fetch_current_stocks()
    stock = stocks.get(int(product_id))
    response = build_recommendation(forecast, stock)
    set_cached_result(ENDPOINT, product_id, period, response, model_version=forecast.model_version)
    return response
