# Diagnostics Deep Dive — Design & Execution Plan

**Problem:** the Diagnostics tab is descriptive, not prescriptive. It shows
spend by department, a concentration curve and per-entity flag cards — a head
of procurement already knows most of it from the KPI strip. It never answers
the questions that justify the tab existing: *which contract terms are working
against us, where is the money we could get back, what lever do I pull with
which supplier, and when must I act?*

**Goal:** turn Diagnostics into a prescriptive workbench with three pillars —
a **terms & conditions audit**, a **negotiation levers engine** with a ranked
action queue, and a **savings opportunity estimator** — plus sharper cuts of
the portfolio (heatmaps, scatter, renewal load). Every recommendation carries
the number behind it, and every estimate is labelled as an estimate with its
assumption visible. No fake precision.

---

## As-is (baseline)

- `app/src/features/diagnostics/DiagnosticsScreen.tsx` — 6 stat tiles, three
  recharts (spend by dept, spend by category, concentration curve), per
  category/department `DiagCard`s with text flags from `EntityStats`.
- Data per contract (`app/src/data/types.ts`): supplier, category, department,
  owner, annualValue, currency, startDate, endDate, noticePeriodDays,
  autoRenew, status, **paymentTerms** (mapped by the parser but unused
  anywhere), tags, and `raw: Record<string,string>` holding every unmapped CSV
  column.
- Analytics already available and to be reused, never duplicated:
  `analytics/risk.ts` (riskScore, daysDiff, fmtK), `analytics/insights.ts`
  (ten detectors, hhi), `analytics/centrality.ts`, `analytics/timeline.ts`
  (window/rows/annotate), `data/metrics.ts` (EntityStats,
  spendConcentrationCurve, portfolioSummary).
- Recharts is a dependency and stays the charting layer here (the 3D web and
  timeline are custom; Diagnostics is conventional charts and that is fine).
- Visual language: surfaces `#171e2e`/`#0A0F1A`, borders `#2a3650`/`#1E293B`,
  accent `#4da3ff`/`#38BDF8`, urgency red `#DC2626` amber `#D97706` green
  `#059669`, entity hues in `NODE_COLORS`.

Constraints (same regime as the previous plans):
- All computation in pure functions under `app/src/analytics/` with vitest
  coverage; components only render memoized results.
- `npm test` + `npm run build` green per phase; Playwright visual check
  against the dev server (port 5200, chromium at /opt/pw-browsers) before each
  commit; no horizontal page overflow; no new dependencies.
- One commit per phase (`Diagnostics N: <capability>`) on
  `claude/procurement-analytics-spider-web-6jsda3`, pushed after each phase.

---

## Domain grounding (why these analytics and not others)

The instruction below encodes standard procurement practice so the implementer
does not have to re-derive it:

- **Evergreen trap**: auto-renew + a notice period means the *real* decision
  date is `endDate − noticePeriodDays`, not the end date. Missing the window
  locks another term. Auto-renew with *no recorded notice period* is worse:
  the register cannot even say when the decision is due.
- **Supplier-friendly paper**: notice periods ≥ 120 days on the customer side,
  auto-renew defaults, and terms that renew for the original length are
  classic supplier-drafted clauses. Long notice on strategic single-source
  spend compounds switching cost.
- **Payment terms are cash**: extending average payment terms releases working
  capital worth roughly `spend × days_extended / 365` in cash, and
  `× WACC` of that annually in financing value. The cheapest lever is
  *harmonisation*: when one supplier already accepts 60 days on one contract
  and 30 on another, moving the 30 to the achieved 60 needs no negotiation
  capital at all.
- **Co-terming**: several contracts with one supplier ending on scattered
  dates means negotiating each renewal alone, smallest first. Aligning end
  dates bundles the volume into one event.
- **Leverage is time-bound**: negotiating power peaks *before* the notice
  deadline of the largest expiring contract and collapses after it. So the
  output must be an action queue with act-by dates, not a static list.
- **Tail consolidation**: many sub-1% suppliers each carry fixed overhead
  (onboarding, compliance, invoicing). Framework-agreement consolidation
  typically saves 5–15% of tail spend — use the conservative bound and label
  it an estimate.
- **Fragmented categories**: a category with many suppliers and low HHI is a
  bundling opportunity (volume discount, typically 5–10% on the moved spend);
  a category with HHI near 1 is a dependency problem instead. Both extremes
  are findings; the middle is healthy.
- **Estimates discipline**: every € opportunity figure is a heuristic range,
  computed from a named assumption the UI shows (e.g. "assumes 8% WACC",
  "assumes 5% consolidation saving"). Never present a point estimate without
  its assumption. Defaults: WACC 8%, tail saving 5%, bundling saving 5%,
  shown in one assumptions strip the user can read (making them editable is a
  stretch goal, not required).

---

## Design

### Pillar 1 — Terms & Conditions audit (`analytics/terms.ts`)

`auditTerms(contracts) → TermFinding[]` where each finding names the contract,
the clause problem, the money exposed and the fix. Detectors:

1. **Evergreen without a decision date** — autoRenew true and no
   noticePeriodDays. Severity critical; the register cannot produce an act-by
   date.
2. **Closed notice window** — autoRenew, notice period known, deadline already
   past, not yet expired (reuse timeline's silentRenewalRisk logic via a
   shared helper, don't re-implement).
3. **Supplier-friendly notice** — noticePeriodDays ≥ 120. Warning; on a
   single-source supplier, escalate to critical.
4. **Short-fuse notice on big spend** — noticePeriodDays ≤ 30 and annualValue
   in the portfolio's top quartile: 30 days is not enough time to run an
   alternative for material spend.
5. **Term/renewal asymmetry** — contract term (endDate − startDate) ≥ 3 years
   with auto-renew: long lock-ins that renew silently.
6. **Payment terms spread** — parse `paymentTerms` free text to days
   (`parsePaymentDays`: "30", "NET 30", "net30", "60 dagen", "EOM+45" → best
   effort number, null when unparseable). Flag suppliers whose contracts carry
   different parsed terms — harmonisation to the best achieved term, with the
   working-capital € value.
7. **Below-market terms** — parsed terms < 30 days on non-trivial spend:
   paying faster than the conventional floor.
8. **Raw-clause keyword scan** — scan `contract.raw` values (the unmapped CSV
   columns) case-insensitively for indexation/uplift language
   (`indexation, index, CPI, inflation, uplift, price increase, escalation`)
   and unilateral-change language (`unilateral, at supplier's discretion`).
   Emit *informational* findings ("indexation language found in column
   'remarks'") — this is a pointer for a human, never a conclusion.
9. **Status hygiene** — status says Active/aktief while endDate is past, or
   status says Expired/terminated while endDate is future: the register
   contradicts itself.

Output shape:
```ts
interface TermFinding {
  id: string
  severity: 'critical' | 'warning' | 'info'
  clause: 'auto-renewal' | 'notice' | 'term-length' | 'payment' | 'raw-scan' | 'status'
  contractIds: string[]
  title: string          // "Microsoft licensing EA renews silently in 41 days"
  detail: string         // one sentence, concrete numbers
  exposure?: number      // € affected
  fix: string            // the action, phrased imperatively
  actBy?: Date           // when the fix stops being possible
}
```

### Pillar 2 — Negotiation levers engine (`analytics/levers.ts`)

Per supplier: `supplierLeverage(contracts) → SupplierLeverage[]`:

```ts
interface SupplierLeverage {
  supplier: string
  spend: number
  contractCount: number
  departments: string[]
  position: 'strong' | 'balanced' | 'weak'   // our position, not theirs
  levers: Lever[]
  nextWindow?: { contract: string; actBy: Date; value: number }
  leverageScore: number    // 0–100, drives sort order
}
interface Lever {
  kind: 'renewal-window' | 'consolidation' | 'co-terming' | 'competition'
        | 'payment-terms' | 'volume-growth'
  title: string
  detail: string           // concrete: which contracts, which dates, which €
  estimate?: { low: number; high: number; assumption: string }
}
```

Lever detectors per supplier:
- **Renewal window** — largest contract whose notice deadline is 0–180 days
  out: name the act-by date and the spend on the table. This is the anchor
  lever; a supplier with an open window sorts above one without.
- **Consolidation** — ≥ 2 contracts with this supplier: bundle into one
  agreement/one negotiation (estimate: bundling % on the smaller contracts'
  spend).
- **Co-terming** — ≥ 2 contracts with end dates > 90 days apart: propose
  aligning shorter ones to the anchor end date so future renewals negotiate as
  one.
- **Competition** — other suppliers already active in the same categories:
  name them ("PackRight can be benchmarked against 2 other Packaging
  suppliers"). Its absence (single-source) flips `position` toward 'weak' and
  the card says so honestly — the lever is then *building* an alternative.
- **Payment terms** — spread found by Pillar 1 for this supplier: harmonise to
  best achieved, € working-capital value with WACC assumption.
- Position: strong = open renewal window + competition exists + we are a
  multi-contract customer; weak = single-source or closed windows; else
  balanced. Keep the scoring function simple and unit-tested, weights as
  named constants.

Portfolio-level: `negotiationCalendar(contracts) → ActionItem[]` — every
contract with a computable decision date in the next 12 months, ranked by
`actBy` then value: `{ contract, supplier, actBy, daysLeft, value, action }`
where action is "serve notice or renegotiate before …" / "renewal event —
market-test". This is the queue a CPO works top-to-bottom on Monday morning.

### Pillar 3 — Savings estimator (`analytics/savings.ts`)

`savingsOpportunities(contracts) → Opportunity[]`, each
`{ kind, title, detail, low, high, assumption, contractIds }`:

1. **Tail consolidation** — reuse insights' tail detection; 5–15% of tail
   spend.
2. **Category bundling** — categories with ≥ 3 suppliers and HHI < 0.4:
   5–10% of the spend that would move to the lead supplier (all but the
   largest's share).
3. **Payment-terms harmonisation** — sum of per-supplier working-capital
   values from Pillar 1 (financing value at WACC as the annual saving).
4. **Silent-renewal interception** — spend on contracts whose window is still
   open but closing ≤ 90 days: renegotiating instead of rolling over is
   conservatively worth 2–5% (label: "negotiation typically recovers
   inflation-linked uplift").
5. **Duplicate supplier relationships** — same supplier under multiple
   departments with separate contracts (already priced separately):
   consolidation candidate, counted once with Pillar 2's consolidation lever
   (do not double count in the total — build the total from a de-duplicated
   contract set per kind, and test that the sum of opportunity `high`s never
   exceeds total spend).

`savingsSummary(opps)` → `{ low, high, byKind }` for the waterfall.

### Dashboards (rebuild of `DiagnosticsScreen.tsx`)

Layout top to bottom; tab keeps its name. All charts recharts, styled to the
dataviz conventions already used in the file (dark tooltip, muted axes):

1. **Action strip** — headline numbers: estimated addressable savings
   (low–high range), open negotiation windows count, critical term findings
   count, next act-by date. Each scrolls to its section.
2. **Negotiation calendar** — the ranked action queue as a compact table:
   act-by date (red ≤ 30d, amber ≤ 90d), contract, supplier, value, action.
   Rows expandable for detail. This section leads because it is the "so what".
3. **Savings waterfall** — horizontal stacked/waterfall bar from the by-kind
   summary, each segment labelled with its range and assumption on hover; an
   assumptions footnote line under the chart listing WACC and % heuristics.
4. **Supplier leverage board** — top ~10 suppliers by leverageScore as cards:
   position badge (strong/balanced/weak), spend, next window countdown, lever
   chips; click expands the full lever list with estimates. Sort control:
   leverage / spend / next window.
5. **T&C audit table** — findings grouped by clause type with severity dots,
   exposure column, fix text, act-by where present; filter chips per clause
   type. Raw-scan findings visually separated as "found in source data —
   review manually".
6. **Sharper cuts** (replacing the two flag-card grids, keeping the three
   existing charts in a collapsed "Classic views" section):
   - **Dept × category heatmap** — CSS-grid cells shaded by spend (log scale),
     the fastest answer to "who buys what".
   - **Risk × spend scatter** — recharts ScatterChart: x = risk score,
     y = annual value (log), point colour by urgency, so the eye finds the
     top-right (big and risky) instantly.
   - **Renewal load by quarter** — stacked bar of expiring value per quarter
     per department: shows the Q3 pile-up a list never shows.
   - **Payment terms distribution** — histogram of parsed days with the
     spend-weighted average marked (only when ≥ 30% of spend has parseable
     terms; otherwise show a "not enough payment-terms data" note instead of a
     misleading chart).

### Honesty rules (bind every phase)

- An estimate never renders without its assumption within one glance
  (tooltip or footnote on the same card).
- A detector that lacks data stays silent or says "cannot assess — field
  missing" — it never guesses. Payment-terms analytics are skipped entirely,
  with a note, when the field is absent from the mapping (the sample CSV has
  no payment terms column: the screen must look complete without them, and the
  tests must cover both presences).
- Raw-text scans produce pointers ("review clause in column X"), never
  conclusions.
- The savings total is a range, de-duplicated across kinds, and capped by
  construction below total spend.

---

## Execution plan — phases for Opus/Sonnet

Work phase by phase; finish, verify, commit, push before the next.

### Diagnostics 1 — terms audit + payment parsing (no UI)
> Read `docs/DIAGNOSTICS_DEEP_DIVE_PLAN.md` (Pillar 1 and the honesty rules).
> Create `app/src/analytics/terms.ts`: `parsePaymentDays(text) → number|null`
> and `auditTerms(contracts, now?) → TermFinding[]` implementing the nine
> detectors. Extract the silent-renewal predicate shared with
> `analytics/timeline.ts` into one helper rather than re-implementing it.
> Inject `now` everywhere (the timeline plan's clock bug is the cautionary
> tale). Add `app/src/tests/terms.test.ts`: parser cases ("NET 30", "net30",
> "30", "60 dagen", "EOM+45", garbage → null), a positive and negative case
> per detector, top-quartile boundary for the short-fuse rule, raw-scan
> keyword hit and miss, and the status-contradiction cases both ways.
> `npm test` and `npm run build` green.

### Diagnostics 2 — levers + savings engines (no UI)
> Implement Pillar 2 (`analytics/levers.ts`) and Pillar 3
> (`analytics/savings.ts`) as specified, reusing `analytics/insights.ts`'s
> hhi/tail logic and Pillar 1's payment findings (import, don't copy).
> Heuristic constants (WACC 0.08, TAIL_SAVING 0.05–0.15, BUNDLING 0.05–0.10,
> RENEGOTIATION 0.02–0.05) live as named exports in one place. Tests:
> leverage position classification for strong/balanced/weak fixtures,
> renewal-window lever appears only inside 0–180 days, co-terming needs > 90
> day spread, calendar sorted by actBy, savings total de-duplication (a
> contract in two kinds counts once) and the ≤ total-spend invariant,
> assumption strings present on every estimate. `npm test` + `npm run build`.

### Diagnostics 3 — action strip, negotiation calendar, savings waterfall
> Rebuild the top of `DiagnosticsScreen.tsx`: action strip, negotiation
> calendar table with expandable rows, savings waterfall with the assumptions
> footnote (Dashboards 1–3). Keep the existing stat tiles below the action
> strip. Memoize every analytics call on `contracts`. Playwright: load sample
> data, screenshot; verify at least one act-by date renders red or amber, the
> waterfall shows a low–high range, and the assumptions line is present; no
> console errors, no horizontal overflow.

### Diagnostics 4 — supplier leverage board + T&C audit table
> Add Dashboards 4–5. Leverage cards expand/collapse; sort control works;
> single-source suppliers show position 'weak' with the build-an-alternative
> lever. T&C table filter chips work; raw-scan findings carry the "review
> manually" treatment. Playwright: expand a supplier card, filter the audit
> to 'payment', screenshot both. `npm test` + `npm run build`.

### Diagnostics 5 — sharper cuts + integration polish
> Add the heatmap, risk×spend scatter, renewal-load quarters and
> payment-terms histogram (with its data-sufficiency guard); collapse the
> three legacy charts into "Classic views". Wire cross-links: clicking a
> supplier on the leverage board or a contract in the calendar navigates to
> the Spider Web tab with that node selected (uiStore holds the pending
> selection; WebScreen consumes it once — follow the existing zustand
> patterns). Update `docs/FEATURES.md` with a Diagnostics section. Full pass:
> `npm test`, `npm run build`, Playwright over the whole tab at 1600px and
> 1100px widths.

### Working agreements
- Reuse `risk.ts`/`insights.ts`/`timeline.ts` helpers; if reuse requires
  moving a function, move it and re-export from the old site.
- Pure analytics, injected clock, named constants for every threshold used in
  a detector — tests reference the constants, not magic numbers.
- Recharts for charts here; CSS grid for the heatmap; no new dependencies.
- Follow the existing dark palette and tiny-uppercase-label idiom; tabular-nums
  on every number column.
- If the spec conflicts with what the code does, prefer the code's pattern and
  note the deviation in the commit message.
