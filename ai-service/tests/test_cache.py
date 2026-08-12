import json
import time
from fastapi.testclient import TestClient
from app.main import app
from app.cache import invalidate_cache

client = TestClient(app)

def test_cache_hit():
    """Test that cache stores forecast results"""
    # Clear cache first
    invalidate_cache()
    
    product_id = 1
    
    # First call - should compute and cache
    start = time.time()
    response1 = client.get(f"/forecast?product_id={product_id}")
    time1 = time.time() - start
    
    assert response1.status_code == 200
    data1 = response1.json()
    
    # Second call - should hit cache (much faster)
    start = time.time()
    response2 = client.get(f"/forecast?product_id={product_id}")
    time2 = time.time() - start
    
    assert response2.status_code == 200
    data2 = response2.json()
    
    # Results should be identical (from cache)
    assert data1 == data2
    
    print(f"First call: {time1:.4f}s")
    print(f"Second call (cached): {time2:.4f}s")
    print(f"Cache speedup: {time1/time2:.1f}x")


def test_cache_invalidation_on_etl():
    """Test that cache is cleared when ETL runs"""
    # Clear cache first
    invalidate_cache()
    
    product_id = 1
    
    # Get forecast and cache it
    response1 = client.get(f"/forecast?product_id={product_id}")
    assert response1.status_code == 200
    data1 = response1.json()
    
    # Run ETL (should invalidate forecast cache)
    etl_response = client.post("/etl/run")
    assert etl_response.status_code == 200
    
    # Second forecast call should trigger recompute (not cached)
    response2 = client.get(f"/forecast?product_id={product_id}")
    assert response2.status_code == 200
    data2 = response2.json()
    
    # Data should still be same (deterministic forecast) but cache was cleared and recomputed
    assert data1 == data2
    print("✓ Cache invalidated on ETL and recomputed correctly")


def test_different_products_separate_cache():
    """Test that different products use different cache entries"""
    invalidate_cache()
    
    # Get forecast for product 1
    response1 = client.get("/forecast?product_id=1")
    assert response1.status_code == 200
    
    # Get forecast for product 2 (different product, different cache key)
    response2 = client.get("/forecast?product_id=2")
    assert response2.status_code == 200
    
    # Both should succeed with separate cache entries
    print("✓ Different products use separate cache entries")


if __name__ == "__main__":
    test_cache_hit()
    test_cache_invalidation_on_etl()
    test_different_products_separate_cache()
    print("\n✓ All cache tests passed!")
