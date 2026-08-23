# Procurement Analytics Portal — Build Plan

## Vision
One comprehensive procurement analytics tool: a user connects their ERP (v1: CSV export upload)
and gets (1) an interactive, draggable "spider web" network of contracts, contract owners,
suppliers, departments and categories, and (2) a full diagnostic per category and per department.

## Recommended solution
**Phase 1 (this repo): client-side web portal, single HTML file, hosted on GitHub Pages.**
- Zero infrastructure, zero cost, instant to ship.
- All processing in the browser → the customer's procurement data never leaves their machine.
  That is a major trust/compliance advantage (GDPR-friendly) and a strong marketing line.
- Works from your existing website: just link to the page.

**Phase 2: hosted SaaS backend** (only when v1 proves demand)
- Auth + persistent workspaces (e.g. Supabase or a small Node/Postgres API).
- Live ERP connectors: SAP (OData), Oracle, Exact Online, AFAS, Unit4 — start with the ones
  your target customers actually run. Until then, every ERP can export CSV, so CSV is the
  universal connector.
- Multi-user sharing, saved diagnostics, PDF export, benchmarking across anonymized datasets.

## Data model (v1 CSV)
One row per contract. Recognized columns (flexible header matching, extra columns ignored):
`contract_id, contract_name, supplier, category, department, contract_owner, annual_value,
start_date, end_date, status, renewal_notice_days`.
A sample dataset is embedded so the tool demos itself without any upload.

## Features in v1 (implemented in `procurement-analytics.html`)
1. **CSV upload** with delimiter auto-detect, flexible header mapping, error reporting.
2. **Spider web graph**: force-directed canvas layout; node types = department, category,
   supplier, owner, contract; drag nodes, pan, zoom; click a node to highlight its
   connections and see its details + roll-up stats; filter by node type.
3. **Diagnostics dashboard**: per-category and per-department cards — total spend, contract
   count, supplier concentration (top-supplier share), expiring within 90/180 days, expired,
   missing-owner/missing-value data-quality flags, single-source risk.
4. **Portfolio health score** per category/department combining risk signals.

## Later ideas
Tail-spend analysis, maverick-spend detection (PO vs contract match), savings tracking,
contract renewal calendar with reminders, Kraljic matrix positioning.
