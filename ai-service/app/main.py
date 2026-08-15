from __future__ import annotations

from typing import Any
import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.cache import get_cached_result, set_cached_result, invalidate_cache
from app.etl import extract_and_store_etl
from app.forecasting import get_forecast_for_product

app = FastAPI(title="Bakery AI Service", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "bakery-ai-service"}


@app.get("/forecast")
def forecast(product_id: int, horizon_days: int = 7) -> dict[str, Any]:
    try:
        # First compute forecast object to determine model_version & status
        result = get_forecast_for_product(product_id, days=horizon_days)
        period = f"{horizon_days}d"

        # Check cache with (product_id + horizon + model_version)
        cached = get_cached_result("forecast", product_id, period, model_version=result.model_version)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                invalidate_cache("forecast", product_id, period)

        response = {
            "value": result.value,
            "confidence": result.confidence,
            "status": result.status,
            "model_version": result.model_version,
        }

        # Store in cache
        set_cached_result("forecast", product_id, period, response, model_version=result.model_version)

        return response
    except Exception:
        return {
            "value": None,
            "confidence": {"level": "faible", "interval": [0.0, 0.0]},
            "status": "insufficient_data",
            "model_version": "baseline-v1"
        }


@app.post("/cache/invalidate")
def invalidate_ai_cache(product_id: int | None = None) -> dict[str, Any]:
    invalidate_cache(endpoint="forecast", product_id=product_id)
    invalidate_cache(endpoint="production-recommendations", product_id=product_id)
    return {"status": "ok", "message": f"Cache invalidated for product_id={product_id}"}


@app.get("/production-recommendations")
def production_recommendations(product_id: int, horizon_days: int = 7):
    from app.recommendations import get_production_recommendation, manual_review_response

    try:
        return JSONResponse(get_production_recommendation(product_id, days=horizon_days))
    except Exception:
        # Technical failure (not history-related) -> explicit manual review.
        return JSONResponse(manual_review_response(), status_code=200)


@app.get("/anomalies")
def anomalies() -> JSONResponse:
    from app.anomalies import detect_anomalies

    try:
        return JSONResponse(detect_anomalies(), status_code=200)
    except Exception as e:
        # Technical failure (not history-related) -> explicit contract-shaped error.
        return JSONResponse(
            status_code=500,
            content={
                "anomalies": [],
                "excluded_products": [],
                "status": "error",
                "error": str(e),
            },
        )


@app.get("/segmentation")
def segmentation() -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={
            "value": None,
            "confidence": {"level": "faible", "interval": [0.0, 0.0]},
            "status": "insufficient_data",
            "error": "Not implemented yet",
        },
    )


@app.get("/insights")
def insights() -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={
            "value": None,
            "confidence": {"level": "faible", "interval": [0.0, 0.0]},
            "status": "insufficient_data",
            "error": "Not implemented yet",
        },
    )


@app.post("/etl/run")
def run_etl() -> dict[str, Any]:
    result = extract_and_store_etl()
    # Invalidate all forecast caches after ETL run
    invalidate_cache(endpoint="forecast")
    return {"value": result, "confidence": {"level": "haute", "interval": [0.0, 0.0]}, "status": "ok"}
