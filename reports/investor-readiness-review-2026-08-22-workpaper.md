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

The owner now reports first use of the `Local Effort` brand in September 2022 for private-chef services sold as an individual contractor. The Delaware certificate establishes Local Effort, Inc. on April 10, 2024, and the Minnesota certificate establishes Local Effort Cooperative on April 21, 2026. These are brand and formation facts, not evidence of one legally continuous entity.

The database's current history begins January 11, 2024 and has no active Stripe account. The owner-supplied Stripe balance export now covers January 12, 2024 through March 4, 2025. Filed returns, destination-bank records, 1099-Ks, the Stripe account/legal owner, and any pre-January 2024 provider activity must establish the legal operator and accounting perimeter for each period.

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

## September 1 evidence addendum

Three owner-supplied files were reviewed without adding customer-identifying data to the repository:

- Stripe balance history, SHA-256 `3eb7f7be282ae0c7a312bc70a4223597680819c6f25a0616a4cbd995722c10cf`;
- Stripe unified customers, SHA-256 `37f0628ecddff75ffd6050c5927734128c71acb32ddebca0095fbbb4a7dce78f`; and
- Delaware certificate and articles for Local Effort, Inc., SHA-256 `816e3766e82590d4c77b39f52d06b7e9ab9d8e4f80ddc7080bb0038d9e5ab754`.

The owner clarified the operating history: `Local Effort` was first used as a brand in September 2022, when Weston sold private-chef services as an individual contractor. This is owner-reported empirical evidence of brand and operating history. It is not evidence that Local Effort, Inc. or Local Effort Cooperative existed in 2022 or received those sales.

The Delaware certificate proves that Local Effort, Inc. was incorporated on April 10, 2024 at 9:01 a.m., file number 3420425. Its articles authorize 100,000,000 common shares at $0.00001 par value and name Weston Smith and Catherine Olsen as the initial directors. The certificate proves formation, not current good standing, the date the corporation assumed the pre-incorporation business, or a later transfer into the cooperative.

Minnesota Statutes [section 308B.235](https://www.revisor.mn.gov/statutes/cite/308B.235) says a Chapter 308B cooperative's existence begins when its articles are filed. The observed cooperative certificate therefore establishes April 21, 2026 as the cooperative's legal start. Section [308B.225](https://www.revisor.mn.gov/statutes/cite/308B.225) provides a continuity-preserving conversion only for a Chapter 308A cooperative. A merger with another business entity requires a plan and filed articles under section [308B.801](https://www.revisor.mn.gov/statutes/cite/308B.801). No merger, conversion, asset-transfer, liability-assumption, or dissolution record was reviewed.

Pending those records and professional review, the evidence supports three candidate legal-operator periods rather than one proven continuation:

1. beginning September 2022: observed owner-reported individual-contractor activity using the Local Effort brand;
2. beginning April 10, 2024: proven existence of Local Effort, Inc., with its actual operating cut-in and cut-off still to be established transaction by transaction; and
3. beginning April 21, 2026: proven existence of Local Effort Cooperative, with the operating cutover from any predecessor still to be established.

`Predecessor` is the appropriate provisional accounting and disclosure label for the earlier operator or entity whose business may have been contributed or transferred to the cooperative. It does not itself transfer assets, contracts, tax attributes, or liabilities. `Continuing company` should be used legally only if filed conversion/merger documents or counsel establish that continuity. Management reporting may show brand-level history since September 2022, but every transaction must retain its actual legal operator and tax owner.

### Stripe coverage now observed

The strict importer dry-run parsed all 224 balance rows with zero duplicate IDs and zero gross/fee/net arithmetic exceptions after adding support for Stripe's `Amount` header. The file covers January 12, 2024 through March 4, 2025, all in USD:

| Balance type | Rows | Amount | Fee | Net |
| --- | ---: | ---: | ---: | ---: |
| Charge | 69 | $41,117.60 | $1,213.34 | $39,904.26 |
| Payment | 1 | $25,000.00 | $5.00 | $24,995.00 |
| Refund | 17 | -$4,885.00 | $0.00 | -$4,885.00 |
| Refund failure | 1 | $2,000.00 | $0.00 | $2,000.00 |
| Adjustment | 3 | -$2,000.00 | $15.00 | -$2,015.00 |
| Payout | 71 | -$41,290.06 | $213.41 | -$41,503.47 |
| Payout failure | 12 | -$20,461.58 | $0.00 | -$20,461.58 |
| Reserved funds | 16 | $0.00 | $0.00 | $0.00 |
| Stripe fee | 34 | -$49.21 | $0.00 | -$49.21 |

These categories are processor events and must not be summed as revenue. In particular, the isolated $25,000 `payment` is not classified as a sale without its source, customer, contract, and 1099-K treatment.

The customer file has 35 rows created January 5 through September 28, 2024. Its aggregate payment count is 69. Total Spend is $36,232.60, Refunded Volume is $2,885.00, and Dispute Losses are $2,000.00. The exact bridge is `$41,117.60 charges - $2,885.00 refunds - $2,000.00 disputes = $36,232.60 customer Total Spend`. This corroborates customer attribution for the 69 charge rows, but the customer file remains a net customer aggregate rather than an accounting ledger.

The owner identifies this export as the complete Stripe transaction history, identifies `acct_1NxcXbAMgX7ghwAp` as its Stripe account, and identifies Weston Smith as the account's legal owner. The observed file covers January 12, 2024 through March 4, 2025. The account ID supplies the immutable source namespace and the owner statement supplies the provisional legal-owner mapping; destination-bank statements, 1099-Ks, and filed returns must still reconcile the activity. No database import was applied at this evidence-review stage because the accounting migrations and production backup remained review-gated.

### Inc. maintenance decision

Do not run new sales through both entities. Preserve Local Effort, Inc. temporarily as a wind-down or merger vehicle, then retire it unless a written inventory identifies a continuing purpose. The cooperative already provides limited liability to members under Minnesota Statutes [section 308B.505](https://www.revisor.mn.gov/statutes/cite/308B.505); keeping the corporation does not add a second layer of protection merely because it exists.

The strongest case for keeping the corporation is that it may still own contracts, receivables, claims, permits, insurance rights, intellectual property, Stripe or bank relationships, tax attributes, or historical liabilities that cannot be abandoned. The case against it is recurring Delaware annual-report, franchise-tax, registered-agent, tax-return, banking, bookkeeping, and governance burden plus a higher risk of sending revenue or expenses to the wrong entity. Delaware states that active domestic corporations owe annual reports and franchise tax and that taxes continue until a termination filing is accepted ([annual report and tax](https://corp.delaware.gov/frtax/); [Delaware FAQ](https://corp.delaware.gov/faqs/)).

**Pause condition:** do not dissolve or merge Local Effort, Inc. while any material asset, contract, permit, claim, creditor, tax item, insurance matter, processor balance, or bank reconciliation remains unresolved. The smallest reversible next step is a counsel-and-CPA-reviewed entity inventory, followed by a documented merger or asset/liability transfer, final returns and account closures, and only then a termination filing if the corporation has no remaining purpose.

## September 3 production execution and reconciliation

The configured production PostgreSQL target reported all nine repository migrations applied before deployment. After a restorable backup was created, `prisma migrate deploy` confirmed that there were no pending migrations. The backup is `C:\Users\user\Backups\LocalBudget\local-budget-production-pre-stripe-2026-09-03.dump`, 1,431,312 bytes, SHA-256 `fb222026dbbad3f20c76de11f758e99affccc921eeeeb3d0cdddcbe9d3639c6a`; PostgreSQL 17 `pg_restore --list` validated its catalog. The original seven-account authority backfill updated seven accounts and upserted nine ownership records. After adding the Weston-owned Stripe processor rule, the live audit reports eight active accounts, eight mapped accounts, ten ownership records, and zero unmapped or duplicate canonical accounts.

The production Stripe import created 224 immutable source events under namespace `acct_1NxcXbAMgX7ghwAp`; an immediate replay created zero and returned all 224 as existing. A new `Stripe` processor account records Weston Smith as its entity and sole owner.

### Payout reconciliation

An additional Stripe payout export was reconciled, SHA-256 `d6d861285e5cd842101f64d8dd78435017a56562230f1b9f2927f560b683c5b9`. Its 59 `paid` payout rows total $61,751.64 and link one-for-one to 59 balance-history transaction IDs:

- 36 standard payouts totaling $46,856.59 went to SoFi Checking ending 6183;
- 23 instant payouts totaling $14,895.05 went to card ending 0041;
- 28 payouts totaling $43,445.71 have processor components that sum exactly to the payout and are recorded `PARTIAL`; and
- 31 payouts totaling $18,305.93 remain `UNMATCHED` at the processor-component layer.
  - Of the 31 processor exceptions, 23 instant payouts totaling $14,895.05 have no component linkage in the balance export, and eight standard payouts totaling $3,410.88 have transfer-group component mismatches.

The reconciliation created 59 Stripe `ProcessorSettlement` records and 119 component entries. It created no bank allocation: Local Budget's SoFi 6183 history begins in 2025, after these 2024 payouts, and no card-0041 ledger is present. Therefore all 59 destination-bank/card legs remain open even though the payout export and its balance-transaction identities reconcile. The nine observed payout-reversal rows are separately supported by SHA-256 `c8733eb7d4e42ffae90c7df160671fc0c427b2f86ad4d7d5274f651e12f40277`.

The gross bridge remains exact: 69 charge rows total $41,117.60, and `$41,117.60 - $2,885.00 customer refunded volume - $2,000.00 dispute losses = $36,232.60 customer Total Spend`. No 1099-K or readable filed-return evidence was available, so this is a processor/customer bridge rather than a completed tax reconciliation.

### William Lange personal loan

The signed March 12, 2024 agreement, SHA-256 `b182bfa15082240c3ab5407b7070900d0ab7907513d321bedeebc0d96ff39bf4`, states:

- $25,000 principal to fund Local Effort operations;
- 8% of gross revenue from qualifying events, with a $1,500 quarterly minimum;
- $32,500 total repayment, including on early payoff;
- a 60-month term; and
- a 3% late fee on an unpaid payment, subject to notice and cure provisions.

The owner now directs that this is Weston's personal loan. The executed agreement, however, names both Weston Smith and Catherine Olsen as borrowers. Accounting now attributes the Stripe receipt and six observed repayments to Weston and keeps them out of operating revenue and expense; the contractual co-borrower issue requires lender/counsel confirmation rather than a bookkeeping override.

The $25,000 Stripe source event is now `IGNORED` for operating posting with an owner-confirmed personal-loan reason. Six nonduplicate repayments total $6,000: $1,500 on January 27, 2025; $1,500 on September 12, 2025; $1,000 on October 26, 2025; $1,000 on April 26, 2026; $500 on May 14, 2026; and $500 on May 27, 2026. A separate $1,500 SoFi row is the linked bank leg of the January Venmo payment and is not counted twice. The remaining contractual total is therefore $26,500 before any valid late fees or unlocated payments.

The ingested Gmail thread dated April 23, 2026 records William Lange's default notice, a missed planned $2,000 early-April payment, a 60-day cure reference, and Weston's proposed remedy plan. Its retained body digest is `c859aceac87e3a38c498d20f2810dc6e7227b5a25e56f274adb460a5f19946c7`. Current Gmail OAuth remains unavailable and the browser session had no authenticated Gmail access, so later email totals could not be verified. Do not book late fees or call $26,500 the lender-confirmed payoff until the current thread and lender statement are obtained.
