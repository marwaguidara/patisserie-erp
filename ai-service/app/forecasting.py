from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from app.etl import build_sales_history_dataset


@dataclass
class ForecastResponse:
    value: float | None
    confidence: dict
    status: str


def naive_forecast_for_product(product_id: int, days: int = 7) -> ForecastResponse:
    df = build_sales_history_dataset()
    product_df = df[df["product_id"] == product_id].copy()
    if product_df.empty:
        return ForecastResponse(
            value=None,
            confidence={"level": "faible", "interval": [0.0, 0.0]},
            status="insufficient_data",
        )

    product_df = product_df.sort_values("sale_date")
    product_df["units_sold"] = pd.to_numeric(product_df["units_sold"], errors="coerce").fillna(0)

    if len(product_df) < 14:
        return ForecastResponse(
            value=None,
            confidence={"level": "faible", "interval": [0.0, 0.0]},
            status="insufficient_data",
        )

    recent = product_df["units_sold"].tail(7).mean()
    same_week_last = product_df.groupby(product_df["sale_date"].dt.dayofweek)["units_sold"].mean().reindex(range(7), fill_value=0)
    weekly_anchor = product_df["units_sold"].iloc[-7:].mean() if len(product_df) >= 7 else 0
    value = float(max(recent, weekly_anchor, 0.0))

    interval_min = max(0.0, value * 0.75)
    interval_max = value * 1.25

    return ForecastResponse(
        value=value,
        confidence={"level": "haute" if len(product_df) >= 30 else "moyenne", "interval": [round(interval_min, 2), round(interval_max, 2)]},
        status="ok",
    )
