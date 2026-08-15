from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.config import BASE_DIR
from app.etl import build_sales_history_dataset
from app.features import FEATURE_COLUMNS, create_v2_features

V2_MODEL_PATH = BASE_DIR / "models" / "v2" / "model_v2.joblib"
V2_META_PATH = BASE_DIR / "models" / "v2" / "model_metadata.json"

# Out-of-time Evaluation RMSE residuals per model / product profile
PRODUCT_EVAL_RMSE = {
    32: {"model": "ridge-v2", "rmse": 7.3466},      # Croissant Pur Beurre (v2 wins)
    30: {"model": "baseline-v1", "rmse": 0.8268},   # kak warka (v1 wins)
}
DEFAULT_V2_RMSE = 5.2716
DEFAULT_V1_RMSE = 6.1006


@dataclass
class ForecastResponse:
    value: float | None
    confidence: dict
    status: str
    model_version: str


def predict_v2_forecast_for_product(product_id: int, days: int = 7) -> ForecastResponse:
    """
    Hybrid forecast engine: v2 Ridge for product 25, baseline v1 for product 30,
    insufficient_data when history < 14 days. Confidence interval from out-of-time RMSE.
    """
    df = build_sales_history_dataset()
    product_df = df[df["product_id"] == product_id].copy() if not df.empty else pd.DataFrame()

    # Rule 3: insufficient_data (< 14 days of sales history)
    if product_df.empty or len(product_df) < 14:
        return ForecastResponse(
            value=None,
            confidence={"level": "faible", "interval": [0.0, 0.0]},
            status="insufficient_data",
            model_version="baseline-v1"
        )

    product_df = product_df.sort_values("sale_date")
    product_df["units_sold"] = pd.to_numeric(product_df["units_sold"], errors="coerce").fillna(0.0)

    # Determine which model is recommended based on Out-of-Time evaluation
    prod_eval = PRODUCT_EVAL_RMSE.get(product_id, {"model": "ridge-v2", "rmse": DEFAULT_V2_RMSE})
    recommended_model = prod_eval["model"]

    if recommended_model == "baseline-v1" or not V2_MODEL_PATH.exists():
        # Baseline v1 execution
        recent = float(product_df["units_sold"].tail(7).mean())
        weekly_anchor = float(product_df["units_sold"].iloc[-7:].mean()) if len(product_df) >= 7 else 0.0
        value = float(max(recent, weekly_anchor, 0.0))

        rmse = prod_eval.get("rmse", DEFAULT_V1_RMSE)
        margin_of_error = 1.96 * rmse
        interval_min = max(0.0, value - margin_of_error)
        interval_max = value + margin_of_error
        level = "haute" if len(product_df) >= 30 else "moyenne"

        return ForecastResponse(
            value=round(value, 2),
            confidence={
                "level": level,
                "interval": [round(interval_min, 2), round(interval_max, 2)]
            },
            status="ok",
            model_version="baseline-v1"
        )

    # Model v2 (Ridge Regression) execution
    try:
        model_pipeline = joblib.load(V2_MODEL_PATH)
        df_feat = create_v2_features(df)
        prod_feats = df_feat[df_feat["product_id"] == product_id].copy()

        if prod_feats.empty:
            raise ValueError("No feature rows found")

        # Take latest feature vector
        latest_vector = prod_feats[FEATURE_COLUMNS].tail(1).fillna(0.0)
        predicted_units = float(model_pipeline.predict(latest_vector)[0])
        value = max(0.0, predicted_units)

        rmse = prod_eval.get("rmse", DEFAULT_V2_RMSE)
        margin_of_error = 1.96 * rmse
        interval_min = max(0.0, value - margin_of_error)
        interval_max = value + margin_of_error
        level = "haute" if len(product_df) >= 30 else "moyenne"

        return ForecastResponse(
            value=round(value, 2),
            confidence={
                "level": level,
                "interval": [round(interval_min, 2), round(interval_max, 2)]
            },
            status="ok",
            model_version="ridge-v2"
        )
    except Exception:
        # Fallback to v1 if v2 inference fails for any reason
        recent = float(product_df["units_sold"].tail(7).mean())
        value = float(max(recent, 0.0))
        rmse = DEFAULT_V1_RMSE
        margin_of_error = 1.96 * rmse

        return ForecastResponse(
            value=round(value, 2),
            confidence={
                "level": "moyenne",
                "interval": [round(max(0.0, value - margin_of_error), 2), round(value + margin_of_error, 2)]
            },
            status="ok",
            model_version="baseline-v1"
        )


def get_forecast_for_product(product_id: int, days: int = 7) -> ForecastResponse:
    """Backward-compatible alias for predict_v2_forecast_for_product."""
    return predict_v2_forecast_for_product(product_id, days=days)
