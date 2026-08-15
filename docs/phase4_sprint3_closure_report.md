# Phase 4 — Sprint 3 — Rapport de clôture

**Scope** : Détection d'anomalies IA (`/ai/anomalies`) + branchement sur le
système de notification **existant** du dashboard (pas de système parallèle).
RBAC ADMIN/STOCK. Preuve E2E sur l'état réel des données.

---

## 1. Preuve E2E (via `Invoke-RestMethod`, aucune donnée modifiée)

### 1.1 — GET `/ai/anomalies` en tant que ADMIN → **200** (JSON brut)

```
$token = <login admin@bakery.com>
GET http://127.0.0.1:5000/ai/anomalies  (Authorization: Bearer $token)
```

```json
{
  "anomalies": [],
  "excluded_products": [33],
  "status": "ok"
}
```

### 1.2 — GET `/ai/anomalies` en tant que PRODUCTION → **403** (refus)

Statut HTTP réel obtenu : **403** avec le corps JSON :

```json
{
  "error": "Access denied. Requires one of roles: [ADMIN, STOCK]"
}
```

→ Confirme que le backend reste la *source de vérité* du contrôle de rôle,
indépendamment de l'UI.

### 1.3 — Produit `insufficient_data` (33, « Pain au Chocolat », 1 jour d'historique)

Contrôle programmatique sur la réponse ADMIN :

```
product 33 in excluded_products: True
product 33 in anomalies: False
excluded_products = [33]
anomaly product_ids = []
CHECK OK: 33 excluded, NOT an anomaly
```

→ Un produit neuf (historique < 14 jours) est **exclu** de la détection et listé
dans `excluded_products` ; il ne peut **jamais** apparaître dans `anomalies`.

---

## 2. Checklist Definition of Done

| # | Critère | Statut | Preuve |
|---|---------|--------|--------|
| 1 | **Anomalies réelles, pas de mock** — le endpoint calcule la détection sur les données réelles (moyenne mobile 7j + écart-type, méthode simple), jamais de liste codée en dur | ✅ | `app/anomalies.py` (`detect_sales_drop_anomalies`) ; JSON brut §1.1 ; tests unitaires §6 |
| 2 | **Produits neufs exclus** — produits avec < 14 jours d'historique → `excluded_products`, jamais dans `anomalies` | ✅ | `app/anomalies.py` (`_excluded_products`, `MIN_HISTORY_DAYS=14`) ; preuve §1.3 (produit 33) ; test `test_insufficient_data_product_excluded` |
| 3 | **Rôles vérifiés** — ADMIN (et STOCK) autorisés, autres rôles refusés | ✅ | Backend `backend/src/app.js` `aiRouter.get('/anomalies', requireRole(['ADMIN','STOCK']))` ; preuves §1.1 (ADMIN → 200) & §1.2 (PRODUCTION → 403) |
| 4 | **Notification réutilisée, pas dupliquée** — anomalies affichées via le composant d'alerte **existant** du dashboard | ✅ | Frontend : la pill `#badge-anomalies` est un **enfant** de `#alerts-summary-badge` existant et réutilise la classe `.alert-pill` ; toast via `showToast()` (déjà utilisé par le module Commandes) ; navigation `switchToTab()` refactorisée sans duplication. Vérifié par `backend/frontend_anomalies_evidence.js` (REUSE: child=true, .alert-pill=true) |
| 5 | **Aucune régression** | ✅ | `test_anomalies.py` : 5 passed ; `node --check frontend/app.js` OK ; scénarios Playwright (appel réel, rendu, RBAC) verts ; aucun changement du socle AI/forecast cassé |

---

## 3. Fichiers livrés

**Backend (reverse-proxy RBAC)**
- `backend/src/app.js` — route `/ai/anomalies` protégée `requireRole(['ADMIN','STOCK'])`.

**AI Service (détection)**
- `ai-service/app/anomalies.py` — détection `sales_drop` (moyenne mobile 7j – k·écart-type), exclusion des produits neufs, cache TTL 1h, contrat JSON.
- `ai-service/app/main.py` — `/anomalies` : `501` → `200` (erreur 500 contractuelle en repli).
- `ai-service/tests/test_anomalies.py` — 5 tests unitaires.

> `stock_discrepancy` : **reporté**. Une recherche ciblée dans le backend n'a trouvé
> aucun endpoint exposant une comparaison stock théorique vs inventaire réel ; le
> service IA ne recalcule pas le stock (§ contrainte « ne pas recalculer une métrique
> déjà exposée »). Aucune anomalie de ce type n'est donc émise pour l'instant.

**Frontend (réutilisation du système de notification existant)**
- `frontend/index.html` — pill `#badge-anomalies` dans `#alerts-summary-badge` + panneau `#anomalies-panel`.
- `frontend/app.js` — `loadAnomalies()`, `renderAnomalies()`, `openConcernedScreen()` (lien → écran produit/stock selon rôle), `switchToTab()` (refactor de `initTabs`), `updateAlertsBadgeVisibility()`, hooks de chargement.
- `frontend/styles.css` — style `.alert-pill.anomaly` + `.anomalies-panel` (conventions existantes).

**Évidences**
- `backend/frontend_anomalies_evidence.js` — capture réseau réelle `/ai/anomalies` + rendu DOM + RBAC + réutilisation (Playwright).
- `frontend-anomalies-real.png`, `frontend-anomalies-simulated.png`, `frontend-anomalies-navigated.png`, `frontend-anomalies-stock.png`.

---

## 4. Résultats des tests (à date)

```
ai-service/tests/test_anomalies.py .....  [100%]
5 passed in 1.52s

node --check frontend/app.js            -> syntax OK
```

- Appel réel réseau : `GET /ai/anomalies` → HTTP 200 (`{"anomalies":[],"excluded_products":[33],"status":"ok"}`).
- Rendu anomalies (scénario UI démo) : pill + panneau affichés, nom produit résolu
  dynamiquement depuis `productsList` (aucun id codé en dur).
- Lien « Voir l'écran → » : ADMIN → onglet `catalog` (+ filtre produit) ; STOCK (pas d'onglet
  catalogue) → onglet `forecast` (écran produit accessible). `stock_discrepancy` → `ingredients`.

---

## 5. Décisions / limites assumées

- Le seuil de détection reste **statistique simple** (moyenne mobile + écart-type), comme
  demandé — pas de méthode complexe type Isolation Forest (volume de données trop faible).
- Cache `/anomalies` TTL **~1h** (pas de rafraîchissement temps réel : non requis).
- `stock_discrepancy` **reporté** faute d'endpoint backend exposant l'inventaire réel.
- Comportement « anomalie active » probable : `anomalies: []` sur l'état actuel (produit 32 finit
  sur un *pic*, pas une baisse) — c'est un résultat valide, non un échec de détection.

---

## 6. Statut final

**Sprint 3 — TERMINÉ (vert).** Preuve E2E complète : détection réelle, exclusions produits
neufs, contrôle de rôles ADMIN/STOCK, réutilisation du système de notification existant,
aucune régression.