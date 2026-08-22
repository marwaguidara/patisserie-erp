# AI Service

This service provides the Phase 4 walking skeleton for the bakery intelligence layer.

## Read-only database access

The service connects to the production MySQL database in read-only mode through the `DATABASE_URL` configured in Docker Compose. It never writes to the core database.

## Forecast contract

The forecast endpoint returns:

{
  "value": 12.5,
  "confidence": {
    "level": "haute|moyenne|faible",
    "interval": [min, max]
  },
  "status": "ok|insufficient_data"
}

## ETL

The ETL job persists exported sales history to `ai-service/data/v1/sales_history.parquet` and `metadata.json`.
