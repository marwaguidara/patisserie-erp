from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.config import READ_ONLY_DB_URL

engine: Engine = create_engine(READ_ONLY_DB_URL, pool_pre_ping=True, future=True, connect_args={} if "sqlite" not in READ_ONLY_DB_URL else {"check_same_thread": False})


def _run_query(query: str):
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(query))
            return [dict(r._mapping) for r in rows]
    except Exception:
        return []


def fetch_sales_history(limit: int | None = None):
    query = """
        SELECT id, product_id, created_at AS sale_date, total_amount
        FROM sales
        ORDER BY created_at ASC
    """
    rows = _run_query(query)
    if limit is not None:
        return rows[:limit]
    return rows


def fetch_product_aggregates():
    query = """
        SELECT si.product_id, date(s.created_at) AS sale_date, SUM(si.quantity) AS units_sold, SUM(si.subtotal) AS revenue
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        GROUP BY si.product_id, date(s.created_at)
        ORDER BY si.product_id, date(s.created_at) ASC
    """
    return _run_query(query)


def fetch_products():
    query = "SELECT id, name, price FROM products ORDER BY id ASC"
    return _run_query(query)


def fetch_current_stocks() -> dict[int, float]:
    """Consume the current finished-good stock maintained by the backend StockService
    (Phase 3). One batch query across all products — never recomputed from raw movements.
    Returns {product_id: stock_quantity}."""
    rows = _run_query("SELECT id AS product_id, stock_quantity FROM products")
    return {int(r["product_id"]): float(r["stock_quantity"] or 0.0) for r in rows}


def fetch_product_margins() -> dict[int, float]:
    """Consume the per-product margin already computed by the core backend at sale
    time (SalesService / AnalyticsService -> sale_items.margin, sale_items.quantity),
    in ONE batch aggregation. The AI service NEVER recomputes cost from recipes.
    Returns {product_id: average_unit_margin} over items where the backend actually
    recorded a positive margin (legacy rows carry margin=0 and are ignored)."""
    rows = _run_query(
        """
        SELECT product_id, SUM(margin) AS margin_total, SUM(quantity) AS qty_total
        FROM sale_items
        WHERE margin > 0 AND quantity > 0
        GROUP BY product_id
        """
    )
    result: dict[int, float] = {}
    for r in rows:
        qty = float(r.get("qty_total") or 0.0)
        if qty > 0:
            result[int(r["product_id"])] = float(r.get("margin_total") or 0.0) / qty
    return result


def fetch_stock_snapshot():
    query = "SELECT id, name, current_stock, minimum_stock FROM ingredients ORDER BY id ASC"
    return _run_query(query)
