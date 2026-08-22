import os
from pathlib import Path
from urllib.parse import quote_plus

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
VERSION_DIR = DATA_DIR / "v1"
CACHE_DIR = DATA_DIR / "cache"

# ── Core ERP database access (READ-ONLY) — MySQL ────────────────────────────
# Single supported engine at runtime: the backend runs on MySQL (knex/mysql2),
# this service reads the same database through SQLAlchemy + PyMySQL.
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "patisserie_erp")
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

# DATABASE_URL (if set) still takes precedence — useful for tests / custom deploys.
READ_ONLY_DB_URL = os.getenv("DATABASE_URL") or (
    f"mysql+pymysql://{DB_USER}:{quote_plus(DB_PASSWORD)}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

MODEL_VERSION = "baseline-v1"
DEFAULT_TTL_SECONDS = 300

