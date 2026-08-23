square i# Investor-grade accounting remediation plan

Status: proposed architecture and execution sequence, revised August 22, 2026.

Implementation began August 23, 2026. See `docs/remediation-implementation-status-2026-08-23.md` for tested code, deployment gates, and current blockers.

This plan makes Local Budget the accounting system for the household and Local Effort Cooperative. QuickBooks and MarginEdge are design references only; the suite will not integrate with or depend on either product.

## Executive summary

- **The first problem is identity, not categorization.** The ledger must distinguish Weston Smith, Catherine Olsen, and Local Effort Cooperative as separate economic actors, then distinguish legal ownership from the account or wallet that held the cash. Current data has only a generic Personal entity, the business entity, and an unassigned Venmo wallet.
- **The first transaction-system risk is duplicate economic facts.** Square captures, fees, loan withholdings, payouts, and bank deposits are different records about one settlement chain. Local Budget needs one canonical event for each economic fact and one journal posting path. The Brain may enrich commercial identity but may never create a second accounting fact.
- **The receipt problem was previously overstated.** Local Budget has zero ingested `Receipt` rows and zero durable receipt-to-transaction links; that is not evidence that source documents are unavailable. Gmail, the Brain, Amazon exports, Venmo statements, Square records, and vendor emails contain substantial recoverable evidence. Bulk recovery belongs after ledger identities stabilize, while evidence retention and privacy controls belong in the first architecture tranche.
- **Investor/tax readiness requires a journal and close, not a more elaborate P&L filter.** Local Budget should add immutable source events, canonical economic events, a balanced double-entry journal, subledgers, period locks, reversals, reconciliations, and reproducible close snapshots.

## Evidence status and corrected premises

All documents and memories are treated as hypotheses. Current owner statements control intent and policy; current Local Budget records control measured cash subject to reconciliation; native provider records control provider activity; executed legal and tax documents control entity, ownership, and tax conclusions.

### What is currently observed

- The live Local Budget database contains 6,611 transactions, 6,576 posted transactions, seven active financial accounts, two entities, 199 Square settlements, and 584 current reconciliation allocations.
- The current entities are `Personal` and `Local Effort`. The account list does not separately represent Weston and Catherine. The Venmo Wallet has no entity owner.
- Local Budget has zero `Receipt` rows. It has 184 line items; none is receipt-linked and all 184 are transaction-linked. Most are provider/order detail rather than retained purchase documents.
- Local Budget has 289 posted Amazon-text transactions totaling $8,101.17 from January 16, 2024 through August 19, 2026. Eleven carry an Amazon order-match candidate; 278 do not.
- Local Budget has 515 posted Eastside-text transactions totaling $25,840.49 from January 11, 2024 through August 17, 2026.
- Local Budget has 170 posted Zelle income rows totaling $40,855.25. Their account entity is populated, but payer, business purpose, and personal-custody treatment still require transaction-level evidence.
- No current Local Budget row contains a Stripe identifier or descriptor. Current database history starts January 11, 2024.
- The Venmo audit found no current P&L double count. Of 181 wallet rows expected to have a bank counterpart, 175 are linked and six P&L-neutral exceptions remain.
- The Brain has 43 historical `extraction.receipts` events, but the newer Gmail vendor-document job has produced zero document events. Its sixteen windows have processed zero messages; one has been stuck in `running` since July 13, 2026 and fifteen remain pending.
- A bounded Gmail discovery check found at least 100 broad receipt/invoice candidates, at least 100 Square candidates, at least 100 Venmo candidates, 29 Eastside candidates, and 19 Amazon candidates since January 1, 2023. These are search hits, not validated documents or coverage percentages.

### What remains hypothetical or conflicted

- The owner currently states that the business started in 2023. Capital Master Record v2.3 says it was operating since 2022. The cleanup start date must be established from formation documents, tax returns, first sales, first bank activity, and legacy Stripe records; 2022 may represent predecessor activity.
- The Minnesota Secretary of State Certificate of Organization establishes that Local Effort was formed/registered under Chapter 308B on April 21, 2026 (file 1644146400023). Activity before that date remains a predecessor/cutover question rather than a formation-date ambiguity.
- Capital Master Record v2.3 describes a Minnesota Chapter 308B cooperative taxed as a partnership and an accepted ownership schedule of Catherine 56.5%, Weston 36.5%, Sarah Olsen 5%, and Renee Owens 2%. Older Brain records contain different founder percentages and compensation. Executed member, transfer, voting, and tax documents—not the graph—must establish the legal record.
- The current owner policy is $45,000 annual compensation for each founder effective April 1, 2026, with qualifying business-paid personal expenses intended to offset deferred compensation. `PERSONAL` rows are only candidates until they name the member, document the benefit, and receive the approved accounting and governance treatment.
- The Square Capital advance is described as $2,110 with repayment near 11% of gross card sales. The executed agreement, fixed fee, payoff balance, and complete repayment schedule remain required.

## System boundaries

| Domain | Authority after remediation | Boundary |
| --- | --- | --- |
| Bank, card, wallet, processor, loan, journal, reconciliation, close, tax mappings | Local Budget | Sole accounting authority |
| Agreements, orders, fulfillment, invoices, customer and product identity | Local Effort commercial models | Supplies stable references and evidence; does not post journals |
| Knowledge graph and inference | Company Brain Postgres; Neo4j as a read projection | Discovers relationships and proposes matches; never changes accounting truth |
| Provider evidence | Square, Stripe, Plaid/bank, Venmo, Amazon, Gmail/vendor documents | Immutable inputs reconciled into Local Budget |
| Legal and tax facts | Executed records and professional conclusions | Never inferred from a transaction description or graph assertion |

The cross-repository rule is one-way for accounting: Local Effort sends or exposes stable commercial references; Local Budget publishes reviewed actuals and reconciliation status. Direct cross-database reads should be retired in favor of versioned, read-only APIs.

## Target accounting architecture

```text
Plaid / Square / Stripe / Venmo / Zelle / CSV / Gmail / uploads
                              |
                    immutable source events
                              |
              canonical economic events and links
                              |
            controlled, versioned posting rules
                              |
                  balanced journal entries
                              |
 bank / processor / loan / tax / member / AP / inventory subledgers
                              |
               reconciliation, period close, reports
```

### 1. Immutable source and evidence layer

Add a provider-neutral `SourceEvent` with provider connection and account scope, namespace, external ID, event version, occurred/received/settled timestamps, payload hash, redacted or encrypted payload pointer, signature status, parser version, replay status, and errors.

Add an immutable `EvidenceDocument` with content hash, restricted storage pointer, original source, capture time, chain-of-custody metadata, extraction version, and typed links. Current hard deletion and public receipt-file delivery must be replaced before recovered documents are treated as durable tax evidence.

Provider identities must be unique inside the provider account or connection namespace. A webhook replay or polling refresh may update the interpretation of a source event but cannot mint another economic fact.

### 2. Canonical economic events

Create stable internal objects for sale/capture, refund, processing fee, payout, bank posting, loan advance, loan withholding, internal transfer, member-paid business cost, business-paid personal benefit, member reimbursement, contribution/distribution, invoice, and evidence item.

One economic event may have many source references. This is the deduplication boundary between Square payment, order, payout, bank deposit, webhook, poll, Brain order, and manual evidence.

### 3. Entity and custody model

Represent separately:

- economic/legal actor: Weston, Catherine, Local Effort, another member, customer, vendor;
- custody account: business bank, personal bank, personal Venmo, Square clearing, Stripe clearing, card, cash, loan;
- account role and legal owner;
- counterparty and beneficiary;
- business purpose, project/business line, and tax treatment.

Business revenue received in a personal Zelle or Venmo account remains business revenue while creating a personal-custody/due-to-business balance. Moving it to the business bank clears custody; it does not create revenue again.

### 4. Balanced journal and controlled corrections

Add `ChartAccount`, `AccountingPeriod`, `JournalEntry`, `JournalLine`, posting-rule version, source/economic-event links, approval state, reversal reference, and close metadata.

Every posted entry must balance by currency and legal entity. Posted entries are immutable. Corrections reverse and replace. A closed period rejects routine changes; approved late discoveries post through an adjusting entry with prior-period disclosure where required.

Keep the current `Transaction` and `TransactionSplit` models as an operational/source compatibility projection during migration. Reports should cut over to journal lines only after two shadow closes agree and every variance is explained.

## Required channel posting models

### Square

- Customer capture: debit Square clearing; credit revenue, sales-tax payable, tips payable/revenue, discounts, and refunds according to the order decomposition.
- Processing fee: debit merchant-fee expense; credit Square clearing.
- Square Capital withholding: debit loan principal and any accountant-approved finance cost; credit Square clearing.
- Payout: debit destination bank; credit Square clearing.

There must be exactly one Square clearing ledger per Square connection/merchant scope. Linked destination banks must not share the Square transaction-ingestion role. Webhook and polling inputs converge on the same canonical payment; missing tax/tip/order detail posts to decomposition suspense until enriched.

### Venmo and Zelle

- P2P customer payment into personal custody: debit that member's custody account; credit business revenue or receivable.
- Transfer to business bank: debit business bank; credit member custody.
- Personal-paid business expense: debit expense/asset; credit due-to-member, subject to substantiation and approval.
- Business-paid personal benefit: debit due-from-member until an authorized repayment or accountant-approved compensation/distribution treatment clears it.

Transfer matching remains proposal-only unless stable statement identities or explicit user acceptance establish the pair.

### Legacy Stripe

Create a date-bounded legacy Stripe connection and clearing subledger. Import charges, refunds, disputes, fees, and payouts from the first business activity through final Stripe activity, scoped by Stripe account ID. Tie each payout to its destination-bank deposit and reconcile the 1099-K gross bridge. Unexplained amounts remain dated suspense, not forced revenue or equity.

## Remediation sequence

### Tranche 0 — preserve and baseline (now)

1. Keep every current report labeled `management draft`.
2. Preserve a versioned pre-remediation export of transactions, settlements, source identities, balances, reports, and audit events.
3. Add failing regression tests for Square connection/account duplication, webhook-plus-poll replay, ambiguous settlement matching, cross-entity references, and closed-period mutation.
4. Extend the aggregate audit to show identity/custody completeness, source-event uniqueness, processor clearing, member attribution, historical channel coverage, evidence-document linkage, and report reproducibility.
5. Disable or narrow any path that can sync the same Square connection through more than one account before changing historical rows.

Acceptance gate: a frozen baseline reproduces; no new duplicate Square economic fact can be created; no historical row is deleted.

### Tranche 1 — identity, custody, and source-event spine (P0)

1. Create separate Weston, Catherine, and Local Effort entities.
2. Assign every active account and wallet to a legal owner and custody role; retain a shared/unknown state where facts are unresolved.
3. Add namespaced immutable source events and idempotent adapters for Plaid, Square, Venmo/CSV, manual imports, and receipts.
4. Add cross-system identity mappings for Local Budget entities, Brain entities, commercial customers/vendors, and provider accounts.

Acceptance gate: 100% of active accounts have an explicit owner or a reviewed unresolved status; duplicate provider replays create zero new economic facts.

### Tranche 2 — journal, periods, and opening balances (P0)

1. Implement the balanced posting service, chart of accounts, reversals, periods, and close locks.
2. Establish statement-backed opening balances and suspense for unresolved historical differences.
3. Add bank, processor-clearing, loan, sales-tax/tip, due-to/from-member, AP, inventory, fixed-asset, and equity accounts.
4. Backfill current source transactions into a shadow journal without changing existing P&L output.

Acceptance gate: debits equal credits; every journal entry traces to source evidence; no closed-period edit changes a prior snapshot silently.

### Tranche 3 — Square gross-to-net and debt (P0)

1. Make payment, order, fee, refund, payout, loan, and bank records converge on canonical economic events.
2. Resolve the current $288.51 fee bridge and every partial settlement without automatic deletion.
3. Import the Square loan agreement and lender schedule; produce a principal/fee/repayment roll-forward.
4. Reconcile Square clearing daily and at month-end.

Acceptance gate: every payout is explained by charges, refunds, fees, loan withholdings, and adjustments; clearing is zero or contains dated, documented timing items only.

### Tranche 4 — Venmo, Zelle, and founder/member subledger (P0/P1)

1. Preserve the current Venmo canonical rows and six P&L-neutral exceptions.
2. Attribute each personal-custody business receipt and post the clearing transfer only once.
3. Attribute each post-policy `PERSONAL` amount to Weston, Catherine, another person, or unresolved.
4. Apply only board/accountant-approved compensation, reimbursement, contribution, distribution, or patronage treatments.

Acceptance gate: no business revenue is duplicated when personal custody clears; 100% of post-policy member items are attributed and resolved or carried as an explicit related-party balance.

### Tranche 5 — historical completeness and Stripe (P1)

1. Establish whether the accounting perimeter begins in 2022 or 2023 and whether predecessor activity belongs in the business record.
2. Import legacy Stripe balance transactions and payouts.
3. Load all bank/card statements and prior filed returns for the historical perimeter.
4. Produce annual cash, processor, revenue, fee, refund, tax, and 1099-K bridges.

Acceptance gate: each historical month closes to provider and bank statements; every opening/cutoff exception is documented.

### Tranche 6 — receipt recovery and margin evidence (P1/P2)

Evidence retention controls begin in Tranche 1; the bulk hunt begins after cash identities are stable.

1. Repair or retire the stuck Brain Gmail vendor-document cursor; use Gmail as a discovery index, not the accounting archive.
2. Recover high-value and high-risk documents first: Eastside/food suppliers, Amazon multi-item orders and returns, personal-looking business costs, Venmo business outflows, fixed assets, and contractor/vendor payments.
3. Store original PDFs/images privately with hashes; OCR into a review queue; link approved documents to transactions, journal lines, and line-item allocations.
4. Track coverage by dollars, tax risk, vendor, and business line—not only receipt count.
5. Use item detail for purchasing, price drift, recipe cost, inventory, and margin analysis only after line totals and units pass review.

Acceptance gate: material expenses meet the accountant-approved substantiation policy; receipt totals/allocations tie to journal postings; OCR changes retain provenance.

### Tranche 7 — close, disclosure, and cutover (P1)

1. Add monthly reconciliation runs, checklist, preparer/reviewer sign-off, exception register, and immutable close snapshot.
2. Produce entity-scoped P&L, balance sheet, cash flow, processor bridge, loan roll-forward, sales-tax/tip roll-forward, related-party schedule, and evidence-coverage report.
3. Run the current and journal reports in parallel for two complete months.
4. Have the CPA review the close design and Minnesota cooperative counsel review member/compensation/related-party governance.

Acceptance gate: two consecutive closes reproduce exactly, all material variances are bridged, and the reports can separate Weston, Catherine, and Local Effort while disclosing related-party balances.

## First safe implementation tranche

The next code change should be deliberately narrow:

1. add regression tests proving one Square connection cannot be independently synced through its destination-bank accounts;
2. change Square sync selection to the processor-ledger account only;
3. add audit output for duplicate source identities by provider-account namespace and for account-owner/custody completeness;
4. add a non-mutating account-assignment work queue for Weston, Catherine, Local Effort, shared, and unresolved;
5. preserve the current database and reports as a dated baseline.

Do not bulk-reclassify, delete apparent duplicates, reset the Gmail cursor, import Stripe, or auto-link receipts in this tranche.

## Strongest case against this plan

Building a tax-grade journal, close system, and evidence archive in-house is expensive and creates a long-lived control burden. A mature external ledger would reach conventional accountant workflows sooner and reduce implementation risk.

The owner has chosen the in-house suite. The smallest reversible response is to build the source-event, identity, journal, and close controls behind compatibility views, keep external exports possible, and require independent accountant review before relying on the suite for filing or offering disclosures.

Pause the internal-ledger cutover if either of the first two shadow closes cannot reproduce a balanced trial balance and fully explain processor/bank/related-party differences, or if an external accountant cannot audit source-to-journal lineage efficiently.

## Decisions needed before historical posting

1. What tax/legal continuity applies to activity from the reported 2023 start through the April 21, 2026 Minnesota 308B formation?
2. What executed documents establish partnership taxation, membership, accepted ownership, voting rights, and the July 2026 transfers?
3. Which institution agreements identify Weston and Catherine as legal owners, joint owners, custodians, or authorized users for each confirmed account mapping?
4. What exact April 1 compensation authorization and settlement policy applies to each founder, and which `PERSONAL` charges qualify?
5. What are the Square Capital executed terms, current payoff, and complete remittance history?
6. Which fiscal year, filed returns, sales-tax accounts, payroll filings, and 1099-K forms define the historical close perimeter?

This is an engineering and bookkeeping-control plan, not a legal opinion, audit, reviewed financial statement, or tax determination. Accountant and Minnesota cooperative counsel approval remains required for compensation, patronage/distribution, related-party, loan-fee, tax, and disclosure treatment.
