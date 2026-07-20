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
| `GET /api/integration/v1/cashflow-actuals?from=YYYY-MM-DD&to=YYYY-MM-DD&grain=month` | Posted, split-aware monthly actuals. `to` is exclusive. Contract version 1; method `cashflow-actuals-v1`; USD amounts are integer cents. Includes labor, excluded and unresolved buckets plus freshness/quality metadata. |
| `GET /api/integration/v1/transactions` | Transaction export. Filters: `from`, `to` (on date), `updatedSince` (ISO timestamp), `classification` (effective, comma-separated), `direction` (`outflow\|inflow\|transfer`, comma-separated), `merchant`, `format=json\|csv`, `limit`, `cursor`. Each row carries integer `amountCents`, `updatedAt`, `effectiveClassification`, cashflow bucket fields, stable category/vendor/Square customer identity where available, customer name/email, account names, and detailed splits. The opaque cursor is ordered by `(updatedAt,id)`, so corrected history is replayed; legacy id-only cursors remain accepted. |
| `GET /api/integration/v1/vendors` | Vendor spend rollups (stable `vendorId`, canonical name, `aliases` incl. raw bank descriptors, `rawNames`, txCount, totalSpend, avg, first/last seen, primaryClassification). Default filter `COGS,OPERATING`. This is the feed `seed-brain.js` needs. Resolve by `vendorId`, not name. |
| `GET /api/integration/v1/items` | Line-item export for recipe/margin costing. One row per `LineItem` with parent date/merchant/customer, `quantity`, `unitPrice`, `totalPrice`, `unitOfMeasure`, `lineType`, `vendorId`/`itemId`. Filters: `from`, `to`, `updatedSince`, `lineType` (default `ITEM`), `source` (`square\|receipt`), `limit`, `cursor`. |
| `GET /api/integration/v1/price-drift` | Per-item unit-price trend for price-drift / inflation inferences and recipe re-costing. Each row: `itemId`, `itemName`, `unitOfMeasure`, `observations`, first/last/min/max unit price, `pctChange`, and the time-ordered `points`. Filters: `from`, `to`, `item`, `minPoints` (default 2). Sorted by biggest mover. |
| `GET /api/integration/v1/pnl?year=YYYY` | P&L using the same method as `generate-local-budget-pnl.cjs`, so both repos report identical numbers. |

### Income counterparty (resolves the brain's "415 blank INCOME rows" gap)

Square income rows now carry a resolved customer: `merchantName` is set to the
customer/company name (or buyer email), `customerName`/`customerEmail` expose the
resolved [Square] `SquareCustomer`, and `squareCustomerId` links the row. Guest /
quick-sale payments have no customer and fall back to a channel label
(`Square Invoice` / `Square Online` / `Square Payment`). For non-Square income
(Zelle, farmers market, catering) the manual entry form now **requires** a payer
on INCOME transactions (stored in `merchantName`, schema-enforced) — new blank
INCOME rows can no longer be created by hand. Historical blank rows (~274 as of
2026-07-20) still need payers backfilled by the owner.

### Stable vendor identity (resolves the brain's bank-truncation splits)

> **⚠️ PARTIALLY LIVE — re-run required (verified 2026-07-20):** the vendor
> migrations are applied and the hosted DB has vendors rows with ~75% of
> transactions linked, but the first backfill ran with a normalization bug that
> split bank descriptors into junk per-store vendors ("Debit Card Costco Whse
> #0652" vs "#0377", per-charge Facebook ad descriptors, `SQ *`/`TST*`
> processor tags). The normalizer is fixed as of 2026-07-20; the owner must
> re-run `npm run vendors:populate:apply` (now also deletes the orphaned junk
> vendors) and verify with `scripts/_tmp-vendor-verify.ts`. **Until that re-run
> is verified, resolve by cleaned `merchantName`, not `vendorId`.** Delete this
> caveat once the spot checks come back clean.

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
`/api/integration/v1/transactions?direction=outflow&cursor=<cursor>` and writes
one `payment.completed` LedgerEvent per row. This keeps Local Budget a clean
data source; the ledger-write logic lives in the brain.

Mapping a transaction row → the brain's `payment.completed` payload:

| Brain field | Local Budget source |
|---|---|
| `source` | constant `"local_budget"` |
| `sourceId` | row `id` (stable cuid — brain dedupes on `eventType+source+sourceId`) |
| `occurredAt` | row `date` |
| `payload.merchantName` | row `merchantName` (**must match a Vendor alias** — reconcile via `/v1/vendors` `rawNames` first, or inferences silently write nothing) |
| `payload.amountCents` | row `amountCents` |
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
5. **Forecast ownership**: Local Budget exports accounting actuals and quality
   evidence. The consumer owns projections and must keep unclassified money
   visible rather than folding it into operating expense.

## Cashflow actuals semantics

`GET /api/integration/v1/cashflow-actuals?from=2026-01-01&to=2026-07-01&grain=month`
returns six closed month rows. Authentication uses `INTEGRATION_API_TOKEN`.
Consumers normally configure that same secret as `LOCAL_BUDGET_API_TOKEN` and
the deployment origin as `LOCAL_BUDGET_API_URL`.

- Only `POSTED` rows enter actuals. Pending rows are counted in `quality`.
- Splits replace the parent amount. A difference greater than one cent is
  reported as a split mismatch.
- Classification precedence is split explicit, split category default,
  transaction explicit, transaction category default, then unresolved.
- Labor is a cashflow bucket independent of the accounting enum. Explicit
  Labor/Payroll/Wages/Contractor/Staff categories and Square/Block Payroll
  evidence enter labor. An arbitrary person-to-person transfer does not.
- Unresolved expense money enters `unclassifiedCents`; it is never silently
  treated as operating expense.
- `sourceMaxDate` is the latest posted transaction date. Bank freshness is the
  newest active Plaid-backed account sync. A sync older than 48 hours warns.
- A month is complete only when the requested range covers the calendar month
  and `sourceMaxDate` reaches that month's final date.

### Contract v2 (`?contract=2`) — founder draws and complete-month flag

`GET /api/integration/v1/cashflow-actuals?from=…&to=…&grain=month&contract=2`
returns `contractVersion: 2` / `methodVersion: "cashflow-actuals-v2"` and adds
three fields to every month row; omitting `contract` (or `contract=1`) returns
the v1 shape unchanged.

- `founderDraws` — `{ totalCents, byFounder, unattributedCents }`. Definition:
  PERSONAL-classified **EXPENSE outflows** (owner draws). Attribution comes only
  from an explicitly linked `incurredBy` entity, keyed by entity name in
  `byFounder`; everything else lands in `unattributedCents`. Nothing is
  inferred — as of 2026-07-20 all historical draws are unattributed because no
  transactions carry an `incurredById`. PERSONAL money *in* (owner
  contributions) stays in `personalExcludedCents` but never enters
  `founderDraws`.
- `pendingTransactionCount` — pending imports dated inside that month.
- `isCompleteMonth` — true only when the v1 `complete` condition holds **and**
  the month has zero pending imports. Line models must consume only months with
  `isCompleteMonth: true`; the flag is authoritative, don't re-derive it.

## Sanitized monthly snapshot (for secretless consumers)

`npm run snapshot:export -- --month=YYYY-MM [--out=path.json]` emits an
**aggregates-only** JSON snapshot of one closed month (defaults to the last
complete calendar month; refuses incomplete months unless `--force`, and then
carries `isCompleteMonth: false` honestly). It exists so chat sessions and the
le-economist evaluation — which cannot hold `INTEGRATION_API_TOKEN` or reach
the DB — can consume actuals from a committed file or a one-command owner
export.

Hard sanitization rules: integer cents, aggregates only — no transaction rows,
no customer names/emails/Square customer IDs, no account numbers or bank
descriptors. Fields deliberately unpublished are listed in `omittedFields` so a
consumer can distinguish a deliberate gap from missing data. The snapshot
carries `contractVersion`, `methodVersion`, `sourceMaxDate`,
`latestBankSyncAt`, the v2 totals/founderDraws buckets, and quality counters.

The API does not currently expose recurring Square invoice series. Local
Budget stores completed Square payments and order enrichment, but it neither
persists a recurrence/series identity nor requests the Square invoice scope.
Building a recurring-revenue endpoint from the current tables would guess from
payment cadence and could double-count scheduled invoices. Add invoice-series
ingestion and stable customer/series identifiers before publishing that
contract.

### Example response (abridged)

```json
{
  "contractVersion": 1,
  "methodVersion": "cashflow-actuals-v1",
  "currency": "USD",
  "timezone": "America/Chicago",
  "sourceMaxDate": "2026-07-12",
  "range": {
    "from": "2026-01-01",
    "toExclusive": "2026-07-01",
    "completeMonthsOnly": true
  },
  "months": [
    {
      "month": "2026-01",
      "incomeCents": 0,
      "inventoryCents": 0,
      "operatingCents": 0,
      "laborCents": 0,
      "reimbursableCents": 0,
      "personalExcludedCents": 0,
      "transferExcludedCents": 0,
      "unclassifiedCents": 0,
      "transactionCount": 0,
      "splitLineCount": 0,
      "complete": true
    }
  ],
  "quality": {
    "unclassifiedTransactionCount": 0,
    "unclassifiedCents": 0,
    "splitMismatchCount": 0,
    "pendingTransactionCount": 0,
    "latestBankSyncAt": "2026-07-14T03:01:06.671Z",
    "warnings": []
  }
}
```

## Setup

1. Generate a token: `openssl rand -hex 32`.
2. Set `INTEGRATION_API_TOKEN` in Vercel env vars (and local `.env`).
3. In local-effort-app, set `LOCAL_BUDGET_API_URL=https://local-budget.vercel.app`
   and `LOCAL_BUDGET_API_TOKEN=<same token>`.

## P&L semantics change — 2026-07-19

`/v1/pnl` now follows unified semantics (single source: `src/lib/pnl.ts`):

- **New field `refunds`**: EXPENSE-typed transactions classified INCOME
  (e.g. Square refunds) are contra-revenue. `revenue` stays the gross INCOME
  sum; `totalRevenue = revenue − refunds + reimbursementIncome`.
- **`netBusinessIncome` / `operatingIncome`** exclude reimbursable expenses
  (money fronted for payback is not an operating cost). New fields:
  `operatingIncome`, `operatingMargin`, `netMargin`, `netCashFlow`,
  `savingsRate`, `totalExpenses`.
- **Sales tax** collected via Square is recorded as a TRANSFER-classified
  split (`Sales tax collected (Square)`) and never enters revenue. Square
  payment transaction amounts now include tips (`total_money`, not
  `amount_money`); the tip/tax decomposition is in transaction metadata
  (`base_amount`, `tip_amount`, `sales_tax_amount`, `total_amount`) and splits.

Consumers replicating the P&L (e.g. generate-local-budget-pnl.cjs) should
adopt the contra-revenue rule or read `/v1/pnl` directly, otherwise their
numbers will diverge by the refund total.
