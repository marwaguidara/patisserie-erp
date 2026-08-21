# ERP Pâtisserie Platform

Plateforme ERP complète pour la gestion d'une pâtisserie artisanale : point de vente,
catalogue produits avec recettes, gestion des stocks matières premières, RH, commandes
fournisseurs et clients, et une couche d'intelligence artificielle pour la prévision
de la demande et l'aide à la décision.


---

## Présentation

L'application est organisée autour de trois blocs :

| Bloc | Rôle | Stack |
|------|------|-------|
| **Frontend** | Interface utilisateur | HTML / CSS / JavaScript |
| **API centrale** | Logique métier, sécurité, documentation OpenAPI | Node.js / Express |
| **AI Service** | Prévision, recommandations, détection d'anomalies | Python / FastAPI |

L'API centrale expose la documentation interactive de ses 58 endpoints sur `/docs`
(OpenAPI 3.1) et joue le rôle de passerelle sécurisée vers l'AI Service : chaque appel
`/ai/*` traverse le même contrôle d'accès que le reste de la plateforme.

La persistance est assurée par **Knex**, ce qui permet de développer sur **SQLite**
puis de basculer vers **MySQL** ou **PostgreSQL** sans réécrire une seule requête.

---

## Fonctionnalités

### Authentification
- Connexion par email / mot de passe, mots de passe hachés avec **bcrypt**.
- Jetons **JWT** signés, expiration fixée à **24 heures**.
- Endpoint `GET /api/auth/me` pour récupérer le profil courant.
- Gestion des utilisateurs réservée au rôle `ADMIN`.

### Catalogue
- Produits finis avec prix, catégorie, stock disponible.
- **Recettes produit** : chaque produit est lié à ses ingrédients et quantités requises.
- Production d'un lot (`POST /api/products/{id}/produce`) : déduit automatiquement les
  ingrédients du stock matières premières selon la recette.
- Catégories de produits gérées séparément.

### Stocks
- Ingrédients avec stock courant, seuil minimum, coût unitaire, date de péremption.
- **Mouvements de stock typés** : `IN`, `OUT`, `WASTE`, `ADJUSTMENT`.
- Alertes automatiques : **stock faible** et **péremption proche (≤ 7 jours)**.
- Historique des 20 derniers mouvements par ingrédient.
- Suppression protégée : un ingrédient utilisé dans une recette ne peut pas être supprimé.

### Ventes
- Enregistrement d'une vente multi-lignes avec décrément automatique du stock.
- Calcul du chiffre d'affaires, du **coût de revient** et de la **marge**.
- Numéro de reçu généré et **ticket de caisse imprimable en HTML**.
- Historique filtrable par période, produit ou intervalle de dates.
- Métriques agrégées par période (jour / semaine / mois).

### RH
- Profils employés liés aux comptes utilisateurs.
- **Plannings** : création et consultation des shifts.
- **Congés** : demande, auto-demande, validation/refus avec contrôle de conflit.
- **Self-service employé** : consultation de son profil, de ses heures, modification
  de son profil et changement de son propre mot de passe.

### Fournisseurs
- Fiches fournisseurs avec contact, téléphone, email, adresse.
- Détail fournisseur enrichi : ingrédients fournis et historique de commandes.
- Indicateurs de performance par fournisseur.

### Commandes
- **Commandes fournisseurs** : cycle `DRAFT → ORDERED → RECEIVED` (ou `CANCELLED`).
  La réception réapprovisionne le stock matières premières et invalide les caches IA.
- **Commandes clients spéciales** : cycle `PENDING → IN_PRODUCTION → READY → DELIVERED`,
  prix total recalculé côté serveur depuis le catalogue.
- Édition et suppression restreintes aux statuts éditables (`DRAFT` / `PENDING`).

### IA & Analytics
Quatre modules exposés par l'AI Service et consommés via le proxy `/ai/*` :

| Module | Endpoint | Description |
|--------|----------|-------------|
| Forecast | `GET /ai/forecast` | Prévision de la demande par produit, avec niveau de confiance et version de modèle |
| Recommandations | `GET /ai/production-recommendations` | Quantité à produire et justification |
| Anomalies | `GET /ai/anomalies` | Détection d'anomalies orientées stock |
| Segmentation | `GET /ai/segmentation` | Segmentation produits pour le pricing |
| Insights | `GET /ai/insights` | Insights business consolidés |

- Pipeline **ETL** (`POST /ai/etl/run`) qui alimente le dataset historique.
- **Cache intelligent** clé sur `(endpoint, product_id, horizon, model_version)`,
  invalidé après un run ETL, une réception de commande ou une production.
- **Dashboard stratégique** (`GET /api/dashboard/summary`, rôle `ADMIN`) : agrège les
  KPIs métier et les sorties IA sans jamais recalculer, avec cache mémoire de 5 minutes.
- Export consolidé (`GET /api/analytics/export`) du jeu de données historique.

### Audit
- Chaque action sensible est journalisée : connexions, créations/modifications/
  suppressions, mouvements de stock, réceptions de commande, validations de congé…
- Consultation paginée avec filtres (`action`, `entity_type`, `user_id`, dates).
- Accès strictement réservé au rôle `ADMIN`.

---

## Architecture

```
Frontend
   ↓
Express API        ← /docs (OpenAPI 3.1 + Swagger UI)
   ↓                      ↘ proxy sécurisé /ai/*
Knex                          ↘
   ↓                        FastAPI (scikit-learn)
SQLite / MySQL                    ↘
                                Modèles ML / Cache
```

Le proxy inverse `/ai/*` reproduit côté Express le mapping appliqué par nginx en
production (`/ai/*` → `http://ai-service:8000/*`). Le navigateur n'appelle donc jamais
l'AI Service directement et ne connaît ni son hôte ni son port.


---

## Technologies

### API centrale (`backend/`)

| Technologie | Usage |
|---|---|
| Node.js 18 / Express 5 | Framework HTTP |
| Knex 3 | Migrations, seeds, requêtes SQL |
| SQLite 3 | Base de développement et base de test (en mémoire) |
| MySQL 2 | Pilote prêt pour la bascule MySQL / XAMPP |
| pg | Pilote PostgreSQL pour l'environnement de production |
| jsonwebtoken / bcryptjs | Authentification JWT et hachage des mots de passe |
| Zod 4 | Validation des payloads (schémas déclaratifs) |
| Helmet 8 | En-têtes de sécurité HTTP |
| express-rate-limit | Limitation du débit par zone |
| swagger-ui-express / yamljs | Documentation OpenAPI 3.1 interactive |
| Jest + Supertest | Tests unitaires et d'intégration |
| Playwright | Tests end-to-end navigateur |

### AI Service (`ai-service/`)

| Technologie | Usage |
|---|---|
| Python / FastAPI | API des modèles |
| Uvicorn | Serveur ASGI |
| scikit-learn / joblib | Entraînement et chargement des modèles |
| pandas / pyarrow | Préparation des données |
| SQLAlchemy / psycopg | Accès base de données |
| pytest | Tests du service |

---

## Structure du projet

```
summer/
├── backend/
│   ├── src/
│   │   ├── app.js              # Configuration Express et montage des routes
│   │   ├── server.js           # Point d'entrée (port 5000)
│   │   ├── db/                 # Connexion base de données
│   │   ├── docs/               # Intégration Swagger UI
│   │   ├── middleware/         # auth, validate, security, errorHandler, auditHelper
│   │   ├── routes/             # 13 routeurs REST
│   │   ├── services/           # Logique métier (ventes, stocks, commandes…)
│   │   ├── utils/              # AppError, asyncHandler
│   │   └── validators/         # Schémas Zod
│   ├── migrations/             # Migrations Knex
│   ├── seeds/                  # Données de démonstration
│   ├── tests/                  # 27 suites Jest + scénarios Playwright
│   └── knexfile.js             # Config SQLite / MySQL / PostgreSQL
├── ai-service/
│   ├── app/                    # main.py, forecasting, anomalies, segmentation…
│   ├── models/                 # Modèles entraînés
│   ├── data/                   # Dataset historique
│   └── tests/                  # Tests pytest
├── frontend/                   # Interface HTML/CSS/JS
└── docs/
    └── openapi.yaml            # Spécification OpenAPI 3.1 (source unique)
```


---

## Sécurité

| Mécanisme | Détail |
|---|---|
| **JWT Bearer** | Signature et expiration 24 h ; jeton requis sur toutes les routes protégées |
| **RBAC par rôles** | 5 rôles : `ADMIN`, `PRODUCTION`, `CASHIER`, `STOCK`, `EMPLOYEE` |
| **Permissions fines** | Contrôle par capability : `crud_employee`, `approve_leave`, `view_hours`, `view_schedule`, `create_schedule`, `view_leave`, `create_leave`, `view_profile` |
| **Validation Zod** | Schémas dédiés par endpoint, rejet explicite des payloads invalides |
| **Helmet** | Protection XSS, clickjacking (`X-Frame-Options`), sniffing MIME |
| **Rate limiting** | 3 zones : auth `100 req / 15 min`, IA `200 req / 15 min`, API publique `500 req / 15 min` |
| **Audit Logs** | Traçabilité complète des actions sensibles |
| **Moindre privilège IA** | Dashboard et export analytics réservés à `ADMIN` ; segmentation également |

Exemple de cloisonnement IA appliqué au proxy :

| Endpoint IA | ADMIN | PRODUCTION | STOCK | CASHIER | EMPLOYEE |
|---|---|---|---|---|---|
| `/ai/forecast` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `/ai/production-recommendations` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/ai/anomalies` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `/ai/segmentation` · `/ai/insights` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/ai/etl/run` | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## Installation

Prérequis : **Node.js 18+** et **Python 3.11+**.

### Backend
```bash
cd backend
npm install
npm run migrate
npm run seed
npm start          # http://localhost:5000
```

### Frontend
Le frontend est servi directement par l'API Express (fichiers statiques) : aucune
étape de build n'est nécessaire. Un `Dockerfile` avec `nginx.conf` est également
fourni pour un déploiement conteneurisé.

### Base de données
Par défaut, Knex utilise **SQLite** (`backend/dev.sqlite3`) — aucun serveur requis.

Bascule vers **MySQL** (XAMPP ou serveur local), via variables d'environnement :

```powershell
# Windows PowerShell
$env:DB_CLIENT='mysql2'
$env:DB_HOST='127.0.0.1'
$env:DB_PORT='3306'
$env:DB_USER='root'
$env:DB_PASSWORD='secret'
$env:DB_NAME='patisserie_erp'
```

```bash
# Linux / macOS
export DB_CLIENT=mysql2 DB_HOST=127.0.0.1 DB_PORT=3306
export DB_USER=root DB_PASSWORD=secret DB_NAME=patisserie_erp
```

Puis relancer `npm run migrate` et `npm run seed` : les mêmes migrations s'appliquent.
La configuration PostgreSQL est déjà prévue pour la production via `DATABASE_URL`.
Les tests utilisent une base SQLite en mémoire, sans aucune configuration.

### IA
```bash
cd ai-service
python -m venv .venv
.\.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

L'API centrale proxifie ensuite automatiquement `/ai/*` vers ce service (cible
configurable via `AI_PROXY_HOST` / `AI_PROXY_PORT`).


---

## Comptes de démonstration

Comptes réellement présents dans le seed (`backend/seeds/01_initial_seed.js`).
Mot de passe commun : **`password123`**

| Rôle | Email | Nom |
|------|-------|-----|
| `ADMIN` | `admin@bakery.com` | Admin Bakery |
| `PRODUCTION` | `production@bakery.com` | Chef Pâtissier |
| `CASHIER` | `cashier@bakery.com` | Vendeuse Caissière |
| `STOCK` | `stock@bakery.com` | Gestionnaire Stock |
| `EMPLOYEE` | `employe@bakery.com` | Employé Test |

Exemple de connexion :

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@bakery.com", "password": "password123"}'
```

---

## Tests

### Jest — tests unitaires & intégration

27 suites, 286 tests, exécutés séquentiellement sur une base SQLite en mémoire
(migrations et seeds rejoués avant chaque suite) :

```bash
cd backend
npm test
```

Couverture vérifiée : flux d'authentification, validation des payloads, matrice RBAC,
cycle complet ventes/marge, gardes-fous fournisseurs et commandes, congés et
self-service employé, dashboard, export analytics, audit logs, concurrence,
synchronisation du schéma et gestion centralisée des erreurs.

### Playwright — tests end-to-end

Scénarios navigateur (connexion, parcours caisse) contre l'application réelle :

```bash
cd backend
npm run test:playwright
```

---

## API

Documentation interactive **Swagger UI** :

```
http://localhost:5000/docs
```

| Ressource | URL |
|---|---|
| Interface Swagger UI | `GET /docs` |
| Spécification OpenAPI 3.1 (YAML) | `GET /docs/openapi.yaml` |
| Même document en JSON | `GET /docs/swagger.json` |

Contenu documenté : **58 chemins**, **85 opérations**, **29 schémas**, matrice de
rôles par endpoint, exemples de payloads et codes de réponse normalisés.

---

## Captures d'écran

> Emplacements prêts à recevoir les captures. Déposer les images dans `docs/screenshots/`.

### Landing Page
![Landing Page](docs/screenshots/landing.png)

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### RH
![RH](docs/screenshots/rh.png)

### IA
![IA](docs/screenshots/ia.png)

---

## Points forts

- **Socle de sécurité complet** : JWT + RBAC à deux niveaux (rôles *et* permissions),
  validation systématique des entrées, en-têtes durcis et rate limiting zoné.
- **Traçabilité de bout en bout** grâce aux audit logs couvrant toutes les actions sensibles.
- **Architecture découplée** : l'IA est un service indépendant, accessible uniquement
  via un proxy authentifié — le client ne voit jamais le service Python.
- **Portabilité de la donnée** : un seul jeu de migrations Knex pour SQLite, MySQL et PostgreSQL.
- **Recettes produit** : la production décrémente automatiquement les ingrédients,
  ce qui fiabilise le calcul de la marge réelle.
- **Performance maîtrisée** : caches ciblés (résultats IA, dashboard), invalidés
  précisément quand les données sources changent.
- **Qualité outillée** : 286 tests automatisés et une spécification OpenAPI 3.1 maintenue
  comme contrat unique entre le front, l'API et l'IA.
- **Documentation vivante** : Swagger UI généré depuis la spécification, aligné sur le code.

---

## Perspectives d'amélioration

- Industrialiser l'entraînement des modèles (ré-entraînement planifié, versionnement).
- Étendre la prévision à une granularité hebdomadaire et saisonnière.
- Ajouter des notifications temps réel (WebSocket / Server-Sent Events).
- Enrichir le module RH : paie, pointage horaire détaillé, gestion des compétences.
- Tableaux de bord supplémentaires par rôle (caisse, production, stock).
- Mettre en place une CI/CD complète (lint, tests, build et déploiement des images Docker).
- Ajouter une couche de tests de charge sur les endpoints les plus sollicités.
- Internationaliser l'interface (FR / EN).

---

## Auteur

**Marwa Guidara**

Projet de Fin d'Études 2026

