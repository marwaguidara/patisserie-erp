"""
Out-of-time evaluation script for Bakery AI Service (v1 Baseline vs v2 Ridge Model).
Executes chronological time-based train/test splits per product to prevent data leakage.
"""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from app.db import fetch_products
from app.etl import build_sales_history_dataset
from app.features import FEATURE_COLUMNS, create_v2_features


def run_out_of_time_eval() -> dict:
    df_raw = build_sales_history_dataset()
    if df_raw.empty:
        return {"status": "error", "message": "No sales data available for evaluation"}

    df_raw["sale_date"] = pd.to_datetime(df_raw["sale_date"])
    df_raw = df_raw.sort_values(["product_id", "sale_date"]).reset_index(drop=True)

    product_df = pd.DataFrame(fetch_products())
    prod_names = dict(zip(product_df["id"], product_df["name"])) if not product_df.empty else {}

    # Feature engineering on full series
    df_feat = create_v2_features(df_raw)

    # Chronological Out-of-time split: last 25% of observations per product (min 1, max 4) assigned to TEST set
    test_indices = []
    for prod_id, group in df_feat.groupby("product_id"):
        n_test = min(4, max(1, int(len(group) * 0.25)))
        test_indices.extend(group.index[-n_test:])

    test_mask = df_feat.index.isin(test_indices)
    train_mask = ~test_mask

    df_train = df_feat[train_mask].copy()
    df_test = df_feat[test_mask].copy()

    # Train v2 Ridge model on TRAIN set ONLY
    X_train = df_train[FEATURE_COLUMNS].fillna(0.0)
    y_train = df_train["units_sold"].fillna(0.0)

    X_test = df_test[FEATURE_COLUMNS].fillna(0.0)
    y_test = df_test["units_sold"].fillna(0.0)

    v2_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("regressor", Ridge(alpha=1.0, random_state=42))
    ])
    v2_pipeline.fit(X_train, y_train)

    df_test["pred_v2"] = v2_pipeline.predict(X_test)
    df_test["pred_v2"] = df_test["pred_v2"].apply(lambda x: max(0.0, float(x)))

    # Evaluate Baseline v1 on TEST set using TRAIN set anchors
    v1_preds = []
    for idx, row in df_test.iterrows():
        p_id = row["product_id"]
        p_train = df_train[df_train["product_id"] == p_id].sort_values("sale_date")
        if len(p_train) == 0:
            val = 0.0
        else:
            recent_7 = p_train["units_sold"].tail(7).mean()
            weekly_anchor = p_train["units_sold"].iloc[-7:].mean() if len(p_train) >= 7 else p_train["units_sold"].mean()
            val = float(max(recent_7, weekly_anchor, 0.0))
        v1_preds.append(val)

    df_test["pred_v1"] = v1_preds

    # Global Metrics
    mae_v1 = float(mean_absolute_error(y_test, df_test["pred_v1"]))
    rmse_v1 = float(np.sqrt(mean_squared_error(y_test, df_test["pred_v1"])))

    mae_v2 = float(mean_absolute_error(y_test, df_test["pred_v2"]))
    rmse_v2 = float(np.sqrt(mean_squared_error(y_test, df_test["pred_v2"])))

    # Per-product breakdown
    per_product = []
    for p_id, p_group in df_test.groupby("product_id"):
        p_name = prod_names.get(p_id, f"Product #{p_id}")
        y_p = p_group["units_sold"]
        v1_p = p_group["pred_v1"]
        v2_p = p_group["pred_v2"]

        m1 = float(mean_absolute_error(y_p, v1_p))
        r1 = float(np.sqrt(mean_squared_error(y_p, v1_p)))
        m2 = float(mean_absolute_error(y_p, v2_p))
        r2 = float(np.sqrt(mean_squared_error(y_p, v2_p)))

        winner = "v2 (Ridge)" if m2 < m1 else ("v1 (Baseline)" if m1 < m2 else "Equal")

        per_product.append({
            "product_id": int(p_id),
            "product_name": p_name,
            "train_samples": int(len(df_train[df_train["product_id"] == p_id])),
            "test_samples": int(len(p_group)),
            "mae_v1": round(m1, 4),
            "rmse_v1": round(r1, 4),
            "mae_v2": round(m2, 4),
            "rmse_v2": round(r2, 4),
            "winner": winner
        })

    return {
        "status": "success",
        "split_strategy": "Chronological Out-of-Time Split (Last 25% observations per product)",
        "train_sample_count": len(df_train),
        "test_sample_count": len(df_test),
        "global_metrics": {
            "v1_baseline": {"mae": round(mae_v1, 4), "rmse": round(rmse_v1, 4)},
            "v2_ridge": {"mae": round(mae_v2, 4), "rmse": round(rmse_v2, 4)},
            "mae_improvement": round((mae_v1 - mae_v2) / mae_v1 * 100, 2),
            "rmse_improvement": round((rmse_v1 - rmse_v2) / rmse_v1 * 100, 2)
        },
        "per_product_metrics": per_product
    }


if __name__ == "__main__":
    results = run_out_of_time_eval()
    print("=== OUT-OF-TIME EVALUATION REPORT ===")
    print(json.dumps(results, indent=2))
