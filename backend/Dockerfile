# --- Backend Dockerfile ---
# Multi-stage build:
#   deps: installs production npm dependencies (compiler present for native
#         addons such as sqlite3 on Debian base).
#   runtime: slim image containing only the app + production node_modules.
FROM node:18 AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:18 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY knexfile.js ./
COPY src ./src
COPY migrations ./migrations
COPY seeds ./seeds
EXPOSE 5000

# Start: apply migrations + seed demo data, then launch the API.
# The DB target is the PostgreSQL instance set via DATABASE_URL (docker-compose).
CMD ["sh", "-c", "npx knex migrate:latest && npx knex seed:run && node src/server.js"]