"""
Feature engineering module for Bakery AI Service (v2 model).
Calculates calendar, lag, and rolling statistics per product without forward-looking data leakage.
"""
from __future__ import annotations

import pandas as pd
import numpy as np

# List of major French public holidays (for is_holiday indicator)
FRANCE_HOLIDAYS_2026 = {
    "2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08",
    "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15",
    "2026-11-01", "2026-11-11", "2026-12-25"
}

FEATURE_COLUMNS = [
    "day_of_week",
    "month",
    "is_weekend",
    "is_holiday",
    "lag_1",
    "lag_7",
    "rolling_mean_7",
    "rolling_mean_14",
    "rolling_mean_30"
]


def create_v2_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Computes temporal features, lag features, and rolling moving averages.
    
    Expects df with columns: ['product_id', 'sale_date', 'units_sold', 'revenue']
    """
    if df.empty:
        empty_cols = ["product_id", "sale_date", "units_sold", "revenue"] + FEATURE_COLUMNS
        return pd.DataFrame(columns=empty_cols)

    df_feat = df.copy()
    df_feat["sale_date"] = pd.to_datetime(df_feat["sale_date"])
    df_feat = df_feat.sort_values(["product_id", "sale_date"]).reset_index(drop=True)

    # 1. Calendar & Temporal Features
    df_feat["day_of_week"] = df_feat["sale_date"].dt.dayofweek
    df_feat["month"] = df_feat["sale_date"].dt.month
    df_feat["is_weekend"] = (df_feat["day_of_week"] >= 5).astype(int)
    
    date_strs = df_feat["sale_date"].dt.strftime("%Y-%m-%d")
    df_feat["is_holiday"] = date_strs.isin(FRANCE_HOLIDAYS_2026).astype(int)

    # 2. Lag Features per product (shifted by 1 day so target isn't leaked)
    df_feat["lag_1"] = (
        df_feat.groupby("product_id")["units_sold"]
        .shift(1)
        .fillna(0.0)
    )
    df_feat["lag_7"] = (
        df_feat.groupby("product_id")["units_sold"]
        .shift(7)
        .fillna(0.0)
    )

    # 3. Rolling Moving Averages per product (shifted by 1 to exclude current day)
    def calc_rolling_mean(series: pd.Series, window: int) -> pd.Series:
        shifted = series.shift(1)
        return shifted.rolling(window=window, min_periods=1).mean().fillna(0.0)

    df_feat["rolling_mean_7"] = (
        df_feat.groupby("product_id")["units_sold"]
        .transform(lambda s: calc_rolling_mean(s, 7))
    )
    df_feat["rolling_mean_14"] = (
        df_feat.groupby("product_id")["units_sold"]
        .transform(lambda s: calc_rolling_mean(s, 14))
    )
    df_feat["rolling_mean_30"] = (
        df_feat.groupby("product_id")["units_sold"]
        .transform(lambda s: calc_rolling_mean(s, 30))
    )

    return df_feat
