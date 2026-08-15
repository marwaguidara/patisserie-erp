"""
Segmentation produit et conseils (Sprint 3 / Sprint 4) pour `/segmentation` et `/insights`.

Regle (simple, explicite, pas de modele complexe) :
  - quadrant = marge x frequence de vente, seuils = MEDIANE des produits actifs
    eligibles (historique suffisant, hors insufficient_data).
  - produits en insufficient_data (< MIN_HISTORY_DAYS jours de vente) ->
    quadrant "en_observation", jamais classes ailleurs.

La marge est CONSOMMEE via app.db.fetch_product_margins() qui lit
sale_items.margin deja calcule par le backend au moment de la vente (mecanisme
batch du Sprint 2 / analytics). Le service IA ne recalcule jamais le cout depuis
la recette. La frequence de vente = moyenne journaliere d'unites vendues,
agregee depuis les ventes reelles (etl.build_sales_history_dataset).

CAS LIMITE (valide, documente) : avec un seul produit eligible (32), la mediane =
sa propre valeur -> avec le seuil ">= mediane" il est classe "star" (marge ET
frequence >= mediane). C'est le comportement attendu vu le volume de donnees.

Cache TTL 24h (la segmentation evolue lentement). Invalidation sur changement de
prix/recette : reutilise le point d'invalidation cache existant (/cache/invalidate)
pour une purge manuelle. Aucun hook automatique backend -> prix/recette vers l'IA :
absence signalee (non construite dans ce sprint).
"""
from __future__ import annotations

import json
from statistics import median
from typing import Any

import pandas as pd

from app.cache import get_cached_result, set_cached_result, invalidate_cache
from app.db import fetch_products, fetch_product_margins
from app.etl import build_sales_history_dataset

ENDPOINT_SEG = "segmentation"
ENDPOINT_INS = "insights"
PERIOD = "all"
CACHE_TTL_SECONDS = 86400  # 24h

MIN_HISTORY_DAYS = 14  # meme regle que forecast / anomalies

QUADRANTS = {"star", "cash_cow", "dormant", "to_remove", "en_observation"}


def _history_summary(df: pd.DataFrame) -> dict[int, dict[str, Any]]:
    """Per-product {n_days, sales_frequency} from the real sales history."""
    if df is None or df.empty:
        return {}
    g = df.copy()
    g["units_sold"] = pd.to_numeric(g["units_sold"], errors="coerce").fillna(0.0)
    summary: dict[int, dict[str, Any]] = {}
    for pid, grp in g.groupby("product_id"):
        units = grp["units_sold"].astype(float)
        n_days = int(grp.shape[0])
        freq = float(units.sum() / n_days) if n_days > 0 else 0.0
        summary[int(pid)] = {"n_days": n_days, "sales_frequency": round(freq, 2)}
    return summary


def _classify(eligible: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Classify eligible products by margin x frequency vs the median thresholds."""
    margin_median = median([e["margin"] for e in eligible])
    freq_median = median([e["sales_frequency"] for e in eligible])
    segments: list[dict[str, Any]] = []
    for e in eligible:
        high_margin = e["margin"] >= margin_median
        high_freq = e["sales_frequency"] >= freq_median
        if high_margin and high_freq:
            quadrant = "star"
        elif high_margin and not high_freq:
            quadrant = "cash_cow"
        elif not high_margin and high_freq:
            quadrant = "to_remove"
        else:
            quadrant = "dormant"
        level = "haute" if e["n_days"] >= 30 else "moyenne"
        segments.append({
            "product_id": e["product_id"],
            "product_name": e["product_name"],
            "quadrant": quadrant,
            "margin": round(e["margin"], 2),
            "sales_frequency": round(e["sales_frequency"], 2),
            "confidence": {"level": level},
        })
    return segments


def build_segments(df: pd.DataFrame, products: list[dict], margins: dict[int, float]) -> list[dict[str, Any]]:
    """Return the /segmentation `segments` list (exact contract shape)."""
    history = _history_summary(df)
    segments: list[dict[str, Any]] = []
    eligible: list[dict[str, Any]] = []

    for p in products or []:
        pid = int(p["id"])
        h = history.get(pid, {"n_days": 0, "sales_frequency": 0.0})
        margin = float(margins.get(pid, 0.0))
        if h["n_days"] < MIN_HISTORY_DAYS:
            segments.append({
                "product_id": pid,
                "product_name": p["name"],
                "quadrant": "en_observation",
                "margin": round(margin, 2),
                "sales_frequency": round(h["sales_frequency"], 2),
                "confidence": {"level": "faible"},
            })
        else:
            eligible.append({
                "product_id": pid,
                "product_name": p["name"],
                "margin": margin,
                "sales_frequency": h["sales_frequency"],
                "n_days": h["n_days"],
            })

    if eligible:
        segments.extend(_classify(eligible))

    segments.sort(key=lambda s: s["product_id"])
    return segments


def build_insights(segments: list[dict[str, Any]]) -> dict[str, Any]:
    """Return the /insights contract from the segments (business language only)."""
    insights: list[dict[str, Any]] = []
    for s in segments:
        if s["quadrant"] == "en_observation":
            continue  # pas assez de donnees pour conseiller
        pid = s["product_id"]
        name = s["product_name"]
        level = s["confidence"]["level"]
        if s["quadrant"] == "star":
            insights.append({
                "product_id": pid,
                "type": "highlight_profitable",
                "message": f"Le {name} est tres rentable et tres demande : mettez-le en avant dans la vitrine et vos promotions.",
                "confidence": {"level": level},
            })
        elif s["quadrant"] == "cash_cow":
            insights.append({
                "product_id": pid,
                "type": "highlight_profitable",
                "message": f"Le {name} degage une bonne marge en permanence : gardez-le au premier plan de votre offre.",
                "confidence": {"level": level},
            })
        elif s["quadrant"] == "dormant":
            insights.append({
                "product_id": pid,
                "type": "low_margin_alert",
                "message": f"Le {name} a une marge faible et se vend peu : surveillez-le, quelques actions suffisent peut-etre a le relancer.",
                "confidence": {"level": level},
            })
        elif s["quadrant"] == "to_remove":
            insights.append({
                "product_id": pid,
                "type": "price_adjustment",
                "message": f"Le {name} se vend regulierement mais avec une marge faible : ajustez son prix de vente ou simplifiez sa recette.",
                "confidence": {"level": level},
            })
    return {"insights": insights, "status": "ok"}


def get_segmentation(df: pd.DataFrame | None = None,
                     products: list[dict] | None = None,
                     margins: dict[int, float] | None = None) -> dict[str, Any]:
    """Entry point for /segmentation. Real path (df=None) fetches data and caches
    TTL 24h; test path (df given) bypasses the cache entirely."""
    if df is None:
        cached = get_cached_result(ENDPOINT_SEG, 0, PERIOD, ttl_seconds=CACHE_TTL_SECONDS)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                invalidate_cache(ENDPOINT_SEG, 0, PERIOD)
        df = build_sales_history_dataset()
        products = fetch_products()
        margins = fetch_product_margins()
        report = {"segments": build_segments(df, products, margins), "status": "ok"}
        set_cached_result(ENDPOINT_SEG, 0, PERIOD, report, ttl_seconds=CACHE_TTL_SECONDS)
        return report
    return {"segments": build_segments(df, products or [], margins or {}), "status": "ok"}


def get_insights(df: pd.DataFrame | None = None,
                 products: list[dict] | None = None,
                 margins: dict[int, float] | None = None) -> dict[str, Any]:
    """Entry point for /insights — derived from the segmentation result."""
    if df is None:
        seg = get_segmentation()  # real data + segmentation cache
        cached = get_cached_result(ENDPOINT_INS, 0, PERIOD, ttl_seconds=CACHE_TTL_SECONDS)
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                invalidate_cache(ENDPOINT_INS, 0, PERIOD)
        report = build_insights(seg["segments"])
        set_cached_result(ENDPOINT_INS, 0, PERIOD, report, ttl_seconds=CACHE_TTL_SECONDS)
        return report
    seg = get_segmentation(df=df, products=products, margins=margins)
    return build_insights(seg["segments"])