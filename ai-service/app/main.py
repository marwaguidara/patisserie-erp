from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

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
        result = naive_forecast_for_product(product_id, days=horizon_days)
        return {
            "value": result.value,
            "confidence": result.confidence,
            "status": result.status,
        }
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
    return {"value": result, "confidence": {"level": "haute", "interval": [0.0, 0.0]}, "status": "ok"}
