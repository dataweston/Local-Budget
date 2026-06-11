# Integration Contract: Local Budget ⇄ local-effort-app

> Local Budget is the **source of truth for transactions, vendors, Square
> payment data, and P&L**. The primary consumer is the **brain** (knowledge
> graph) in `local-effort-app` — anything that surfaces on WeeklyDemoPage goes
> through the brain first. WeeklyDemoPage's own planner financials
> (PlannerCard/PlannerCOGS/PlannerOverhead) are a *speculative planning tool*
> with their own database; they are intentionally **not** synced from Local
> Budget actuals today. If that ever hardens, the data must flow Local Budget
> → brain → planner, not directly.

## The API (replaces direct database access)

Versioned REST endpoints, deployed with the app. All require
`Authorization: Bearer ${INTEGRATION_API_TOKEN}` and fail closed (503) when
the token is unconfigured. They bypass session middleware by design.

| Endpoint | Purpose |
|---|---|
| `GET /api/integration/v1/transactions` | Transaction export. Filters: `from`, `to`, `classification` (effective, comma-separated), `merchant`, `format=json\|csv`, `limit`, `cursor`. Each row carries `effectiveClassification` (explicit → category default → type fallback), category/account names, and splits. |
| `GET /api/integration/v1/vendors` | Vendor spend rollups (canonical name, aliases, txCount, totalSpend, avg, first/last seen, primaryClassification). Default filter `COGS,OPERATING`. This is the feed `seed-brain.js` needs. |
| `GET /api/integration/v1/pnl?year=YYYY` | P&L using the same method as `generate-local-budget-pnl.cjs`, so both repos report identical numbers. |

Auth styles accepted: `Authorization: Bearer <token>`, `x-webhook-token`
header, or `?token=` query param.

## Known consumers in local-effort-app (as of 2026-06-11)

These currently read Local Budget's `.env` from disk and query its production
Postgres directly. They keep working, but each should migrate to the API
above so Local Budget schema migrations can't silently break them:

| Consumer | Reads | Migrate to |
|---|---|---|
| `brain-sidecar/jobs/extract_vendor_crossref.py` | raw SQL on `transactions` (date/amount/merchantName by vendor) | `/v1/transactions?merchant=…` |
| `prisma/seed-brain.js` | COGS/OPERATING transactions with merchant names (vendor seeding) | `/v1/vendors` |
| `scripts/generate-local-budget-pnl.cjs` | full transaction set + categories/splits | `/v1/pnl` |
| `backend/api/brain/squareIngest.js` | disabled — Local Budget owns Square ingest | stays disabled |

## Rules of the relationship

1. **Schema changes**: before migrating `prisma/schema.prisma` tables named
   above (`transactions`, `categories`, `transaction_splits`), check the
   consumer list. Once consumers are on the API, only the API response shapes
   are contractual — keep them backward compatible or bump `/v1` → `/v2`.
2. **Square**: ingestion lives here (sync + webhook). The brain must not
   ingest Square payments/orders directly (catalog/customers are fine — they
   are not financial records).
3. **Secrets**: consumers must never read this repo's `.env`. Give them
   `LOCAL_BUDGET_API_URL` + `LOCAL_BUDGET_API_TOKEN` env vars of their own.
4. **Classification semantics**: consumers should use
   `effectiveClassification`, not raw `classification` — raw is null for
   anything inheriting from its category default.

## Setup

1. Generate a token: `openssl rand -hex 32`.
2. Set `INTEGRATION_API_TOKEN` in Vercel env vars (and local `.env`).
3. In local-effort-app, set `LOCAL_BUDGET_API_URL=https://local-budget.vercel.app`
   and `LOCAL_BUDGET_API_TOKEN=<same token>`.
