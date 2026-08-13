import json
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from app.config import VERSION_DIR, MODEL_VERSION
from app.db import fetch_product_aggregates, fetch_products


def build_sales_history_dataset() -> pd.DataFrame:
    rows = fetch_product_aggregates()
    if not rows:
        return pd.DataFrame(columns=["product_id", "sale_date", "units_sold", "revenue"])

    df = pd.DataFrame(rows)
    df["sale_date"] = pd.to_datetime(df["sale_date"])
    df["units_sold"] = pd.to_numeric(df["units_sold"], errors="coerce").fillna(0)
    df["revenue"] = pd.to_numeric(df["revenue"], errors="coerce").fillna(0)
    return df.sort_values(["product_id", "sale_date"]).reset_index(drop=True)


def extract_and_store_etl() -> dict:
    df = build_sales_history_dataset()
    product_df = pd.DataFrame(fetch_products())
    export_dir = VERSION_DIR
    export_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    parquet_path = export_dir / "sales_history.parquet"
    metadata_path = export_dir / "metadata.json"

    if not df.empty:
        df.to_parquet(parquet_path, index=False)
    else:
        empty_df = pd.DataFrame(columns=["product_id", "sale_date", "units_sold", "revenue"])
        empty_df.to_parquet(parquet_path, index=False)

    start_date = df["sale_date"].min() if not df.empty else None
    end_date = df["sale_date"].max() if not df.empty else None
    coverage = {
        "exported_at": timestamp,
        "model_version": MODEL_VERSION,
        "period_start": start_date.isoformat() if start_date is not None else None,
        "period_end": end_date.isoformat() if end_date is not None else None,
        "product_count": int(product_df["id"].nunique()) if not product_df.empty else 0,
        "rows": int(len(df)),
        "source": "read_only_sales"
    }
    metadata_path.write_text(json.dumps(coverage, indent=2), encoding="utf-8")
    return coverage

