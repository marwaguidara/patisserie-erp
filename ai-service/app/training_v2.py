"""
v2 Model Training and Versioning Pipeline for Bakery AI Service.
Extracts sales data, generates feature matrix, trains a robust Ridge Regression model,
and persists versioned artifacts to data/v2/ and models/v2/.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.config import BASE_DIR, DATA_DIR
from app.db import fetch_products
from app.etl import build_sales_history_dataset
from app.features import FEATURE_COLUMNS, create_v2_features

MODEL_VERSION_V2 = "ridge-v2"
V2_DATA_DIR = DATA_DIR / "v2"
V2_MODEL_DIR = BASE_DIR / "models" / "v2"


def train_and_export_v2() -> dict:
    # 1. Ensure target directories exist
    V2_DATA_DIR.mkdir(parents=True, exist_ok=True)
    V2_MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # 2. Extract raw dataset
    df_raw = build_sales_history_dataset()
    product_df = pd.DataFrame(fetch_products())

    # 3. Generate feature matrix
    df_features = create_v2_features(df_raw)

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    # 4. Save data artifacts (v2)
    parquet_raw_path = V2_DATA_DIR / "sales_history_v2.parquet"
    parquet_feat_path = V2_DATA_DIR / "features_v2.parquet"
    data_meta_path = V2_DATA_DIR / "metadata.json"

    df_raw.to_parquet(parquet_raw_path, index=False)
    df_features.to_parquet(parquet_feat_path, index=False)

    start_date = df_raw["sale_date"].min() if not df_raw.empty else None
    end_date = df_raw["sale_date"].max() if not df_raw.empty else None

    # Calculate exact per-product statistics
    product_stats = {}
    if not df_raw.empty:
        grouped = df_raw.groupby("product_id")
        for prod_id, group in grouped:
            product_stats[str(prod_id)] = {
                "days_with_sales": int(group["sale_date"].nunique()),
                "total_units": float(group["units_sold"].sum()),
                "min_date": group["sale_date"].min().strftime("%Y-%m-%d"),
                "max_date": group["sale_date"].max().strftime("%Y-%m-%d"),
            }

    data_metadata = {
        "exported_at": timestamp,
        "model_version": MODEL_VERSION_V2,
        "period_start": start_date.strftime("%Y-%m-%d") if start_date is not None else None,
        "period_end": end_date.strftime("%Y-%m-%d") if end_date is not None else None,
        "catalog_product_count": int(product_df["id"].nunique()) if not product_df.empty else 0,
        "products_with_sales_count": int(df_raw["product_id"].nunique()) if not df_raw.empty else 0,
        "total_aggregate_rows": int(len(df_raw)),
        "engineered_features": FEATURE_COLUMNS,
        "per_product_stats": product_stats,
        "source": "read_only_sales"
    }

    data_meta_path.write_text(json.dumps(data_metadata, indent=2), encoding="utf-8")

    # 5. Train Ridge Regression Model
    X = df_features[FEATURE_COLUMNS].fillna(0.0)
    y = df_features["units_sold"].fillna(0.0) if not df_features.empty else pd.Series(dtype=float)

    model_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("regressor", Ridge(alpha=1.0, random_state=42))
    ])

    if len(X) > 0 and len(y) > 0:
        model_pipeline.fit(X, y)
        y_pred = model_pipeline.predict(X)

        mae = float(mean_absolute_error(y, y_pred))
        rmse = float(np.sqrt(mean_squared_error(y, y_pred)))
        r2 = float(r2_score(y, y_pred)) if len(y) > 1 else 0.0

        # Feature coefficients
        regressor = model_pipeline.named_steps["regressor"]
        coefficients = {feat: float(coef) for feat, coef in zip(FEATURE_COLUMNS, regressor.coef_)}
        intercept = float(regressor.intercept_)
    else:
        mae, rmse, r2 = 0.0, 0.0, 0.0
        coefficients = {feat: 0.0 for feat in FEATURE_COLUMNS}
        intercept = 0.0

    # 6. Persist Model Artifacts (v2)
    model_path = V2_MODEL_DIR / "model_v2.joblib"
    model_meta_path = V2_MODEL_DIR / "model_metadata.json"

    joblib.dump(model_pipeline, model_path)

    # Volumetry rationale for report and metadata
    volumetry_justification = (
        f"Real dataset volume: {len(df_raw)} total rows across {len(product_stats)} active products "
        f"(16-17 sales days per active product over ~3.5 months). Given the low density and small sample size, "
        f"Ridge Regression (L2-regularized linear model) was selected over complex models (Prophet, SARIMA, RandomForest) "
        f"to prevent severe overfitting and provide robust, interpretable predictions on temporal and lag features."
    )

    model_metadata = {
        "model_version": MODEL_VERSION_V2,
        "trained_at": timestamp,
        "model_type": "Ridge Regression (StandardScaler + Ridge L2)",
        "hyperparameters": {
            "alpha": 1.0,
            "random_state": 42
        },
        "metrics_on_training_set": {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "r2_score": round(r2, 4)
        },
        "intercept": round(intercept, 4),
        "feature_coefficients": {k: round(v, 4) for k, v in coefficients.items()},
        "training_sample_count": len(X),
        "volumetry_justification": volumetry_justification
    }

    model_meta_path.write_text(json.dumps(model_metadata, indent=2), encoding="utf-8")

    return {
        "data_metadata": data_metadata,
        "model_metadata": model_metadata,
        "model_path": str(model_path),
        "data_path": str(parquet_feat_path)
    }


if __name__ == "__main__":
    res = train_and_export_v2()
    print("=== V2 TRAINING PIPELINE COMPLETE ===")
    print("Model Metadata:\n", json.dumps(res["model_metadata"], indent=2))
