# Finance Subledger Upgrade

## Decision

Local Budget is the authoritative cash-side subledger for bank, cash, credit, debt, and processor-clearing postings. It records what moved, preserves provider lineage, and explains how each posting reconciles to externally owned economic events.

Local Budget does not own contracts, invoices, AR/AP, inventory valuation, revenue recognition, or the general-purpose GAAP chart of accounts. Finance Core owns those objects and the final cash-to-GAAP bridge. The existing Local Budget P&L remains operational until Finance Core reproduces it and consumers complete a controlled cutover.

## Invariants

1. Posted or reconciled financial records are never silently hard-deleted. Provider removals, reversals, and replacements remain as lifecycle history and are excluded from current reporting.
2. An internal transaction ID survives provider lifecycle changes whenever the provider supplies replacement lineage. Every provider identity remains queryable.
3. Cash direction, provider lifecycle, economic classification, and reconciliation state are independent dimensions.
4. Classification splits, settlement entries, and reconciliation allocations are separate records with separate invariants.
5. Accepted reconciliation allocations sum to the transaction's matched amount. A transaction is `MATCHED` only when the unexplained amount is within one cent.
6. A processor settlement amount equals the sum of its settlement-entry net amounts within one cent. A matched bank posting equals the processor settlement amount within one cent.
7. Every material manual mutation records actor, timestamp, changed fields, before/after values, and reason in the same database transaction.
8. Historical account balances are based on a dated provider snapshot or opening balance plus signed postings. A current balance without an effective timestamp is not presented as an authoritative historical balance.
9. External Finance Core identities are logical references, not cross-database foreign keys.
10. Unmatched, partial, removed, and unresolved amounts remain visible. No reporting path silently folds them into operating expense or revenue.

## Data model

### Cash posting

The existing `Transaction` remains the stable cash-posting record. It gains lifecycle lineage, reconciliation state, and audit relations rather than being replaced.

Provider identities are stored in `TransactionSourceIdentity`, keyed by source system and external ID. This supports pending-to-posted replacements without losing the internal transaction ID.

### Reconciliation

`ReconciliationAllocation` links a cash posting to an externally owned object by `(externalSystem, externalObjectType, externalObjectId)` and amount. State and method are independent:

- state: `UNMATCHED`, `PARTIAL`, `MATCHED`, `EXCLUDED`
- method: `AUTO`, `MANUAL`, `IMPORTED`

Confidence is nullable and applies only to automated proposals or matches. Accepted allocation totals determine partial versus full reconciliation.

### Processor settlement

`ProcessorSettlement` represents a provider payout. `ProcessorSettlementEntry` represents the provider balance activities included in that payout, including charges, fees, refunds, disputes, financing deductions, reserves, payroll transfers, and adjustments.

Provider-specific payloads remain in metadata. Stable payment, refund, and payout references are materialized where supplied so downstream consumers do not parse provider JSON.

### Audit and balance evidence

`FinancialAuditEvent` records material mutations. `AccountBalanceSnapshot` stores a dated, source-labelled balance anchor. Neither replaces provider event history.

## Integration contract

Existing `/api/integration/v1` endpoints remain backward compatible. New cash-subledger resources are exposed under `/api/integration/v2`:

- `GET /accounts`
- `GET /transactions/:id`
- `GET /reconciliation/unmatched`
- `GET /cash-position?asOf=YYYY-MM-DD`

The existing cursor-based pull model remains the default. Webhooks are deferred until a consumer demonstrates a near-real-time requirement and an outbox, signatures, retries, replay, and idempotency can be delivered together.

## Delivery stages

1. Protect transaction identity: lifecycle states, source identities, provider tombstones, pending-to-posted lineage.
2. Make manual mutations atomic and auditable; correct balance mutation invariants.
3. Ingest Square payouts and payout entries; enforce settlement arithmetic and link known payment/refund records.
4. Expose account, transaction-detail, reconciliation-exception, and cash-position APIs.
5. Run Local Budget and Finance Core reporting in parallel for two closed cycles before transferring P&L ownership.

## Acceptance conditions

- Plaid removal no longer destroys the transaction row.
- A Plaid posted transaction with `pending_transaction_id` retains the pending transaction's internal ID and records both provider identities.
- Manual create, update, delete/void, bulk classification, and split replacement create audit events atomically.
- Amount, direction, or account changes preserve affected account balances.
- Square payout entries are idempotently persisted and their net sum is checked against the payout.
- Reconciled Square settlements link to their Local Budget payout transaction and expose mismatches rather than forcing them.
- V1 integration responses remain compatible.
- V2 account and reconciliation responses carry source freshness and unresolved amounts.

## Pause condition

Pause provider-neutral expansion if two closed Square settlement cycles cannot explain at least 95% of payout dollars from authoritative payout entries, or if Finance Core lacks stable external IDs. Fix the Square adapter or ownership contract before adding more provider abstractions.
