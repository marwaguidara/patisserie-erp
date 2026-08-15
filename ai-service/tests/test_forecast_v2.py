import pytest
from fastapi.testclient import TestClient
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

from app.main import app

client = TestClient(app)

def test_forecast_croissant_ridge_v2():
    response = client.get("/forecast?product_id=32&horizon_days=7")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["model_version"] == "ridge-v2"
    assert data["value"] is not None
    assert len(data["confidence"]["interval"]) == 2
    margin = 1.96 * 7.3466
    value = data["value"]
    assert data["confidence"]["interval"][0] == pytest.approx(max(0.0, value - margin), abs=0.02)
    assert data["confidence"]["interval"][1] == pytest.approx(value + margin, abs=0.02)
    assert data["confidence"]["interval"][0] <= data["confidence"]["interval"][1]


def test_forecast_kak_warka_baseline_v1():
    # Post re-seed recalculation for product 30 (kak warka): the product was
    # dropped from the seeded `products` table and has no sale_items, so it now
    # has < 14 days of history and degrades to `insufficient_data`. It is still
    # mapped to baseline-v1 in PRODUCT_EVAL_RMSE (forecasting.py L21), so the
    # insufficient_data fallback reports model_version="baseline-v1" and
    # value=None (no value is ever invented). This guards the graceful-degradation
    # path for a baseline-v1-mapped product that lost its sales history.
    response = client.get("/forecast?product_id=30&horizon_days=7")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "insufficient_data"
    assert data["model_version"] == "baseline-v1"
    assert data["value"] is None
    assert data["confidence"]["level"] == "faible"
    assert data["confidence"]["interval"] == [0.0, 0.0]


def test_forecast_sufficient_data_v2():
    # Product 32 (Croissant Pur Beurre) has 30 sale dates -> v2 model (ridge-v2)
    response = client.get("/forecast?product_id=32&horizon_days=7")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["value"] is not None
    assert data["model_version"] in ["ridge-v2", "baseline-v1"]
    assert "confidence" in data
    assert "interval" in data["confidence"]
    assert len(data["confidence"]["interval"]) == 2
    assert data["confidence"]["interval"][0] <= data["confidence"]["interval"][1]

def test_forecast_newly_created_product_insufficient_data():
    # Product 9999 has 0 sales -> insufficient_data
    response = client.get("/forecast?product_id=9999&horizon_days=7")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "insufficient_data"
    assert data["value"] is None
    assert data["model_version"] == "baseline-v1"
    assert data["confidence"]["level"] == "faible"
    assert data["confidence"]["interval"] == [0.0, 0.0]

def test_cache_invalidation():
    # Warm cache
    r1 = client.get("/forecast?product_id=32&horizon_days=7")
    assert r1.status_code == 200

    # Invalidate cache
    inv = client.post("/cache/invalidate?product_id=32")
    assert inv.status_code == 200
    assert inv.json()["status"] == "ok"

    # Call again
    r2 = client.get("/forecast?product_id=32&horizon_days=7")
    assert r2.status_code == 200
