from __future__ import annotations

from typing import Any
import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.cache import get_cached_result, set_cached_result, invalidate_cache
from app.etl import extract_and_store_etl
from app.forecasting import naive_forecast_for_product

app = FastAPI(title="Bakery AI Service", version="0.1.0")

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
        # Check cache first
        cache_key = f"forecast|{product_id}|{horizon_days}d"
        cached = get_cached_result("forecast", product_id, f"{horizon_days}d")
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                # Defensive: a corrupt/stale cache entry must not mask a valid
                # forecast. Drop it and recompute instead of erroring out.
                invalidate_cache("forecast", product_id, f"{horizon_days}d")
        
        # Compute forecast if not cached
        result = naive_forecast_for_product(product_id, days=horizon_days)
        response = {
            "value": result.value,
            "confidence": result.confidence,
            "status": result.status,
        }
        
        # Store in cache
        set_cached_result("forecast", product_id, f"{horizon_days}d", response)
        
        return response
    except Exception:
        return {
            "value": None,
            "confidence": {"level": "faible", "interval": [0.0, 0.0]},
            "status": "insufficient_data",
        }


@app.get("/production-recommendations")
def production_recommendations() -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={
            "value": None,
            "confidence": {"level": "faible", "interval": [0.0, 0.0]},
            "status": "insufficient_data",
            "error": "Not implemented yet",
        },
    )


@app.get("/anomalies")
def anomalies() -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={
            "value": None,
            "confidence": {"level": "faible", "interval": [0.0, 0.0]},
            "status": "insufficient_data",
            "error": "Not implemented yet",
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
