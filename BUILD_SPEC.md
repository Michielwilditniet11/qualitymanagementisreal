# ProcurementWeb — Full Build Specification & Development Run

> **How to use this document:** paste it into a Claude (Sonnet/Opus) coding session as the
> task description. It is written as a self-contained work order: architecture, data model,
> feature specs, build order, and acceptance tests. Build phases strictly in order — every
> phase ends with a working, testable product. A v1 prototype already exists in this repo
> (`procurement-analytics.html`) and can be used as reference for the graph and diagnostics
> logic, but the full tool is a fresh, structured codebase.

---

## 1. Product summary

A procurement analytics portal. A user uploads their ERP data (CSV/XLSX in v1, live ERP
connectors later) and gets:

1. **Spider web** — an interactive, draggable force-directed network of contracts, contract
   owners, suppliers, departments, and categories, showing how everything connects.
2. **Full diagnostics** — a per-category and per-department health assessment of the whole
   procurement portfolio: spend, supplier concentration, expiries, data quality, risk score.
3. **Action tools** — renewal calendar, Kraljic matrix, savings/tail-spend analysis, exportable reports.

**Guiding principle:** all data processing happens client-side in the browser. No procurement
data ever leaves the user's machine in Phases 1–4. This is the product's core trust promise
and must never be silently broken.

## 2. Tech stack (decided — do not re-litigate)

- **Framework:** React 18 + TypeScript + Vite. Single-page app, static build.
- **Styling:** Tailwind CSS. Dark theme default, light theme supported.
- **Graph:** `d3-force` for simulation + custom canvas renderer (NOT SVG — must stay smooth
  at 2,000+ nodes). No react-force-graph wrapper; own the render loop.
- **Charts:** Recharts for dashboard charts.
- **Parsing:** PapaParse (CSV), SheetJS/`xlsx` (Excel).
- **State:** Zustand. One store for the dataset, one for UI state.
- **Persistence:** IndexedDB via `idb` — saved workspaces, column mappings, annotations. Local only.
- **Testing:** Vitest (unit), Playwright (e2e). Chromium executable may need
  `executablePath` pinning in CI containers.
- **Hosting:** static output on GitHub Pages (set Vite `base` accordingly). No backend until Phase 5.
- **Repo layout:**
  ```
  /app                  ← Vite project
    /src
      /data             ← parsing, mapping, validation, derived metrics (pure TS, no React)
      /graph            ← force simulation, canvas renderer, interaction
      /features         ← one folder per screen: upload, web, diagnostics, calendar, kraljic, reports
      /components       ← shared UI
      /store
      /tests
  index.html            ← existing site landing page (leave untouched)
  procurement-analytics.html  ← v1 prototype (leave as-is, becomes /legacy demo)
  ```

## 3. Data model

All computation flows from one normalized shape. Parse once → normalize → everything else is
pure functions over `Dataset`.

```ts
interface Contract {
  id: string;                 // from file or generated
  name: string;
  supplier: string;
  category: string;           // leaf category
  categoryPath?: string[];    // optional hierarchy, e.g. ["IT", "Software", "SaaS"]
  department: string;
  owner?: string;
  annualValue?: number;       // EUR normalized
  currency?: string;
  startDate?: Date;
  endDate?: Date;
  noticePeriodDays?: number;
  autoRenew?: boolean;
  status?: string;            // raw from file
  paymentTerms?: string;
  tags: string[];
  raw: Record<string, string>; // untouched source row, for the detail drawer
}

interface Dataset {
  contracts: Contract[];
  importedAt: Date;
  sourceName: string;
  mapping: ColumnMapping;      // persisted so re-imports auto-map
  issues: DataIssue[];         // every row-level parse problem, never silently dropped
}

interface DataIssue { row: number; field: string; kind: "missing"|"unparseable"|"duplicate"; detail: string; }
```

**Derived entities** (computed, memoized — never stored): suppliers, categories, departments,
owners, each with: contract list, total spend, spend share, contract count, expiry profile,
risk flags.

## 4. Development run — phases, in order

Each phase = one or more commits, ends green (typecheck + unit tests + e2e smoke), ends with
a deployable build. Do not start phase N+1 with phase N failing.

### Phase 0 — Scaffold (½ day)
1. Vite + React + TS + Tailwind + Vitest + Playwright scaffold under `/app`.
2. App shell: header with logo/nav tabs (Upload · Spider Web · Diagnostics · Calendar ·
   Kraljic · Reports), dark theme, empty routed screens.
3. CI-friendly scripts: `dev`, `build`, `test`, `test:e2e`, `typecheck`.
4. GitHub Actions workflow: on push → typecheck, test, build, deploy `/app/dist` to Pages.
**Acceptance:** `npm run build` produces a static site; e2e smoke opens the shell and clicks all tabs.

### Phase 1 — Data ingestion (1–2 days)
1. **Upload screen:** drag-and-drop + file picker for `.csv`, `.xlsx`, `.tsv`. Multi-file
   allowed (rows concatenated).
2. **Column mapper UI:** after parse, show detected columns → target-field mapping with
   auto-guess (fuzzy match against alias lists incl. Dutch/German/French aliases; reuse the
   alias table from the v1 prototype and extend it). User can correct mappings; preview table
   of first 20 mapped rows updates live. Mapping saved to IndexedDB keyed by header signature.
3. **Validation report:** counts of rows imported / rows with issues; expandable issue list
   (row, field, problem). Duplicate contract-id detection. Currency symbol/format
   normalization (`1.234,56 €`, `$1,234.56`, plain numbers).
4. **Sample datasets:** two built-in demos — "Mid-size company" (~150 contracts, multiple
   currencies, deliberate data-quality problems) and "Clean small" (~25). Demo loads with one click.
5. **Workspace persistence:** dataset auto-saved to IndexedDB; on revisit, offer "Continue
   with previous data (imported <date>) / Start fresh". Explicit "Delete all local data" button.
**Acceptance:** unit tests for parser edge cases (quoted fields, `;` delimiter, BOM, CRLF,
European numbers, DD-MM-YYYY vs YYYY-MM-DD); e2e: upload fixture CSV → correct row count and
mapped preview.

### Phase 2 — Spider web (2–3 days)
1. **Graph build:** nodes for department / category / supplier / owner / contract; links
   contract→each of its entities, plus category→department and owner→department rollup links.
   Node size ∝ √spend; color by type (department blue, category amber, supplier red, owner
   green, contract purple — keep v1 palette).
2. **Renderer:** canvas, devicePixelRatio-aware, `d3-force` simulation with alpha decay;
   simulation pauses when settled and reheats on interaction. Target 60fps at 2,000 nodes
   (throttle labels: contract labels only above zoom threshold or when highlighted).
3. **Interaction:** drag node (pins it while dragging), drag background to pan, wheel/pinch
   zoom, click to select. Selection dims non-neighbors, side panel shows entity details
   (contract: all fields incl. raw row; entity: spend rollup, linked entities as chips,
   contract list with click-through).
4. **Controls:** type filter checkboxes with counts; search box (typeahead over all node
   names, selecting zooms/centers the node); spend threshold slider ("hide contracts below
   €X"); "expiring within N days" highlight toggle that tints affected contract nodes;
   re-layout button; fit-to-view button.
5. **Focus mode:** double-click an entity → sub-web of only that entity + everything within
   2 hops, breadcrumb to return.
6. **Export:** PNG snapshot of current view.
**Acceptance:** e2e: load demo → node counts per type match dataset; click supplier → side
panel shows its contracts; search "FlexForce" → node centered/selected. Manual perf check
with generated 2,000-contract fixture.

### Phase 3 — Diagnostics (2–3 days)
1. **Portfolio overview:** stat tiles (total spend, contracts, suppliers, avg contract value,
   expiring ≤90d, expired, % spend with missing data); spend by category and by department
   bar charts; top-10 suppliers by spend; spend concentration curve (cumulative % spend vs
   suppliers — the "how few suppliers hold 80%" view).
2. **Per-category and per-department diagnostic cards** (port + extend v1 logic):
   - spend, contract count, supplier count, top-supplier share
   - risk flags: supplier concentration >60/80%, single-source, expired contracts,
     expiring ≤90d and 90–180d, missing owner, missing value, missing end date,
     auto-renew within notice window ("silent renewal risk")
   - **health score 0–100** with documented formula (keep v1 weights as starting point);
     score badge color-coded; clicking any flag lists the offending contracts.
3. **Drill-down page per entity:** route like `/diagnostics/category/IT%20Hardware` with its
   contracts table (sortable, filterable), spend trend if dates allow, its mini spider-web.
4. **Data quality score:** overall % of fields populated/parseable, per-field completeness
   bars, direct link back to the issues list from Phase 1.
5. **Cross-links:** every entity name anywhere is a link → its drill-down; "show in web"
   button → jumps to spider web with that node selected.
**Acceptance:** unit tests for every metric on a hand-computed fixture (concentration, score,
expiry buckets); e2e: demo data → known card count and known flags appear.

### Phase 4 — Action tools (2–3 days)
1. **Renewal calendar:** timeline/list of contracts by end date, grouped by month; notice
   deadlines computed (`endDate − noticePeriodDays`) and shown as the actionable date;
   overdue-notice highlighted; ICS export ("add renewal deadlines to my calendar").
2. **Kraljic matrix:** 2×2 scatter — supply risk (proxy: supplier concentration +
   single-source + category supplier count) vs spend impact. Quadrant labels (Strategic,
   Leverage, Bottleneck, Non-critical), per-quadrant recommended tactics text, drag a
   category to override its position manually (override persisted).
3. **Tail-spend view:** Pareto of suppliers, tail cutoff slider, "N suppliers = X% of spend"
   callout, consolidation candidates (same category, multiple small suppliers).
4. **Annotations:** free-text note + status (`review`, `renegotiate`, `terminate`, `ok`) on
   any contract, stored in IndexedDB, surfaced in web tooltips, diagnostics, and report.
5. **Report export:** one-click self-contained HTML report (exec summary, portfolio stats,
   top risks, per-department one-pagers, renewal list for next 12 months) via browser print
   → PDF, print stylesheet included. Also CSV export of the enriched/normalized dataset.
**Acceptance:** ICS opens in a calendar app; report renders without the app running (fully
inline assets); Kraljic override survives reload.

### Phase 5 — SaaS & live connectors (later, only after user demand — separate spec)
Auth + workspaces (Supabase), team sharing, scheduled ERP sync. Connector order by customer
base: Exact Online, AFAS, SAP OData, Business Central. Not part of this build run; do not
scaffold for it beyond keeping `/data` pure and framework-free.

## 5. Additional functionality backlog (post-run, prioritized)
1. PO/invoice-line second file type → maverick-spend detection (spend without contract).
2. Contract-vs-actual spend variance once both files exist.
3. Savings tracker (baseline vs negotiated, realized vs projected).
4. Multi-currency with user-set FX rates.
5. Category hierarchy editor (drag categories into trees; rollups recompute).
6. Benchmark hints (static ranges per category: typical payment terms, concentration norms).
7. Scenario mode: "what if we consolidated these 3 suppliers" — clone dataset, edit, diff dashboards.
8. i18n (EN/NL first).

## 6. Non-functional requirements
- 2,000 contracts: import <3s, graph interactive at ~60fps, diagnostics render <1s.
- Everything keyboard-accessible; charts have text equivalents; color-blind-safe palette check.
- Works fully offline after first load (static assets cached; it's a Pages site — a service
  worker is optional, don't over-engineer).
- No network requests containing user data, ever (add an e2e test asserting zero non-static
  requests after import).
- Browser support: last 2 Chrome/Edge/Firefox/Safari.

## 7. Definition of done for the whole run
- All phase acceptance tests green in CI; Pages deploy live.
- Fresh user can: load demo → explore web → read diagnostics → export a report, in under
  2 minutes without instructions.
- README with screenshots, feature list, and the "your data never leaves your browser" claim
  backed by the network-silence test.
