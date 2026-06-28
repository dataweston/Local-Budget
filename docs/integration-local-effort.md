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
| `GET /api/integration/v1/transactions` | Transaction export. Filters: `from`, `to` (on date), `updatedSince` (ISO timestamp — incremental sync that re-reads corrected rows), `classification` (effective, comma-separated), `direction` (`outflow\|inflow\|transfer`, comma-separated), `merchant`, `format=json\|csv`, `limit`, `cursor`. Each row carries `updatedAt`, `effectiveClassification` (explicit → category default → type fallback), `direction`, `categoryId`+`categoryName`, `customerName`+`customerEmail` (resolved Square customer — the income counterparty), account names, and splits. |
| `GET /api/integration/v1/vendors` | Vendor spend rollups (stable `vendorId`, canonical name, `aliases` incl. raw bank descriptors, `rawNames`, txCount, totalSpend, avg, first/last seen, primaryClassification). Default filter `COGS,OPERATING`. This is the feed `seed-brain.js` needs. Resolve by `vendorId`, not name. |
| `GET /api/integration/v1/items` | Line-item export for recipe/margin costing. One row per `LineItem` with parent date/merchant/customer, `quantity`, `unitPrice`, `totalPrice`, `unitOfMeasure`, `lineType`, `vendorId`/`itemId`. Filters: `from`, `to`, `updatedSince`, `lineType` (default `ITEM`), `source` (`square\|receipt`), `limit`, `cursor`. |
| `GET /api/integration/v1/price-drift` | Per-item unit-price trend for price-drift / inflation inferences and recipe re-costing. Each row: `itemId`, `itemName`, `unitOfMeasure`, `observations`, first/last/min/max unit price, `pctChange`, and the time-ordered `points`. Filters: `from`, `to`, `item`, `minPoints` (default 2). Sorted by biggest mover. |
| `GET /api/integration/v1/pnl?year=YYYY` | P&L using the same method as `generate-local-budget-pnl.cjs`, so both repos report identical numbers. |

### Income counterparty (resolves the brain's "415 blank INCOME rows" gap)

Square income rows now carry a resolved customer: `merchantName` is set to the
customer/company name (or buyer email), `customerName`/`customerEmail` expose the
resolved [Square] `SquareCustomer`, and `squareCustomerId` links the row. Guest /
quick-sale payments have no customer and fall back to a channel label
(`Square Invoice` / `Square Online` / `Square Payment`). Non-Square income
(Zelle, farmers market, catering) still needs a payer captured in Local Budget —
tracked separately.

### Stable vendor identity (resolves the brain's bank-truncation splits)

Each transaction now resolves to a canonical `Vendor` row and exposes a stable
`vendorId` (+ `vendorName`) on `/v1/transactions`. The resolver collapses bank
descriptor variants — store-number/suffix noise *and* field truncation
("Eastside Food Cooperati" → "Eastside Food Cooperative") and the alias map
("COSTCO WHSE" → "Costco") — onto one id, recording every raw variant in the
vendor's `aliases[]`. Consumers should resolve by `vendorId` instead of
fuzzy-matching `merchantName`. Populate/relink history with
`npm run vendors:populate:apply`; new Square income is linked at ingest.

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

## Feeding the brain's `payment.completed` inference jobs

The brain's inference engine (`backend/api/brain/inferenceEngine.js`) has three
vendor jobs — PREFERS, AVOIDS, PRICE_DRIFT — that read `payment.completed`
ledger events. They produce nothing until those events exist, and the brain
deliberately delegated vendor payments to Local Budget (this repo also touches
bank accounts Square never sees).

**Resolution (Weston, 2026-06-14): Option A — Local Budget exports vendor
*outflows* only.** `payment.completed` = "we paid a vendor $X". Square *revenue*
stays the brain's direct `order.placed` sync (the 02:30 UTC job), so the two
sets are disjoint and nothing double-counts. Do **not** export Square revenue as
`payment.completed`.

**Delivery: pull.** The brain runs a nightly GET against
`/api/integration/v1/transactions?direction=outflow&from=<cursor>` and writes
one `payment.completed` LedgerEvent per row. This keeps Local Budget a clean
data source; the ledger-write logic lives in the brain.

Mapping a transaction row → the brain's `payment.completed` payload:

| Brain field | Local Budget source |
|---|---|
| `source` | constant `"local_budget"` |
| `sourceId` | row `id` (stable cuid — brain dedupes on `eventType+source+sourceId`) |
| `occurredAt` | row `date` |
| `payload.merchantName` | row `merchantName` (**must match a Vendor alias** — reconcile via `/v1/vendors` `rawNames` first, or inferences silently write nothing) |
| `payload.amountCents` | `Math.round(Math.abs(amount) * 100)` |
| `payload.direction` | row `direction` (always `outflow` for this feed) |

Reconcile merchant names against the brain's 149 Vendor aliases before bulk
ingest — name mismatches are the #1 reason inferences stay empty. The `/v1/vendors`
`rawNames` array is the basis for that reconciliation.

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
