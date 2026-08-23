# Investor-readiness review workpaper

Generated August 22, 2026. This file records the evidence map and calculations behind the portable report. Repository documents and memories were treated as hypotheses, not as authorities.

## Verified analytical sources

- Live aggregate audit: `scripts/audit-investor-readiness.ts`, executed at `2026-08-22T19:35:08.863Z` against the configured PostgreSQL database. It emits no descriptions, customer names, account numbers, tokens, or raw provider payloads.
- Prior comparison: `exports/profit-and-loss_2025-08_2026-07.csv`, generated August 21, 2026.
- Local Budget static review: reporting, Square, Plaid, imports, transactions, splits, entity, audit, and integration paths under `src/`, plus `prisma/schema.prisma` and migrations.
- Business integration review: `C:\Users\user\local-effort-app\backend\api\brain\localBudgetSync.js` and related Finance Core/Brain routes, read only.
- Venmo duplicate audit: `scripts/audit-venmo-revenue.ts`, executed at `2026-08-22T19:48:21.373Z` against the configured PostgreSQL database. It uses transaction text and statement metadata only for matching and emits no descriptions, counterparties, notes, account numbers, transaction IDs, statement IDs, or raw metadata.
- Follow-up aggregate evidence check: read-only Local Budget queries measured receipt linkage, Amazon/Eastside populations, Zelle income, Stripe traces, and current entity/account assignments. Read-only Brain queries measured Gmail vendor-document cursor state and historical receipt-extraction counts. Gmail connector searches measured bounded discovery results without reading or exporting message content.
- External guidance: official Square, Intuit/QuickBooks, MarginEdge, IRS, Minnesota Revisor, and OpenAI documentation linked directly in the report.

## P&L version comparison

Window: August 1, 2025 through July 31, 2026.

| Measure | August 21 export | August 22 live | Change | Change % |
|---|---:|---:|---:|---:|
| Gross revenue | $176,359.13 | $135,678.31 | -$40,680.82 | -23.07% |
| Net revenue | $172,058.13 | $131,835.31 | -$40,222.82 | -23.38% |
| Operating income | $78,555.73 | $36,861.60 | -$41,694.13 | -53.08% |

Percent change is `(live - export) / export`.

## Entity-scope calculation

For the same window, current all-account gross revenue is $135,678.31. Business-owned accounts contribute $87,426.05; Personal-owned accounts $29,322.26; the unassigned account $18,930.00. The non-business/unassigned share is `($29,322.26 + $18,930.00) / $135,678.31 = 35.56%`.

Combined operating income is $36,861.60. Business-owned accounts contribute $36,790.44, Personal-owned accounts -$15,874.32, and the unassigned account $15,945.48. The latter two net to $71.16, explaining the misleading closeness between combined and business-only totals.

## Square calculations

- Total payout settlements: $62,543.65.
- Matched allocation value: $55,428.56.
- PARTIAL value: $7,115.09.
- Entry-backed CHARGE gross: $65,343.70; fees: $2,029.99.
- Separate Square fee transaction rows: $2,318.50; difference from entry-backed fees: $288.51.
- Square Capital payments $4,133.64 less reversals $102.62 = net withholding $4,031.02.

The entry-backed subset and all-settlement population have different coverage and are not summed as one bridge.

## Venmo duplicate testing

- 472 wallet rows: 352 canonical statement main rows and 120 fee rows.
- 139 P&L revenue rows totaling $29,562.50.
- Zero duplicate canonical financial-fact groups and zero duplicate source-identity groups.
- 181 statement rows expect a bank counterpart; 175 are linked.
- The remaining six comprise one clear and five ambiguous bank candidates. Every candidate bank leg is already P&L-neutral.
- Zero linked bank legs still contribute to P&L; zero unlinked bank rows with Venmo text remain counted as revenue; zero exact-amount wallet-to-bank revenue pairs occur within seven days.

Conclusion: no current Venmo revenue double-count was detected. The six unresolved P&L-neutral links remain reconciliation exceptions; no transaction should be deleted from this test alone.

## Historical channel coverage

The owners state that the business began in 2023 and previously used Stripe. The database’s current history begins January 11, 2024 and has no active Stripe account. Stripe balance transactions, fees, refunds, disputes, payouts, 1099-K forms, and destination-bank statements are required to establish 2023 completeness.

Capital Master Record v2.3 separately says the cooperative was operating since 2022. This is an unresolved empirical conflict, not a reason to extend or shorten the books automatically. Formation records, filed returns, first sales, first bank activity, and legacy Stripe activity must establish whether 2022 was predecessor activity and where the accounting perimeter begins.

## Follow-up receipt and evidence interpretation

The earlier phrase "the database contains no receipts" meant that Local Budget had zero ingested `Receipt` rows and zero durable `ReceiptTransaction` links. It did not establish that source documents were unavailable.

Observed follow-up evidence:

- Local Budget still has zero `Receipt` rows and 184 transaction-linked line items, with zero receipt-linked line items.
- The Brain contains 43 historical `extraction.receipts` events.
- The newer Gmail vendor-document job has produced zero events. Its sixteen windows have processed zero messages; one has remained `running` since July 13, 2026 and fifteen are pending.
- A bounded Gmail search returned at least 100 broad receipt/invoice candidates, at least 100 Square candidates, at least 100 Venmo candidates, 29 Eastside candidates, and 19 Amazon candidates since January 1, 2023. Search hits are discovery candidates, not validated receipts or a coverage rate.
- Local Budget has 289 posted Amazon-text transactions totaling $8,101.17; eleven carry order-match candidates and 278 do not. It has 515 posted Eastside-text transactions totaling $25,840.49.

Conclusion: source recovery is likely substantial, but evidence existence, retained original, business purpose, transaction linkage, line allocation, and accounting approval are different controls. Stabilize cash/source identities first, repair evidence retention early, and perform the bulk receipt hunt after the ledger population is stable.

## Revised product decision

The owner clarified that Local Budget is to become the accounting suite. QuickBooks and MarginEdge are industry-design references only; no direct integration is planned. The revised target makes Local Budget authoritative for source events, canonical economic events, journal, subledgers, reconciliation, close, tax mappings, and reports. Local Effort owns commercial/operating records and supplies stable references; the Brain remains an evidence/inference layer and never posts accounting entries.

The detailed execution plan is `docs/investor-grade-remediation-plan.md`.

## Chart contracts

1. Financial report version comparison: grouped categorical bar; six rows at measure-by-version grain; USD; blue/orange categorical roots; exact values in tooltips; supports the report-instability finding.
2. Gross revenue by account-owner entity: categorical bar; complete three-category population; USD with gross share and operating income in tooltips; single-root styling; supports the entity-boundary finding.

## Code-review reference map

- Square duplicate-account path: `src/app/api/square/callback/route.ts`, `src/app/api/square/sync/route.ts`, `src/app/page.tsx`.
- Webhook versus polling enrichment: `src/app/api/square/webhook/route.ts`, `src/app/api/square/sync/route.ts`.
- Settlement matching: `src/server/services/settlement-matching.ts` and Square sync.
- Transfer matching: `src/server/services/transfers/service.ts`, `src/server/services/transfers/matcher.ts`.
- Ownership and split integrity: transaction, account, split, and rule routers; P&L and tax reporting services.
- Import and Plaid idempotency: CSV/PDF import services and Plaid sync/token-exchange routes.
- Downstream direct database integration: Local Effort Brain `localBudgetSync.js`.
- Security follow-up: Square OAuth connect/callback routes and `docs/security-remediation.md`. No secret value was inspected or copied into this workpaper.

## Validation record

- `pnpm test`: 16 files, 108 tests passed.
- `pnpm build`: production build succeeded with non-blocking lint warnings.
- `pnpm exec tsc --noEmit`: succeeded after the build regenerated Next.js types.
- Prisma migrations: all six repository migrations applied; Prisma schema validation succeeded during the review.

## Limitations

The April 1, 2026 policy cutoff is a working assumption awaiting owner confirmation. Exact-duplicate groups are candidates, not proven duplicates. Bank/card statements, the Square loan agreement and lender statement, cooperative governing/tax documents, member-account mapping, and historical returns were not available for verification.

## August 23 implementation addendum

The Minnesota Secretary of State Certificate of Organization now proves that Local Effort was formed or registered under Chapter 308B on April 21, 2026 at 11:59 p.m., file 1644146400023. Its SHA-256 is `84DE497655753C163497ACF2E332C7A460904A0B6750FD5D2E43989ABE8FE35B`. This proves the formation event, not the tax/legal continuity of activity reported from 2023 through April 20, 2026.

The owner confirmed the seven-account custody map. A read-only live audit matched all seven names to the policy: Square and Local Pizza are Weston-custodied Local Effort activity but remain separate processor-clearing and destination-bank records; SoFi Checking and SoFi Savings are joint Weston/Catherine custody; TOTAL CHECKING and Venmo Wallet are Catherine custody; General savings is Weston custody.

Tranches 1–7 now have additive, tested foundations for account ownership/custody, immutable provider source events, balanced journals and exact reversals, immutable accounting periods, a single Square processor ledger, reviewed Venmo transfer application, strict Stripe balance-history ingestion, private hash-deduplicated receipt evidence, Gmail cursor reliability, and deterministic close gates. The configured database reports all three new remediation migrations as pending. No migration, ownership backfill, historical reclassification, merge, or deletion has occurred.

The located `unified_customers.csv` files are Stripe/customer attribution aggregates, not balance-transaction or payout ledgers. The Brain Gmail application remains unauthorized; after reliability fixes, a one-message test failed before message selection and wrote no vendor-document event. An administrator must complete `/api/brain/gmail/auth`, then validate one message, one page, and one cursor window before any bulk recovery.

Post-change validation: Local Budget 24 files/131 tests, TypeScript, Prisma schema/client, and production build passed; the Local Effort Gmail suite passed three focused tests and its module passed Node syntax checking. See `docs/remediation-implementation-status-2026-08-23.md` for deployment gates and the updated kill condition.
