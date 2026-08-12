import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from app.config import CACHE_DIR, DEFAULT_TTL_SECONDS, MODEL_VERSION

CACHE_DB = CACHE_DIR / "ai_results_cache.sqlite3"
CACHE_DB.parent.mkdir(parents=True, exist_ok=True)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(CACHE_DB)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_results_cache (
            key TEXT PRIMARY KEY,
            endpoint TEXT NOT NULL,
            product_id INTEGER NOT NULL,
            period TEXT NOT NULL,
            model_version TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def cache_key(endpoint: str, product_id: int, period: str, model_version: str = MODEL_VERSION) -> str:
    return f"{endpoint}|{product_id}|{period}|{model_version}"


def get_cached_result(endpoint: str, product_id: int, period: str, ttl_seconds: int = DEFAULT_TTL_SECONDS):
    key = cache_key(endpoint, product_id, period)
    conn = _connect()
    row = conn.execute(
        "SELECT payload, expires_at FROM ai_results_cache WHERE key = ?",
        (key,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    payload, expires_at = row
    if datetime.fromisoformat(expires_at) < datetime.utcnow():
        invalidate_cache(endpoint, product_id, period)
        return None
    return payload


def set_cached_result(endpoint: str, product_id: int, period: str, payload: dict, ttl_seconds: int = DEFAULT_TTL_SECONDS):
    key = cache_key(endpoint, product_id, period)
    created_at = datetime.utcnow().isoformat()
    expires_at = (datetime.utcnow() + timedelta(seconds=ttl_seconds)).isoformat()
    conn = _connect()
    conn.execute(
        "INSERT INTO ai_results_cache (key, endpoint, product_id, period, model_version, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at, expires_at = excluded.expires_at",
        (key, endpoint, product_id, period, MODEL_VERSION, str(payload), created_at, expires_at),
    )
    conn.commit()
    conn.close()


def invalidate_cache(endpoint: str | None = None, product_id: int | None = None, period: str | None = None):
    conn = _connect()
    if endpoint is None and product_id is None and period is None:
        conn.execute("DELETE FROM ai_results_cache")
    else:
        query = "DELETE FROM ai_results_cache WHERE 1=1"
        params = []
        if endpoint is not None:
            query += " AND endpoint = ?"
            params.append(endpoint)
        if product_id is not None:
            query += " AND product_id = ?"
            params.append(product_id)
        if period is not None:
            query += " AND period = ?"
            params.append(period)
        conn.execute(query, tuple(params))
    conn.commit()
    conn.close()
