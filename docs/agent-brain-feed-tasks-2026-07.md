# Brain-feed tasks — instruction set for agents in this repo

> Written 2026-07-18 from a live audit of this repo's hosted Postgres and the
> brain's production DB in local-effort-app. Companion doc on the consumer
> side: `local-effort-app/docs/agent-brain-repair-2026-07.md`. This updates the
> asks in `local-effort-app/docs/local-budget-improvements-for-brain.md`
> (2026-06-27) with what is actually done vs. still open.

## Headline finding: the integration doc is ahead of the database

`docs/integration-local-effort.md` states that stable vendor identity is live
("Each transaction now resolves to a canonical `Vendor` row and exposes a
stable `vendorId`"). **Measured 2026-07-18: the `vendors` table has 0 rows and
`transactions` has no `vendorId` column at all** (only `line_items.vendorId`
exists). The scripts (`scripts/populate-vendors.ts`, 07-14) were written but
the migration/apply never ran against the hosted DB. Any agent — or the brain —
reading the contract doc will assume a feed that does not exist. Fix the data
or fix the doc, in that order of preference.

## Scorecard vs. the June asks (measured 2026-07-18)

| Ask (June P0/P1) | Then | Now | Status |
|---|---|---|---|
| Classify the null bucket | 1,303 unclassified | **286** | ✅ mostly done — finish the tail |
| Populate `vendors` + per-tx `vendorId` | 0 rows | **0 rows, column missing** | ❌ scripted, never applied |
| Income payer/counterparty | 0/415 | **570/1,311** | 🟡 Square backfill worked; non-Square income (Zelle, farmers market, catering) still anonymous |
| Receipts → line items with units | 0 / 6 | **0 / 6** | ❌ untouched — recipe costing still impossible |
| Data freshness | — | transactions current to 07-13 | ✅ healthy |

## P0 — apply the vendor identity work

1. Run the migration that adds `transactions.vendorId` (check
   `prisma/schema.prisma` — if the field isn't in the schema yet, the doc was
   written against unapplied work; add it) and run
   `npm run vendors:populate:apply` against the hosted DB.
2. Verify: `SELECT count(*) FROM vendors` > 0 and
   `SELECT count(*) FROM transactions WHERE "vendorId" IS NOT NULL` covers the
   large majority of COGS/OPERATING rows. Spot-check the known splits:
   "Eastside Food Cooperative"/"Eastside Food Cooperati", "Costco"/"COSTCO
   WHSE", "Amazon"/"AMAZON MARKETPLACE" must land on single vendor ids.
3. Confirm `/api/integration/v1/vendors` and `/v1/transactions` return real
   `vendorId`s, then tell the brain side to switch resolution from name
   cleaning to `vendorId` (see companion doc P0-1).
4. Until then, add a caveat line to `integration-local-effort.md` so no
   consumer builds against the fictional field.

## Verification pass — 2026-07-18 ~20:15 UTC (independent re-audit)

P0 is applied and working: `transactions.vendorId` exists, vendors table
populating (380→517 rows during the audit; backfill still in process), and
every *named* COGS/OPERATING expense now carries a `vendorId`. The brain's
backfill consumed the feed successfully (600 new vendor-payment events).

**Two problems found:**
1. **Vendor name normalization is leaky.** 200/517 vendor rows have
   descriptor-noise canonical names, and duplicate clusters exist where the
   variants should have collapsed: `Starbucks` ×4 (`Debit Card Starbucks
   11746` / `13624` / `800-782-7282` / `Starbucks`), `Debit Card Costco Whse
   #0377` vs `#0652`, and ~10 `Debit Card X` vs `X` pairs (Chocolate Alchemy,
   Cossetta, Holy Land Brand, Market Fresh…). The resolver's prefix/suffix
   stripping isn't applied (or applied inconsistently) when *minting* new
   vendors. Fix the normalizer, then merge the clusters — the brain plans to
   switch from name-cleaning to `vendorId` resolution, and these splits would
   be imported verbatim.
2. **The repo is mid-merge with unresolved conflicts** (`UU` on
   `docs/integration-local-effort.md` and
   `src/app/api/integration/v1/transactions/route.ts`; branch ahead 1 /
   behind 6 of origin/main). Until this is resolved and pushed, the deployed
   integration API may not match the local code that populated the DB.
   Resolve the merge before anything else ships from this repo.

## P1

- **Finish the classification tail**: 286 transactions still have no effective
  classification. The rules engine (`/rules`) + a "review unclassified > $100"
  pass. These rows are invisible to the brain.
- **Non-Square income payer**: 741 income rows still have no counterparty.
  Even free-text sources ("Farmers market", "Catering deposit — <name>",
  Zelle sender) let the brain attribute revenue to channels/customers.
- **Receipt ingestion for top food vendors** (Eastside, CPW): OCR pipeline
  exists (`src/lib/ocr.ts`, upload modal) but has never been used in anger
  (0 receipts). Per-line unit + price on even a month of receipts unlocks the
  brain's ingredient-costing subsystem.

## Standing rules (unchanged)

- The brain is a read-only consumer; never give it write access.
- Don't rename/remove columns it reads (`transactions`: id, externalId, date,
  merchantName, amount, type, classification, description) without checking
  `integration-local-effort.md` consumers first.
- Consumers authenticate to the integration API with `INTEGRATION_API_TOKEN`;
  they never read this repo's `.env`.
- `updatedAt` must keep bumping on reclassification/merchant edits — the
  brain's incremental sync replays corrected history via `updatedSince`.
