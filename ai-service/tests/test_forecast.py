import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'


def test_forecast_contract():
    response = client.get('/forecast', params={'product_id': 1})
    assert response.status_code == 200
    payload = response.json()
    assert 'value' in payload
    assert 'confidence' in payload
    assert 'level' in payload['confidence']
    assert 'interval' in payload['confidence']
    assert payload['status'] in {'ok', 'insufficient_data'}
    assert 'model_version' in payload
    assert payload['model_version'] in {'ridge-v2', 'baseline-v1'}
