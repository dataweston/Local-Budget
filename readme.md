# Local Budget

Local Budget is a **personal + small-business finance system** designed for people whose money does not fit cleanly into “personal app vs accounting software.”  
It prioritizes **cashflow, receipts, margin, and intent**, while remaining internally accounting-correct.

This document describes the **full project direction**, not a single edge case.

---

## Problem Space (What We’re Solving)

Existing tools fail in predictable ways:

- Personal finance apps:
  - good at aggregation
  - bad at receipts, COGS, reimbursement logic, and mixed use
- Accounting software:
  - correct but heavy
  - assumes clean workflows, perfect separation, and trained users
- Margin tools (e.g. restaurant ops software):
  - powerful but narrow
  - assume inventory discipline and formal workflows

**Reality for small operators and households**
- Personal and business spending mix constantly
- Receipts arrive via email, photo, PDF, and memory
- Owners front cash, reimburse later, or never
- Margin questions matter more than GAAP purity
- Manual bookkeeping is deferred, avoided, or wrong

Local Budget exists in this gap.

---

## Core Goal

Create a **single system** that can:

- ingest *all* financial signals (banks, receipts, transfers)
- model *intent* (what the money was for, not just how it moved)
- support both household budgeting and small-business margin analysis
- automate categorization and reconciliation without hiding logic
- scale from “one owner + one business” to more complex structures

---

## Design Philosophy

### 1. Intent over mechanics
Users describe *what happened*.  
The system enforces *what’s true*.

### 2. Substance over form
Economic reality matters more than the payment path.

### 3. Progressive disclosure
Simple when you’re browsing.  
Precise when you’re investigating.

### 4. Human-in-the-loop automation
The system suggests.  
The user approves.

---

## Scope (Broad)

Local Budget is **not just**:
- a budgeting app
- an accounting app
- a receipt scanner
- a margin dashboard

It is a **financial modeling layer** over messy real-world behavior.

---

## Core Domains

### A. Accounts & Cashflow
- Bank and credit accounts via API (Plaid minimum)
- Unified cashflow across personal + business
- Transfers treated as signals, not assumptions
- Time-based views (daily → monthly → annual)

### B. Entities
- People (owners)
- Businesses
- Projects / events (optional layer)
Money is always associated with *who paid* and *who incurred*.

### C. Receipts & Evidence
- Receipt ingestion from:
  - email
  - photo
  - PDF uploads
- OCR + structured extraction
- Receipts as first-class objects, not attachments
- One receipt ↔ many transactions, and vice versa

### D. Classification & Meaning
- Categories that serve *analysis*, not tax forms
- Explicit distinction between:
  - COGS
  - Operating expenses
  - Personal spend
- Vendor and item normalization
- Line-item granularity where available

### E. Reconciliation & Linking
- Linking related financial events:
  - payments ↔ reimbursements
  - receipts ↔ transactions
  - partial and delayed matches
- Internal balancing logic without exposing accounting jargon

### F. Reporting & Insight
- Household budgeting views
- Business P&L views
- Margin-oriented summaries:
  - vendor spend
  - item-level costs
  - category pressure over time
- Ability to answer:
  - “Where is money leaking?”
  - “What actually costs more than I think?”

---

## Automation Strategy (Global)

Automation exists to **reduce cognitive load**, not replace judgment.

### Deterministic Layer
- rules based on vendor, item text, amount patterns
- historical behavior
- explicit user-defined mappings

### ML-Assisted Layer
- category suggestions
- COGS vs OpEx inference
- vendor and item normalization
- anomaly detection

### Control Principles
- no silent reclassification
- all changes reviewable
- undo always available

---

## Embedded Chat Agent (System-Wide)

The chat agent is not a chatbot.  
It is a **context-aware financial assistant**.

### Functions
- query transactions, receipts, and summaries
- explain why numbers look the way they do
- propose classifications or links
- draft rules (“always treat X as Y”)
- generate ad-hoc reports in natural language

### Constraints
- read-only by default
- write actions require confirmation
- operates via structured tools, not freeform mutation

---

## UX Direction (High Level)

- **Dashboard first**: cashflow and alerts
- **Graph / mind-map views** for exploration:
  - vendors → items → categories → entities
- **Exception-driven workflows**:
  - unclassified
  - duplicates
  - missing receipts
- UI should feel investigative, not clerical

---

## Technical Direction (Broad)

- Web-first application
- Modern component-based UI
- Relational core database (single source of truth)
- Background jobs for ingestion, OCR, and analysis
- API-first internal architecture
- Designed to integrate (not replace) formal accounting later

---

## Phased Roadmap (Broad)

### Phase 1 — Aggregation & Visibility
- Bank sync
- unified cashflow
- basic categorization
- manual receipt attachment

### Phase 2 — Evidence & Structure
- receipt ingestion (email + upload)
- OCR + line items
- vendor normalization
- personal vs business separation

### Phase 3 — Intent Modeling
- reimbursements
- linked transactions
- entity-aware expense logic
- clean P&L without accounting UI

### Phase 4 — Automation & Assistance
- rules engine
- ML suggestions
- embedded chat agent
- exception-based workflows

### Phase 5 — Margin Intelligence
- COGS rollups
- vendor and item pressure
- project/event costing
- trend analysis

---

## What Success Looks Like

- The user trusts the numbers without “fixing them later”
- Receipts stop being a backlog
- Mixed personal/business behavior no longer breaks reporting
- Margin questions are answerable quickly
- The system feels *for operators*, not accountants

---

## One-Sentence Definition

**Local Budget is a financial system that models real-world money behavior with accounting truth, without accounting friction.**
