import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

from app.main import app
from app.cache import invalidate_cache
from app.recommendations import get_production_recommendation, SAFETY_MARGIN_RATE, WASTE_RATE

client = TestClient(app)


def _get(product_id: int, horizon: int = 7):
    invalidate_cache("production-recommendations", product_id, f"{horizon}d")
    return client.get(f"/production-recommendations?product_id={product_id}&horizon_days={horizon}")


def test_full_structure():
    """Every required field is present with the correct type."""
    r = _get(32)
    assert r.status_code == 200
    d = r.json()
    for k in ["recommended_quantity", "forecast", "stock", "safety_margin", "waste_adjustment",
              "confidence", "status", "model_version", "based_on_forecast"]:
        assert k in d, f"missing key {k}"

    assert isinstance(d["confidence"], dict)
    assert d["confidence"]["level"] in ("haute", "moyenne", "faible")
    assert isinstance(d["confidence"]["interval"], list) and len(d["confidence"]["interval"]) == 2

    assert d["status"] in ("ok", "insufficient_data", "manual_review_required")
    assert d["model_version"] in ("ridge-v2", "baseline-v1")

    for n in ("stock", "safety_margin", "waste_adjustment"):
        assert isinstance(d[n], (int, float)), n

    b = d["based_on_forecast"]
    for k in ["value", "confidence", "status", "model_version"]:
        assert k in b, f"based_on_forecast missing {k}"


def test_recommended_quantity_exact_formula():
    """Croissant Pur Beurre (product 32): reliable forecast + known stock -> exact formula."""
    r = _get(32)
    assert r.status_code == 200
    d = r.json()
    # Product 32 (Croissant Pur Beurre) has 30 sale dates -> ok (not manual/insufficient).
    assert d["status"] == "ok"

    forecast = float(d["forecast"])
    stock = float(d["stock"])
    safety = round(forecast * SAFETY_MARGIN_RATE, 2)
    waste = round(forecast * WASTE_RATE, 2)
    expected = round(forecast + safety - stock + waste, 2)

    assert d["safety_margin"] == safety
    assert d["waste_adjustment"] == waste
    assert d["waste_adjustment"] >= 0
    assert d["recommended_quantity"] == expected


def test_insufficient_data():
    """Product 9999: no history -> insufficient_data, no invented value."""
    r = _get(9999)
    assert r.status_code == 200
    d = r.json()

    assert d["status"] == "insufficient_data"
    assert d["recommended_quantity"] is None
    assert d["forecast"] is None
    assert d["safety_margin"] == 0.0
    assert d["waste_adjustment"] == 0.0
    assert d["model_version"] == "baseline-v1"
    assert d["based_on_forecast"]["status"] == "insufficient_data"
    assert d["based_on_forecast"]["value"] is None
    assert d["confidence"]["level"] == "faible"


def test_manual_review_required_when_stock_unavailable(monkeypatch):
    """Reliable forecast but stock technically unavailable -> manual_review_required."""
    invalidate_cache("production-recommendations", 32, "7d")
    monkeypatch.setattr("app.recommendations.fetch_current_stocks", lambda: {})
    rec = get_production_recommendation(32, days=7)
    assert rec["status"] == "manual_review_required"
    assert rec["recommended_quantity"] is None
    assert rec["forecast"] is not None  # forecast was still reliable
    # Cleanup: do not leave a stale manual_review entry for product 32 / 7d in the shared cache.
    invalidate_cache("production-recommendations", 32, "7d")