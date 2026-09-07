# Accounting remediation implementation status

As of: September 3, 2026 (America/Chicago)

Decision: tranches 1–7 remain behind compatibility paths. Production backup, all nine migrations, account-authority backfill, Stripe source ingestion, and first-pass Stripe reconciliation are complete. Do not rely on the new journal for filing until opening balances, chart seed, source exceptions, and two shadow closes pass review.

## Authoritative facts added

- Owner-confirmed custody maps the original seven active account records:
  - `Square`: Weston custody; Local Effort processor activity.
  - `Local Pizza`: Weston custody; Local Effort destination-bank cash. It has the same owner/business scope as Square but remains a distinct bank ledger.
  - `SoFi Checking` and `SoFi Savings`: Weston and Catherine joint custody.
  - `TOTAL CHECKING` and `Venmo Wallet`: Catherine custody.
  - `General savings`: Weston custody.
  - `Stripe`: Weston custody; processor account; each receipt requires economic-purpose attribution.
- Minnesota Secretary of State Certificate of Organization:
  - legal name: Local Effort;
  - Chapter 308B;
  - file number 1644146400023;
  - filed April 21, 2026 at 11:59 p.m.;
  - source SHA-256 `84DE497655753C163497ACF2E332C7A460904A0B6750FD5D2E43989ABE8FE35B`.

The filing proves the Minnesota 308B formation event. It does not by itself decide how pre-April 21, 2026 activity beginning with the owner-reported September 2022 brand use carries into the cooperative's tax or accounting books.

## Implementation by tranche

| Tranche | Implemented foundation | Still review-gated |
| --- | --- | --- |
| 1 — identity and source | All nine migrations applied; eight-account authority map active; ten ownership records confirmed; immutable namespaced `SourceEvent` live | Historical entity attribution and independent review |
| 2 — journal and periods | Chart of accounts, accounting periods, journal entries/lines, balanced posting service, immutability/closed-period database triggers | Opening balances; chart seed; legacy shadow posting |
| 3 — Square | One selected processor ledger per connection; destination banks cannot sync Square activity; webhook/poll use same selector; OAuth state stored server-side and verified; no new Square-created bank placeholders | Existing $288.51 fee bridge, partial settlements, and loan agreement/roll-forward |
| 4 — member custody | Weston/Catherine joint and sole custody backfilled; eight active accounts mapped; six William Lange repayments attributed to Weston; transfer matching remains evidence-gated | Remaining transaction/member attribution and due-to/due-from journal posting |
| 5 — Stripe | Weston-owned processor account created; 224 source events imported idempotently under `acct_1NxcXbAMgX7ghwAp`; 59 payout settlements and 119 component entries recorded; $25,000 personal loan excluded from operating revenue | 31 processor-component exceptions; all 59 destination legs; 1099-K, filed-return, opening-period, and card-0041 evidence |
| 6 — evidence | SHA-256 receipt deduplication; private Blob storage; authenticated file serving; recoverable receipt retirement; Gmail cursor authorization/claim and lossless retry fixes | Gmail OAuth reconnect; bulk Eastside/Amazon recovery; migration of legacy public blobs |
| 7 — close | Close-run model, immutable completed runs, deterministic snapshot hashes, and blocker gates for custody, sources, reconciliation, Square, loan, personal attribution, evidence, suspense, and trial balance | Live metric collector, close UI/API, first two shadow closes, independent review |

## Gmail diagnosis and current blocker

The Brain Gmail authorization is not currently usable. A one-message bounded verification returned `Gmail not authorized — visit /api/brain/gmail/auth to connect`.

The repaired code now:

- recovers only stale `running` claims;
- authenticates before selecting or claiming a cursor, so a missing token cannot march all pending windows into error;
- claims a cursor atomically;
- keeps the original page token when any message fails, so the page can be replayed idempotently; and
- reports a failed/deferred page instead of a false successful batch.

Current Brain status observed after diagnosis: 27 cursor windows, zero processed vendor documents, four historical/error windows, and 23 pending. Bulk Gmail ingestion must not start until an admin completes `/api/brain/gmail/auth` and the one-message verification succeeds.

## Evidence inventory clarification

- The Local Effort Downloads evidence contains hundreds of Eastside `.eml` files and a deterministic Eastside extractor. File existence is not proof of successful Brain or Local Budget linkage.
- Local Budget contains saved Amazon order HTML and historical Amazon match metadata/line detail. No current `Receipt` records prove a retained Amazon invoice archive.
- The located Stripe `unified_customers.csv` files are customer aggregates. They can support customer attribution but not gross sales, fees, disputes, refunds, payouts, cash, or the trial balance.

## September 1 source update

- Owner-reported operating history now begins with use of the `Local Effort` brand for individual-contractor private-chef services in September 2022. This establishes brand history, not cooperative legal existence or entity ownership of those sales.
- The Delaware certificate proves that Local Effort, Inc. was incorporated April 10, 2024 at 9:01 a.m., file 3420425. Source SHA-256: `816e3766e82590d4c77b39f52d06b7e9ab9d8e4f80ddc7080bb0038d9e5ab754`.
- The reviewed documents do not include a filed merger, conversion, asset transfer, liability assumption, or Inc. dissolution. Until counsel and the CPA establish the cutover, model the individual contractor, Delaware corporation, and Minnesota cooperative as distinct candidate legal operators and attribute each transaction from source evidence.
- The owner identifies the supplied Stripe balance history as the complete transaction history for Stripe account `acct_1NxcXbAMgX7ghwAp`. The account ID is now the immutable source namespace. Source SHA-256: `3eb7f7be282ae0c7a312bc70a4223597680819c6f25a0616a4cbd995722c10cf`.
- The importer dry-run parsed 224 unique USD rows from January 12, 2024 through March 4, 2025 with zero arithmetic exceptions. It includes 69 charge rows totaling $41,117.60, 17 refund rows totaling -$4,885.00, 71 payout rows, failures, adjustments, reserved-fund events, and separate Stripe-fee rows.
- The customer aggregate has 35 rows and 69 payments. Its $36,232.60 Total Spend bridges exactly to $41,117.60 of charges less $2,885.00 Refunded Volume and $2,000.00 Dispute Losses. Source SHA-256: `37f0628ecddff75ffd6050c5927734128c71acb32ddebca0095fbbb4a7dce78f`.

Production now contains 224 immutable Stripe source events. Weston Smith is the confirmed legal owner of the Stripe processor account. The $25,000 payment is classified as Weston's personal loan and excluded from operating revenue; six observed repayments totaling $6,000 are attributed to Weston and remain P&L-neutral.

## September 3 production execution

- Restorable PostgreSQL 17 custom-format backup: `C:\Users\user\Backups\LocalBudget\local-budget-production-pre-stripe-2026-09-03.dump`; 1,431,312 bytes; SHA-256 `fb222026dbbad3f20c76de11f758e99affccc921eeeeb3d0cdddcbe9d3639c6a`; restore catalog validated.
- `prisma migrate deploy`: nine migrations found and no pending migrations.
- Account authority: the initial seven accounts produced nine ownership records; adding the Weston-owned Stripe processor brought the live map to eight accounts and ten ownership records.
- Stripe import: 224 created on first apply; zero created and 224 existing on immediate replay.
- Payout export SHA-256: `d6d861285e5cd842101f64d8dd78435017a56562230f1b9f2927f560b683c5b9`. All 59 payout rows link to balance-history IDs; 28 totaling $43,445.71 reconcile internally and 31 totaling $18,305.93 remain component exceptions.
- Destination evidence: 36 payouts totaling $46,856.59 identify SoFi 6183 and 23 totaling $14,895.05 identify card 0041. No bank/card transaction was matched because Local Budget lacks 2024 SoFi 6183 history and any card-0041 ledger.
- Signed William Lange agreement SHA-256: `b182bfa15082240c3ab5407b7070900d0ab7907513d321bedeebc0d96ff39bf4`. Observed nonduplicate repayments are $6,000, leaving $26,500 of the contractual $32,500 total before valid late fees or unlocated payments.
- The executed agreement names Weston and Catherine as borrowers; the owner now assigns the debt to Weston. Accounting follows the owner instruction provisionally, but lender/counsel confirmation is required to change the contract.

## Verification

- Local Budget: 24 test files and 131 tests passed.
- Local Budget: TypeScript `--noEmit` passed.
- Local Budget: Prisma schema validation and client generation passed.
- Local Budget: production build passed. Existing non-blocking React/image lint warnings remain.
- Local Effort Gmail reliability: three focused tests passed.
- Local Effort Gmail module: Node syntax check passed.
- Configured database migration status: all nine repository migrations applied; schema is up to date.
- September 3 account-authority applies: seven original accounts updated with nine ownerships, then the Stripe policy completed an eight-account/ten-ownership map.
- September 3 Stripe import/replay: 224 created, then zero created and 224 existing.
- September 3 focused accounting verification: four files and 31 tests passed.
- September 3 production reconciliation audit: 59 settlements, 119 entries, 28 PARTIAL, 31 UNMATCHED, zero destination-bank/card allocations.
- September 7 repository verification: full suite 25 files and 135 tests passed, and TypeScript `--noEmit` passed after `scripts/report-stripe-payout-destinations.ts` replaced three `Set` spreads with `Array.from` (the repository has no `target`, so `tsc` defaults to ES5 and rejected the spreads).
- Portable artifact JSON will carry the execution update; HTML regeneration remains blocked because the pinned `data-analytics` report-builder plugin is absent from this workstation.

Accounting-core and evidence migrations are applied. The authority backfill, Stripe source import, Stripe settlement records, and owner-confirmed loan attribution changed production additively; no historical transaction was deleted, merged, or reclassified into operating revenue or expense.

## Deployment and data gates

1. Completed September 3: production backup, migration deployment verification, and restore-catalog validation.
2. Completed September 3: eight-account authority map and ten ownership records, including the Weston-owned Stripe processor.
3. Reauthorize Brain Gmail and verify the current William Lange thread before booking late fees or treating $26,500 as lender-confirmed payoff.
4. Obtain 2024 SoFi 6183 statements/history and the card-0041 ledger; reconcile all 59 payout destination legs.
5. Obtain Stripe 1099-Ks and readable filed returns; complete the processor-to-tax bridge.
6. Seed the chart/opening balances and shadow-post a closed month; keep legacy reports authoritative until every variance is explained.

## Adversarial review and kill condition

The strongest case against this implementation is that a custom accounting ledger creates more correctness and maintenance risk than adopting a mature general ledger. The reversible design keeps legacy transactions intact and places the new source/journal/close path beside them.

Pause deployment or cutover if a migration cannot be restored cleanly, a provider replay creates a second economic fact, a private receipt cannot be retrieved through the authenticated route, or either of the first two shadow closes fails to reconcile bank, processor, loan, member-custody, and trial-balance totals.

## Calibration entry

`2026-08-23 | IMPLEMENTATION STARTED | Build Local Budget as the accounting authority | Add identity/source/journal/channel/evidence/close controls behind compatibility paths | migrations and source recovery can be introduced without rewriting legacy facts | pause if two shadow closes do not reconcile or source-to-journal lineage is not independently reviewable | open | receipt availability was understated; distinguish recoverable source evidence from durable ledger linkage`

`2026-09-03 | EXECUTED / PARTIAL | Recover legacy Stripe and classify William Lange funding | Back up production; verify migrations; backfill account authority; import 224 Stripe events; record 59 payouts; exclude the $25,000 personal loan from revenue | owner account mapping and processor exports are accurate; destination statements and lender totals remain incomplete | do not post historical journals, late fees, or lender-confirmed payoff until destination and current lender evidence reconcile | 224 events imported idempotently; 28 payout/component bridges partial, 31 unmatched, zero bank/card matches; $6,000 repayments observed | immutable ingestion worked; the binding constraint moved from processor evidence to missing destination and lender evidence`
