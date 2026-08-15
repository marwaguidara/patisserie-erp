"""
Sprint 3 - Prompt 2 - Anomaly detection unit tests.

Two required cases (per Prompt 2):
  1. inject a realistic sales drop on product 32 -> detected (sales_drop)
  2. product 33 (insufficient_data) -> excluded_products, NOT in anomalies

Plus a guard: the real product-32 series ends in a SPIKE (30..30 -> 54), which
must NOT be reported as a sales_drop (we only detect drops, not spikes).
"""
import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

from app.main import app                       # noqa: E402
from app.anomalies import build_anomaly_report, detect_anomalies  # noqa: E402
from app.cache import invalidate_cache         # noqa: E402

client = TestClient(app)


def _df(rows):
    """rows: list of (product_id, sale_date, units_sold, revenue)"""
    return pd.DataFrame(rows, columns=["product_id", "sale_date", "units_sold", "revenue"])


def test_sales_drop_detected_on_product_32():
    """Inject a realistic sales drop on product 32 -> flagged as sales_drop."""
    # 14 stable days at 30 units, then the last day collapses to 0 (closure / sick day).
    dates = pd.date_range("2026-06-01", periods=14).strftime("%Y-%m-%d")
    rows = [(32, d, 30, 300.0) for d in dates[:-1]] + [(32, dates[-1], 0, 0.0)]
    # also include product 33 (insufficient history) to assert it is NOT flagged
    rows += [(33, "2026-06-01", 3, 36.0)]
    df = _df(rows)

    report = build_anomaly_report(df)

    ids = [a["product_id"] for a in report["anomalies"]]
    assert 32 in ids, f"expected sales_drop anomaly for product 32, got {report}"

    a32 = next(a for a in report["anomalies"] if a["product_id"] == 32)
    assert a32["type"] == "sales_drop"
    assert a32["severity"] == "haute"          # 30 -> 0 is a ~100% drop
    assert a32["confidence"]["level"] == "haute"
    assert isinstance(a32["description"], str) and a32["description"]
    assert "confidence" in a32 and "detail" in a32["confidence"]

    # product 33 has < 14 days -> excluded, never in anomalies
    assert 33 in report["excluded_products"]
    assert 33 not in ids
    assert report["status"] == "ok"


def test_insufficient_data_product_excluded():
    """Product 33 (insufficient_data, single sale row) -> excluded_products, not in anomalies."""
    dates32 = pd.date_range("2026-06-01", periods=14).strftime("%Y-%m-%d")
    rows = [(32, d, 30, 300.0) for d in dates32] + [(33, "2026-06-01", 3, 36.0)]
    df = _df(rows)

    report = build_anomaly_report(df)

    assert report["anomalies"] == [], f"no anomalies expected on stable data, got {report}"
    assert 33 in report["excluded_products"]
    assert 32 not in report["excluded_products"]   # 32 has 14 days -> eligible
    assert report["status"] == "ok"
    # contract shape
    assert set(report.keys()) == {"anomalies", "excluded_products", "status"}
    for a in report["anomalies"]:
        assert set(a.keys()) == {"product_id", "type", "severity", "confidence", "description"}


def test_no_false_positive_on_current_product_32_series():
    """
    Real product-32 series ends with a SPIKE (30 * 29 then 54). A spike is NOT a
    sales_drop -> must not be flagged.
    """
    units = [30] * 29 + [54]
    dates = pd.date_range("2026-05-03", periods=30).strftime("%Y-%m-%d")
    rows = [(32, dates[i], units[i], float(units[i] * 10)) for i in range(30)]
    report = build_anomaly_report(_df(rows))

    assert report["anomalies"] == [], f"spike should not be a sales_drop: {report}"
    assert 32 not in report["excluded_products"]  # 30 days -> sufficient history
    assert report["status"] == "ok"


def test_endpoint_contract_and_real_state():
    """End-to-end via TestClient: /anomalies returns the contract on real data."""
    invalidate_cache("anomalies", 0, "all")
    r = client.get("/anomalies")
    assert r.status_code == 200
    body = r.json()

    assert set(body.keys()) == {"anomalies", "excluded_products", "status"}
    assert body["status"] == "ok"
    assert isinstance(body["anomalies"], list)
    assert isinstance(body["excluded_products"], list)

    # product 33 (1 sale day) is excluded on the real seed
    assert 33 in body["excluded_products"]

    # product 32 (last day = 54 spike, not a drop) is NOT flagged on real data
    ids = [a["product_id"] for a in body["anomalies"]]
    assert 32 not in ids

    for a in body["anomalies"]:
        assert set(a.keys()) == {"product_id", "type", "severity", "confidence", "description"}
        assert a["type"] in ("sales_drop", "stock_discrepancy")
        assert a["severity"] in ("haute", "moyenne", "faible")
        assert set(a["confidence"].keys()) == {"level", "detail"}
        assert a["confidence"]["level"] in ("haute", "moyenne", "faible")


def test_detect_anomalies_bypasses_cache_with_injected_df():
    """Passing a df uses build_anomaly_report directly (cache untouched)."""
    dates = pd.date_range("2026-06-01", periods=14).strftime("%Y-%m-%d")
    rows = [(32, d, 30, 300.0) for d in dates[:-1]] + [(32, dates[-1], 0, 0.0)]
    df = _df(rows)
    report = detect_anomalies(df)            # no cache read/write
    assert 32 in [a["product_id"] for a in report["anomalies"]]
    assert report["status"] == "ok"


if __name__ == "__main__":
    test_sales_drop_detected_on_product_32()
    test_insufficient_data_product_excluded()
    test_no_false_positive_on_current_product_32_series()
    test_endpoint_contract_and_real_state()
    test_detect_anomalies_bypasses_cache_with_injected_df()
    print("\n✓ All anomaly tests passed!")
