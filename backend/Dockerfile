# --- Backend Dockerfile ---
# Multi-stage build:
#   deps: installs production npm dependencies.
#         No compiler toolchain required — no native addon is needed at
#         runtime (MySQL access goes through the pure-JS-friendly mysql2
#         driver; sqlite3 remains available only for the Jest test env).
#   runtime: slim image containing only the app + production node_modules.
#
# Build context = repo root (../.. from infra/), set in infra/docker-compose.yml.
# All paths below are relative to that root so that docs/openapi.yaml
# (single source of truth at the repo root) can be copied alongside the app.
FROM node:18 AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:18 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/knexfile.js ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/seeds ./seeds
COPY docs ./docs
EXPOSE 5000

# Start: apply migrations + seed demo data, then launch the API.
# The DB target is the MySQL instance configured via the DB_* variables
# provided by docker-compose (service "mysql", healthcheck mysqladmin ping).
CMD ["sh", "-c", "npx knex migrate:latest && npx knex seed:run && node src/server.js"]
