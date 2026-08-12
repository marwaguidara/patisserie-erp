import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
VERSION_DIR = DATA_DIR / "v1"
CACHE_DIR = DATA_DIR / "cache"

DB_DRIVER = os.getenv("DB_DRIVER", "postgres").lower()
DB_HOST = os.getenv("DB_HOST", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "bakery_db")
DB_USER = os.getenv("DB_USER", "bakery_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "bakery_password")
LOCAL_SQLITE_PATH = os.getenv("LOCAL_SQLITE_PATH", str(Path(__file__).resolve().parents[2] / "backend" / "dev.sqlite3"))

if os.getenv("DATABASE_URL"):
    READ_ONLY_DB_URL = os.getenv("DATABASE_URL")
elif DB_DRIVER == "sqlite":
    READ_ONLY_DB_URL = f"sqlite:///{LOCAL_SQLITE_PATH}"
else:
    READ_ONLY_DB_URL = (
        f"postgresql+psycopg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    )

MODEL_VERSION = "baseline-v1"
DEFAULT_TTL_SECONDS = 300
