# Accounting remediation implementation status

As of: August 23, 2026 (America/Chicago)

Decision: begin tranches 1–7 behind compatibility paths. Do not rewrite historical transactions or rely on the new journal for filing until migrations, backfills, source coverage, and two shadow closes pass review.

## Authoritative facts added

- Owner-confirmed custody maps all seven active account records:
  - `Square`: Weston custody; Local Effort processor activity.
  - `Local Pizza`: Weston custody; Local Effort destination-bank cash. It has the same owner/business scope as Square but remains a distinct bank ledger.
  - `SoFi Checking` and `SoFi Savings`: Weston and Catherine joint custody.
  - `TOTAL CHECKING` and `Venmo Wallet`: Catherine custody.
  - `General savings`: Weston custody.
- Minnesota Secretary of State Certificate of Organization:
  - legal name: Local Effort;
  - Chapter 308B;
  - file number 1644146400023;
  - filed April 21, 2026 at 11:59 p.m.;
  - source SHA-256 `84DE497655753C163497ACF2E332C7A460904A0B6750FD5D2E43989ABE8FE35B`.

The filing proves the Minnesota 308B formation event. It does not by itself decide how 2023–April 20, 2026 predecessor activity carries into the cooperative's tax or accounting books.

## Implementation by tranche

| Tranche | Implemented foundation | Still review-gated |
| --- | --- | --- |
| 1 — identity and source | Owner-authority map; joint-account ownership model; custody roles; immutable namespaced `SourceEvent`; read-only live mapping audit | Migration deployment; entity/account ownership backfill |
| 2 — journal and periods | Chart of accounts, accounting periods, journal entries/lines, balanced posting service, immutability/closed-period database triggers | Opening balances; chart seed; legacy shadow posting |
| 3 — Square | One selected processor ledger per connection; destination banks cannot sync Square activity; webhook/poll use same selector; OAuth state stored server-side and verified; no new Square-created bank placeholders | Existing $288.51 fee bridge, partial settlements, and loan agreement/roll-forward |
| 4 — member custody | Weston/Catherine joint and sole custody supported; transfer matching remains a proposal; applying now requires exact reviewed outflow/inflow IDs | Transaction/member attribution and due-to/due-from journal posting |
| 5 — Stripe | Strict balance-history CSV parser and immutable source-event importer; customer-aggregate uploads are rejected as accounting ledgers | Actual Stripe balance-history/payout exports and bank reconciliation |
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

## Verification

- Local Budget: 24 test files and 131 tests passed.
- Local Budget: TypeScript `--noEmit` passed.
- Local Budget: Prisma schema validation and client generation passed.
- Local Budget: production build passed. Existing non-blocking React/image lint warnings remain.
- Local Effort Gmail reliability: three focused tests passed.
- Local Effort Gmail module: Node syntax check passed.
- Configured database migration status: all three remediation migrations are pending; none has been applied.

No accounting-core or evidence migration has been applied. No historical transaction was deleted, merged, or reclassified. The failed one-message Gmail verification changed only cursor error/retry observability; it created no vendor-document event.

## Deployment and data gates

1. Review and back up production before applying the three new migrations.
2. Apply the account-authority backfill only after the migration; confirm the generated Weston and Catherine entities and all nine ownership links (joint accounts produce two each).
3. Reauthorize Brain Gmail and pass a one-message, then one-page, then one-window verification before a historical sweep.
4. Obtain Stripe balance-history and payout exports; do not import unified-customer totals as accounting activity.
5. Dry-run Eastside extraction and Amazon recovery; compare counts/hashes to existing Brain and Local Budget identities before writing.
6. Seed the chart/opening balances and shadow-post a closed month; keep legacy reports authoritative until every variance is explained.

## Adversarial review and kill condition

The strongest case against this implementation is that a custom accounting ledger creates more correctness and maintenance risk than adopting a mature general ledger. The reversible design keeps legacy transactions intact and places the new source/journal/close path beside them.

Pause deployment or cutover if a migration cannot be restored cleanly, a provider replay creates a second economic fact, a private receipt cannot be retrieved through the authenticated route, or either of the first two shadow closes fails to reconcile bank, processor, loan, member-custody, and trial-balance totals.

## Calibration entry

`2026-08-23 | IMPLEMENTATION STARTED | Build Local Budget as the accounting authority | Add identity/source/journal/channel/evidence/close controls behind compatibility paths | migrations and source recovery can be introduced without rewriting legacy facts | pause if two shadow closes do not reconcile or source-to-journal lineage is not independently reviewable | open | receipt availability was understated; distinguish recoverable source evidence from durable ledger linkage`
