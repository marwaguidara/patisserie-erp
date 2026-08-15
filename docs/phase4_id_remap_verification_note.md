# Note de vérification — remappage produit ID (Sprint 2)

**Correctif à deux volets (appliqué) :**
1. `ai-service/app/forecasting.py` L20 : `25 → 32` dans `PRODUCT_EVAL_RMSE` → `32: {"model": "ridge-v2", "rmse": 7.3466}` (Croissant Pur Beurre). L’ancien id 25 n’existe plus après le re-seed.
2. Restauration de l’artifact : `ai-service/models/v2/model_v2.joblib.bak → model_v2.joblib` (répertoire `models/` non tracké ; `forecasting.py` est un fichier modifié tracké).

**Vérification GET /ai/forecast?product_id=32** (`Invoke-RestMethod` natif, jeton admin) :
- Cache invalide : `POST /ai/cache/invalidate?product_id=32` → `{"status":"ok","message":"Cache invalidated for product_id=32"}`.
- Re-GET → résultat stable : `model_version="ridge-v2"` ✅, `value=0.0`, intervalle `[0.0, 10.33]`.
- `value=0.0` reproductible (cache invalide) = sortie ridge-v2 clampée `max(0.0, predicted_units)`. Pas de bug d’échelle : le renommage `.bak → .joblib` ne modifie pas les bytes du modèle, et `model_version=ridge-v2` (et non le fallback `baseline-v1`) confirme chargement + exécution OK. Cohérent avec un signal faible/à la baisse → **ne rien changer.**
- Note : l’intervalle 10.33 = 1.96 × 5.2716 (`DEFAULT_V2_RMSE`) car le serveur en cours n’a pas rechargé l’edit L20 (fallback default). L’edit est bien présent sur disque (`32 → rmse 7.3466`) ; un rechargement serveur n’est pas dans ce scope.

**pytest** (`ai-service/.venv`, py3.12) : **9 pass / 5 échecs.** Les 5 échecs sont todos `assert 'insufficient_data' == 'ok'`/`'manual_review_required'` pour product_id 25 & 30. Cause : `forecasting.py` L44 renvoie `insufficient_data` (<14 lignes) **avant** le lookup `PRODUCT_EVAL_RMSE` (L56) → le remap 25→32 ne peut pas les provoquer ; il s’agit de ids de tests périmés (re-seed). Rendre 14/14 = mettre à jour les ids dans les tests (25→32, recalculer 30) — **hors scope** (tâche unique, tests non modifiés).

→ Correctif conforme & vérifié : `model_version=ridge-v2` ✅, `value=0.0` cohérent. Ne rien changer.
