# Margin Edge-Style Build Plan

## Status
- Date: 2026-02-14
- Existing equivalent capabilities:
1. Multi-source receipt ingestion (upload + inbound email)
2. OCR with structured extraction
3. Transaction splitting and classification
4. Category and vendor reporting

## Target Outcome
- Deliver invoice-to-margin workflows that behave like Margin Edge-style ops tooling:
1. Faster invoice capture from any environment
2. Reliable extraction of item, fee, shipping, tax, and total signals
3. Approval and coding workflows at line-item level
4. Vendor, item, and category margin pressure reporting

## Phase 1: Ingestion Hardening (Now)
1. Add camera + browser + email forwarding import flows in one UI.
2. Store uploaded files with size-sensitive optimization.
3. Parse and persist searchable line items (including shipping/fees).
4. Enable invoice-derived split generation into transaction splits.

## Phase 2: AP-Style Review Queue
1. Add invoice queue with statuses:
   `new`, `ocr_failed`, `needs_review`, `approved`, `posted`.
2. Add side-by-side invoice image + parsed fields + linked transactions.
3. Add bulk review actions:
   set category/classification, approve, reject, merge duplicates.
4. Add confidence thresholds and exception routing for low-confidence extracts.

## Phase 3: Vendor + Item Intelligence
1. Build normalized vendor catalog with aliases and defaults.
2. Build item catalog from line-item history and SKU-like patterns.
3. Add vendor-level defaults:
   category, classification, split templates, and payable terms.
4. Add automatic fee/shipping/tax bucketing with user override memory.

## Phase 4: Margin Analytics Layer
1. Build item-level COGS trend and volatility tracking.
2. Add landed-cost view:
   item + shipping + fees + tax.
3. Add vendor price-change alerts and inflation deltas.
4. Build contribution margin views by:
   category, vendor, item, and project/entity.

## Phase 5: Operational Automation
1. Rule engine expansion for invoice coding and split templates.
2. Human-in-the-loop auto-approval:
   auto-approve high-confidence recurring invoices.
3. Backfill engine to recode historical invoices as rules improve.
4. Add “why this coding” explainability panel for each suggested action.

## Data Model Extensions (Recommended)
1. Add `Invoice` alias/flag to current `Receipt` domain (or keep unified `Receipt` model).
2. Add invoice fields:
   `invoiceNumber`, `dueDate`, `poNumber`, `shipping`, `fees`, `discount`, `currency`.
3. Add per-line-item `lineType` enum:
   `ITEM`, `SHIPPING`, `FEE`, `TAX`, `TIP`, `DISCOUNT`, `OTHER`.
4. Add `reviewState`, `reviewedBy`, `reviewedAt` for auditability.

## UX Features to Match Margin Edge Feel
1. One-click import actions:
   `Upload`, `Snap`, `Forward Email`.
2. Exception-first workflow:
   highlight unknown items/vendors and unmatched totals.
3. Batch coding keyboard flow for rapid operator throughput.
4. Cost-pressure dashboard:
   top drivers by week/month with anomaly callouts.

## Success Metrics
1. % of invoices auto-processed without manual edits.
2. Median minutes from invoice upload to coded/approved state.
3. % of spend covered by structured line items.
4. Variance between invoice totals and linked transaction totals.
5. Margin reporting latency and user correction rate.
