# Best-Practice Procurement Analytics — Gap Analysis & Execution Plan

**Ambition:** close the distance between what this tool is — a sharp,
single-session analysis of one uploaded CSV — and what a best-practice
procurement analytics device is: a system a procurement team *runs their
cycle on*, week after week, where data survives, decisions are tracked to
outcomes, identity problems are managed, change over time is visible, and
every screen serves the same operating rhythm.

This plan is written for Opus to execute end-to-end. Phases BP1–BP8; BP1 and
BP2 are the foundation everything else stands on. Do not reorder.

---

## Part 1 — As-is audit

### What is already genuinely strong
- **Analysis engines** (all pure, tested, injected clocks): risk scoring,
  ten insight detectors, selection context, centrality/impact, six+gaps
  lenses, T&C audit (9 detectors), negotiation levers & calendar, savings
  estimator with anti-double-counting, structural gap finder, story builder.
- **Three strong surfaces**: the Spider Web (terminal shell, labelled map,
  gap phantoms, PRESENT mode), the renewal timeline, the prescriptive
  Diagnostics workbench. Cross-navigation between them.
- **Honesty discipline**: estimates carry assumptions; detectors go silent
  rather than guess; totals capped by construction.
- 208 tests; clean build; verified in-browser per phase.

### What is structurally missing (verified in code)

**Nothing survives a refresh.** `dataStore` is memory-only zustand. The
dataset, annotations, Kraljic drag-overrides, column mapping, filters, saved
views — all gone on reload. Worse, the Reports tab *tells the user*
"These persist in your browser" — currently false. `idb` is in
`package.json`, imported nowhere. This is the single largest gap between
"demo" and "device": a CPO will not re-upload and re-annotate every morning.

**One dataset, no time.** A best-practice device answers "what changed since
last quarter" and "did the savings we identified materialise". Here every
import replaces the world; there is no snapshot history, no delta view, no
trend, no savings realisation tracking. The savings estimator finds
opportunities; nothing records whether anyone acted and what it yielded.

**No identity management.** "SecureWatch" the supplier is trusted to be one
company because the string matches. Real registers contain `Acme`,
`Acme BV`, `ACME B.V.` — three suppliers to this tool, silently splitting
concentration, leverage and gap analysis. There is no normalisation, no
dedup suggestion, no merge. Same for categories. Currency is assumed EUR
(a `currency` field is parsed, then ignored by every engine and formatter).

**Decisions leave no trace.** The negotiation calendar is a to-do list you
cannot tick. No done/dismissed/snoozed on actions, no link from an insight
to "we accepted this and here is the outcome", no decision log. Annotations
exist but live only on a buried list in Reports — not on the drawer, the
calendar rows, or the diagnostics tables where decisions actually happen.

**Kraljic is decorative.** Drag-overrides are thoughtful but vanish on
reload; quadrant tactics are static text unconnected to the levers, gaps and
calendar the tool already computes; there is no per-category strategy
brief. Best practice treats the matrix as the *entry point* to category
strategy, not a poster.

**Assumptions are fixed.** WACC 8%, tail saving 5–15%, thresholds — all
named constants (good) but not adjustable (bad). A CFO who believes 10%
WACC cannot make the tool agree with their own maths, which undermines the
credibility the honesty rules bought.

**Reporting predates the intelligence.** The print report and CSV export
were built before insights, levers, T&C audit, gaps and the savings
estimator existed — the board pack contains none of them. There is no export
of the negotiation calendar, findings, or leverage board — the artefacts a
head of procurement would actually circulate.

**Platform gaps**: no onboarding beyond a drop zone; no handling of a
malformed CSV beyond silent issue rows; keyboard/focus states patchy outside
the web tab; upload mapping must be redone every import; no way to append or
merge files (e.g. this quarter's register + last quarter's).

### What best practice does NOT mean here (scope guard)
No external data (no supplier financials, no market indices, no live
benchmarks), no ML/forecasting theatre, no multi-user backend, no
authentication. Client-side, single-user, honest. Internal benchmarks only
(your best payment term is the benchmark for your worst). Any "industry
typical" number must be a named, visible, editable assumption.

---

## Part 2 — Target operating loop

The tool should support this cycle, and every phase below serves it:

1. **Import** the latest register (mapping remembered, quality report shown,
   identities resolved) →
2. **See what changed** since the previous snapshot (new/ended/changed
   contracts, spend delta, risk delta) →
3. **Analyse** (web, timeline, diagnostics — already strong) →
4. **Decide** (accept/dismiss opportunities and calendar actions, annotate,
   set category strategy) →
5. **Track** (open actions with owners and dates; savings pipeline
   identified → in-progress → realised) →
6. **Report** (board pack and exports built from the live engines) →
   repeat next month.

---

## Part 3 — Execution plan for Opus

Regime (unchanged from previous plans): pure logic in `src/analytics/` or
`src/data/` with vitest coverage and injected clocks; components render
memoized results; `npm test` + `npm run build` green per phase; Playwright
verification against the dev server (port 5200, chromium at
/opt/pw-browsers) before each commit; no horizontal overflow at 1600/1100px;
one commit per phase (`BP N: <capability>`) on
`claude/procurement-analytics-spider-web-6jsda3`, pushed. New dependency
allowed: none — `idb` is already present. Honesty rules bind every phase.

### BP1 — Persistence foundation
> Everything the user creates survives reload. Build
> `src/data/persistence.ts` on `idb`: a versioned IndexedDB schema
> (`datasets`, `snapshots`, `annotations`, `kraljicOverrides`,
> `columnMappings`, `preferences`, `decisions`) with typed load/save
> helpers and a schema-migration hook. Wire zustand stores to hydrate on
> boot and write-through on change (debounced). Persist: current dataset,
> annotations, Kraljic overrides, saved column mapping per source-header
> signature (auto-apply on re-import of a recognisable file), Spider Web
> saved state (lens, filters), and Diagnostics sort choices. Add a data
> manager panel in Upload: stored datasets list, load/delete, storage usage,
> and "Clear everything". IndexedDB unavailable (private mode) must degrade
> to memory with a visible one-line notice — never an error. Fix the Reports
> copy so the persistence claim is finally true. Tests: fake-indexeddb is NOT
> to be added — factor persistence logic so serialisation/migration are pure
> and tested, with the idb boundary thin. Playwright: import, annotate,
> reload the page, assert the dataset and annotation are back.

### BP2 — Identity & normalisation
> `src/analytics/identity.ts`: supplier-name canonicalisation (case, legal
> suffixes BV/B.V./GmbH/Ltd/Inc/SA, punctuation, diacritics) and a
> similarity-based duplicate finder (normalised-token comparison; no new
> deps) producing merge *suggestions* with confidence. A review UI in Upload
> after parsing: "These 2 names look like one supplier — merge?" Accepted
> merges persist (BP1) as alias rules applied on every future import; never
> auto-merge — suggestions only, per the honesty rules. Currency: parse the
> currency column, convert nothing silently — if >1 currency is present,
> show a rates panel (user-entered rates to the base currency, persisted,
> stamped on the dataset) and have `fmtK` take the base symbol from the
> dataset; until rates are entered, mixed-currency totals display with a
> visible "mixed currencies" warning instead of a fake sum. Tests: suffix
> stripping, diacritics, false-positive guards (PackRight vs PrintPro must
> NOT match), alias application, mixed-currency gating.

### BP3 — Snapshots & change intelligence
> Every import becomes a snapshot (BP1 store) keyed by import date.
> `src/analytics/deltas.ts`: `compareSnapshots(prev, next)` → new contracts,
> ended/disappeared, value changes, supplier changes, risk-level transitions,
> and portfolio deltas (spend, at-risk, gap exposure) — matching contracts by
> id, falling back to name+supplier. New "Changes" view (tab or Diagnostics
> section): "Since 12 May: +3 contracts (+€180K), 2 ended, Cybersecurity SOC
> risk high→critical, at-risk +€0.4M", each row navigating to the node or
> calendar entry. The ticker gains delta arrows (▲▼ with green/red per the
> terminal idiom) against the previous snapshot when one exists. Tests:
> matching fallbacks, disappearance vs rename (a renamed contract with same
> supplier+value should suggest, not assert, identity), delta arithmetic.

### BP4 — Decision workflow
> Make the to-do lists workable. Calendar/action rows (negotiation calendar,
> T&C findings, savings opportunities, gaps) get a persistent decision state:
> open / in-progress / done / dismissed (+ optional note, decided-by date,
> snooze-until). One shared `decisions` store keyed by stable item ids —
> extend the engines to emit stable ids where they don't already. Dismissed
> items drop out of KPIs and tickers (shown struck-through behind a "show
> dismissed" toggle); snoozed items resurface after their date (injected
> clock). Surface annotations where decisions happen: the drawer
> (ContractDetail gains the note/status controls), calendar expanded rows,
> and diagnostics tables — one shared component, same store as Reports.
> Add a **Decision log** section in Reports: every decision with timestamps,
> exportable as CSV. Tests: state transitions, snooze resurfacing, KPI
> exclusion of dismissed items, id stability across engine re-runs.

### BP5 — Category strategy workbench (Kraljic rebuilt)
> Persist the matrix overrides (BP1). Then make the matrix the entry point it
> should be: selecting a category shows a **category brief** assembled from
> the existing engines — spend, suppliers with leverage positions, open
> calendar items, gaps touching the category, applicable savings
> opportunities, and the quadrant's playbook *instantiated with real names*
> ("Leverage: aggregate PackRight + PrintPro volume; window closes in 39d")
> rather than generic tactics. Add a strategy note + review date per category
> (persisted; overdue reviews surface in the Changes view). Quadrant
> assignment history: when a category's computed quadrant differs from last
> snapshot's, say so. Restyle the tab to the terminal idiom. Export: one
> category brief as a print page. Tests: brief assembly pulls only engine
> outputs, playbook instantiation, review-date resurfacing.

### BP6 — Assumptions panel & savings pipeline
> One **Assumptions** panel (gear icon, both web and diagnostics reachable):
> WACC, tail/bundling/renegotiation ranges, risk thresholds (30/90-day
> urgency, long/short notice bounds), materiality floor. Values persist,
> apply everywhere (engines already take constants — refactor them to accept
> an `Assumptions` object with the current constants as defaults; UI shows
> defaults and marks deviations "adjusted"). Every figure that uses an
> adjusted assumption keeps saying so. Then the **savings pipeline**: an
> accepted opportunity (BP4) becomes a pipeline item with expected range;
> the Changes view (BP3) checks later snapshots and reports movement on the
> underlying contracts ("Packaging consolidated: 2 suppliers → 1, spend
> −€31K vs expected €19–38K") — *reported movement, never claimed
> causation*; phrase as "observed change on the contracts this opportunity
> named". Pipeline summary (identified / accepted / observed) in Diagnostics
> and the board pack. Tests: assumption threading through levers+savings,
> deviation marking, pipeline observation arithmetic against snapshot pairs.

### BP7 — Board pack & exports rebuilt
> Rebuild Reports around the engines. The print report becomes a board pack:
> executive summary with deltas (BP3), top insights with narratives, the
> negotiation calendar (next quarter), T&C critical findings, savings
> pipeline status, structural gaps, category strategy summary (BP5), decision
> log excerpt — all from the same functions the screens use, print-styled,
> with an assumptions appendix listing every heuristic and adjustment. CSV
> exports: calendar, findings, leverage board, gaps, decision log, pipeline
> (one shared csv helper, quoted/escaped, tested). Story mode's narration
> (the PRESENT steps) becomes the pack's one-page "narrative summary".
> Restyle the tab to the terminal idiom; remove the emoji tiles. Playwright:
> generate the pack, assert the sections and at least one delta and one
> assumption line render.

### BP8 — Platform hardening
> The last mile from tool to device. (a) **Import resilience**: malformed
> CSV/XLSX produces a readable error panel, not silence; the issues list
> becomes a quality report with per-field completeness bars and row-level
> fixes surfaced before import; delimiter/encoding sniffing for `;` and
> BOM files. (b) **Onboarding**: first-run overlay on the web tab (three
> lines: hover/click/present), a `?` shortcut sheet app-wide, empty states
> for every tab that say what to do, not just that nothing is there.
> (c) **Accessibility & input**: visible focus states on every control,
> aria-labels on icon buttons, the diagnostics/calendar tables keyboard
> navigable; `prefers-reduced-motion` audit across the app (story autoplay
> off under it). (d) **Coherence**: one shared format module (fmtK/fmtMoney
> duplicated in four files today), terminal palette tokens extracted to one
> place and applied to Calendar + Kraljic + Reports so all six tabs read as
> one product; tab bar shows a dataset badge (name · snapshot date · base
> currency). (e) Final sweep: full Playwright gallery across all tabs at
> 1600/1100, `npm test`, build, docs/FEATURES.md updated to the operating
> loop, README quickstart. Fix anything the sweep surfaces before the final
> commit.

### Working agreements
- Read the current code before each phase — it has changed under every
  previous plan and will again.
- Persistence is additive: stores hydrate-then-subscribe; no store API
  renames (Diagnostics/Web cross-links must keep working mid-rollout).
- Engines stay pure: assumptions and clocks are parameters, storage happens
  in stores, never inside `src/analytics/`.
- Stable ids: any list a decision can attach to must emit ids that survive
  re-import and engine re-runs; write the test first.
- Honesty rules extend to time: deltas name the snapshots compared; observed
  savings are "observed change", never "savings achieved because of us".
- If a phase's spec conflicts with engine reality, prefer what works, note
  the deviation in the commit message.
