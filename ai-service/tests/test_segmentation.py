"""
Sprint 3 / Sprint 4 - Segmentation & Insights unit tests.

Required cases:
  1. product 32 (sufficient history + known margin) -> classified in a VALID quadrant
  2. product 33 (insufficient_data) -> "en_observation", never another quadrant
Plus: business-language insights contract, and the documented single-eligible
product boundary case (median = its own value -> star/cash_cow, valid).
"""
import sys
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

from app.main import app  # noqa: E402
from app.cache import invalidate_cache  # noqa: E402
from app.segmentation import (  # noqa: E402
    build_segments, build_insights, QUADRANTS,
)


client = TestClient(app)


def _df_multi(rows):
    """rows: [(product_id, [units per day, ...]), ...] -> sales-history DataFrame."""
    recs = []
    for pid, units in rows:
        dates = pd.date_range("2026-06-01", periods=len(units)).strftime("%Y-%m-%d")
        recs += [(pid, dates[i], units[i], float(units[i] * 1.3)) for i in range(len(units))]
    return pd.DataFrame(recs, columns=["product_id", "sale_date", "units_sold", "revenue"])


def test_product_32_valid_quadrant():
    """Product 32 with sufficient history + known margin -> a valid non-en_observation quadrant."""
    products = [{"id": 32, "name": "Croissant Pur Beurre"}]
    margins = {32: 0.85}
    df = _df_multi([(32, [30] * 30)])
    segments = build_segments(df, products, margins)

    assert len(segments) == 1
    s = segments[0]
    assert s["product_id"] == 32
    assert s["quadrant"] in QUADRANTS - {"en_observation"}
    assert s["quadrant"] != "en_observation"
    assert s["margin"] == pytest.approx(0.85, abs=0.01)
    assert s["sales_frequency"] == pytest.approx(30.0, abs=0.5)
    assert s["confidence"]["level"] in ("haute", "moyenne", "faible")
    # contract shape
    assert set(s.keys()) == {"product_id", "product_name", "quadrant", "margin", "sales_frequency", "confidence"}


def test_product_33_en_observation():
    """Product 33 (insufficient_data) -> en_observation, never another quadrant."""
    products = [
        {"id": 32, "name": "Croissant Pur Beurre"},
        {"id": 33, "name": "Pain au Chocolat"},
    ]
    margins = {32: 0.85, 33: 0.71}
    df = _df_multi([(32, [30] * 15), (33, [3])])
    segments = build_segments(df, products, margins)

    s33 = next(s for s in segments if s["product_id"] == 33)
    assert s33["quadrant"] == "en_observation"
    assert s33["confidence"]["level"] == "faible"
    assert s33["margin"] == pytest.approx(0.71, abs=0.01)

    s32 = next(s for s in segments if s["product_id"] == 32)
    assert s32["quadrant"] != "en_observation"


def test_single_eligible_product_edge_case():
    """
    Documented valid edge case: with a single eligible product the median IS its
    own value -> it lands in 'star' (margin AND frequency >= their median) or
    'cash_cow'. It must NOT be dormant/to_remove. This is expected behaviour,
    not a bug.
    """
    products = [{"id": 32, "name": "Croissant Pur Beurre"}]
    margins = {32: 0.85}
    df = _df_multi([(32, [30] * 30)])
    segments = build_segments(df, products, margins)
    s = segments[0]
    # The note from the spec: "star" or "cash_cow". Our threshold (>= median)
    # classifies it as star. Either is a valid outcome for this boundary case.
    assert s["quadrant"] in ("star", "cash_cow")
    assert s["quadrant"] != "en_observation"


def test_insights_contract_business_language():
    """/insights: allowed types only, business language (no statistical jargon)."""
    products = [
        {"id": 32, "name": "Croissant Pur Beurre"},
        {"id": 33, "name": "Pain au Chocolat"},
    ]
    margins = {32: 0.85, 33: 0.71}
    df = _df_multi([(32, [30] * 15), (33, [3])])
    segments = build_segments(df, products, margins)
    report = build_insights(segments)

    assert report["status"] == "ok"
    assert isinstance(report["insights"], list)
    allowed = {"highlight_profitable", "low_margin_alert", "price_adjustment"}
    for ins in report["insights"]:
        assert ins["type"] in allowed
        assert ins["confidence"]["level"] in ("haute", "moyenne", "faible")
        assert "mediane" not in ins["message"].lower()
        assert "ecart-type" not in ins["message"].lower()
        assert ins["message"].strip()
    # product 33 is en_observation -> no advice generated for it
    assert all(ins["product_id"] != 33 for ins in report["insights"])


def test_endpoint_contract_and_real_state():
    """End-to-end via TestClient: /segmentation + /insights return the contracts."""
    invalidate_cache("segmentation", 0, "all")
    invalidate_cache("insights", 0, "all")

    r = client.get("/segmentation")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert isinstance(body["segments"], list)
    seg33 = next(s for s in body["segments"] if s["product_id"] == 33)
    assert seg33["quadrant"] == "en_observation"
    seg32 = next(s for s in body["segments"] if s["product_id"] == 32)
    assert seg32["quadrant"] != "en_observation"
    assert seg32["quadrant"] in QUADRANTS

    r2 = client.get("/insights")
    assert r2.status_code == 200
    body2 = r2.json()
    assert body2["status"] == "ok"
    assert isinstance(body2["insights"], list)
    for ins in body2["insights"]:
        assert ins["type"] in {"highlight_profitable", "low_margin_alert", "price_adjustment"}


if __name__ == "__main__":
    test_product_32_valid_quadrant()
    test_product_33_en_observation()
    test_single_eligible_product_edge_case()
    test_insights_contract_business_language()
    test_endpoint_contract_and_real_state()
    print("\nOK: all segmentation tests passed")