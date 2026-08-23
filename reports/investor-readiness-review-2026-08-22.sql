-- Portable report snapshot queries.
-- These statements materialize the reviewed aggregate values documented in
-- investor-readiness-review-2026-08-22-workpaper.md. They do not query raw
-- transaction descriptions, customer data, account numbers, or provider payloads.

CREATE TEMP VIEW summary_metrics AS
SELECT * FROM (VALUES
  (-0.2307::numeric, 0.3556::numeric, 0.0000::numeric, 7115.09::numeric, 14939.91::numeric)
) AS t(gross_drift_pct, nonbusiness_gross_share, receipt_coverage_pct, partial_settlements, personal_unattributed);

CREATE TEMP VIEW report_drift AS
SELECT * FROM (VALUES
  ('Gross revenue', 'Aug 21 export', 176359.13::numeric, 0.0000::numeric),
  ('Gross revenue', 'Aug 22 live',   135678.31::numeric, -0.2307::numeric),
  ('Net revenue', 'Aug 21 export',   172058.13::numeric, 0.0000::numeric),
  ('Net revenue', 'Aug 22 live',     131835.31::numeric, -0.2338::numeric),
  ('Operating income', 'Aug 21 export', 78555.73::numeric, 0.0000::numeric),
  ('Operating income', 'Aug 22 live',   36861.60::numeric, -0.5308::numeric)
) AS t(metric, version, amount, change_pct);

CREATE TEMP VIEW report_drift_changes AS
SELECT * FROM (VALUES
  ('Gross revenue', 176359.13::numeric, 135678.31::numeric, -0.2307::numeric),
  ('Net revenue', 172058.13::numeric, 131835.31::numeric, -0.2338::numeric),
  ('Operating income', 78555.73::numeric, 36861.60::numeric, -0.5308::numeric)
) AS t(metric, export_amount, live_amount, change_pct);

CREATE TEMP VIEW entity_scope AS
SELECT * FROM (VALUES
  ('Local Effort', 87426.05::numeric, 0.6444::numeric, 36790.44::numeric),
  ('Personal',     29322.26::numeric, 0.2161::numeric, -15874.32::numeric),
  ('Unassigned',   18930.00::numeric, 0.1395::numeric, 15945.48::numeric)
) AS t(owner_entity, gross_revenue, gross_share, operating_income);

CREATE TEMP VIEW square_reconciliation AS
SELECT * FROM (VALUES
  ('All payout settlements', 62543.65::numeric, '199 payout settlements', 'Credit Square clearing; match to bank receipt'),
  ('Matched payout value', 55428.56::numeric, '122 bank allocations across 105 bank transactions', 'Proven clearing transfer'),
  ('PARTIAL payout value', 7115.09::numeric, '77 settlements without full bank allocation', 'Reconciliation exception; do not classify as revenue'),
  ('Entry-backed gross charges', 65343.70::numeric, '176 CHARGE entries', 'Gross sales/tax/tips side of Square clearing'),
  ('Entry-level processing fees', 2029.99::numeric, 'Fees on entry-backed charges', 'Merchant-fee expense; reduce clearing'),
  ('Separate fee transaction rows', 2318.50::numeric, '230 posted fee transactions', 'Reconcile $288.51 difference before posting'),
  ('Net Square Capital withholding', 4031.02::numeric, '$4,133.64 payments less $102.62 reversals', 'Reduce loan liability; never reduce sales')
) AS t(measure, amount, scope, accounting_treatment);

CREATE TEMP VIEW code_risks AS
SELECT * FROM (VALUES
  ('Critical', 'Latent', 'Square OAuth/account setup', 'Multiple accounts can share a Square connection and sync concurrently.', 'Duplicate Square activity across accounts.', 'square callback/sync/dashboard'),
  ('Critical', 'Current design', 'Square webhook enrichment', 'Webhook records total payment before polling adds tax/tip splits.', 'Revenue depends on enrichment timing.', 'square webhook/sync'),
  ('High', 'Current design', 'Settlement matching', 'Exact amount/date matching does not prove an unused, unambiguous deposit.', 'Payout may attach to unrelated bank activity.', 'settlement-matching.ts'),
  ('High', 'Current design', 'Transfer matching', 'Greedy equal-amount pairing treats all active accounts as internal.', 'Equity, reimbursements, or income can be hidden.', 'transfers service/matcher'),
  ('High', 'Current design', 'Entity ownership', 'Write paths do not enforce same-user/legal-entity ownership for referenced IDs.', 'Entity scope is advisory.', 'transactions/accounts/splits/rules routers'),
  ('High', 'Current design', 'Split/tax reporting', 'P&L trusts splits; tax vendor totals use parent transactions.', 'Reports and 1099 candidates can disagree.', 'splits/pnl/tax'),
  ('High', 'Current design', 'CSV/PDF imports', 'Bulk imports bypass common posting, identity, balance, and audit services.', 'Imports can bypass core invariants.', 'import csv/pdf'),
  ('High', 'Current design', 'Plaid idempotency', 'Initial sync checks external ID globally rather than by account/user.', 'Provider collisions can suppress or misassociate rows.', 'plaid sync/exchange-token'),
  ('High', 'Current design', 'Integration APIs', 'Some reads omit POSTED/current and tenant filters.', 'Noncurrent or future-tenant data can enter metrics.', 'integration v1 items'),
  ('High', 'Current integration', 'Local Effort Brain sync', 'Direct database reads omit some processor/status/source-identity controls.', 'Fees can be double-subtracted and API fixes bypassed.', 'localBudgetSync.js'),
  ('High', 'Security control', 'Square OAuth/repository history', 'State verification, callback logging, and documented history remediation need closure.', 'Authentication and credential exposure risk.', 'square connect/callback; security-remediation.md')
) AS t(severity, state, component, finding, impact, reference);

CREATE TEMP VIEW remediation_plan AS
SELECT * FROM (VALUES
  ('0 — Contain', 'P0', 'Label statements management draft; snapshot raw data and exports.', 'Versioned evidence packet exists before reclassification.', 'Treasurer/controller'),
  ('0 — Contain', 'P0', 'Close security controls without exposing secret values.', 'Credential rotation and OAuth checklist independently verified.', 'Engineering owner'),
  ('1 — Separate', 'P0', 'Create member/legal-entity dimensions and assign every account.', 'No unassigned account; all PERSONAL items attributed.', 'Owners + accountant'),
  ('1 — Reconcile', 'P0', 'Create Square clearing and loan liability; reconcile all processor activity.', 'Payout and lender roll-forwards tie to statements.', 'Controller'),
  ('1 — Decide', 'P0', 'Approve compensation, reimbursement, related-party, and close policies.', 'Dated resolutions/policies link to entries.', 'Board + CPA/counsel'),
  ('2 — Post', 'P1', 'Add normalized events, balanced journal, reversals, and period locks.', 'Trial balance balances; closed periods reject mutation.', 'Engineering + controller'),
  ('2 — Integrate', 'P1', 'Choose one sales stream and replace business-repo direct DB reads.', 'Parallel tests show no duplicate sales or fees.', 'Engineering'),
  ('3 — Substantiate', 'P1', 'Backfill statements, evidence, opening balances, liabilities, and subledgers.', 'Material evidence exceptions are zero or approved.', 'Bookkeeper + owners'),
  ('4 — Prove', 'P1', 'Run two independent closes and obtain accountant review.', 'All readiness gates pass twice.', 'Controller + external CPA')
) AS t(phase, priority, action, acceptance_gate, owner);

SELECT * FROM summary_metrics;
SELECT * FROM report_drift;
SELECT * FROM report_drift_changes;
SELECT * FROM entity_scope;
SELECT * FROM square_reconciliation;
SELECT * FROM code_risks;
SELECT * FROM remediation_plan;
