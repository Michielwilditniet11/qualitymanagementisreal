# Spider Web Analytics — Design & Execution Plan

**Audience for this document:** an implementation agent (Claude Sonnet) executing phase by phase, and the product owner reviewing scope.

**Goal:** evolve the 3D Spider Web from a "what is connected" visualization into a decision tool that answers the questions a Head of Procurement or CFO actually asks:

1. *Where is my money going?* (departmental / category spend)
2. *Where am I exposed?* (concentration, single-source, expiry, silent renewals)
3. *Who matters?* (key suppliers, overloaded owners, bridge entities)
4. *What happens if X fails?* (impact / blast radius)
5. *What should I do this quarter?* (ranked, narrated insights)

---

## As-is state (baseline for all phases)

- `app/src/graph/PlanetaryWeb.tsx` — 3d-force-graph scene; exports `riskScore, riskLevel, riskReasons, RISK_COLORS, fmtK, fmtDate, daysDiff`. Node objects built in `makeNodeObject()`; camera auto-centers via a 100ms polling loop; HUD overlays for risk counts and legend.
- `app/src/features/web/WebScreen.tsx` — toolbar (search, min-spend, expiring-within) + right inspection drawer (ContractDetail / EntityDetail / EmptyState).
- `app/src/graph/buildGraph.ts` — builds `GraphNode[]`/`GraphLink[]` with `neighbors: Set<GraphNode>`, per-node aggregated `value` and `contracts`. `NODE_COLORS`, `TYPE_LABELS`, `nodeRadius`.
- `app/src/data/metrics.ts` — `computeStatsByField` (EntityStats incl. healthScore, supplierConcentration, silent renewal), `portfolioSummary`, `spendConcentrationCurve`. **Underused by the web view.**
- Store: zustand (`dataStore`, `uiStore`). Styling: Tailwind + inline dark palette (`#0A0F1A` surfaces, `#1E293B` borders, `#38BDF8` accent). Tests: vitest in `app/src/tests`.

Constraints for every phase:
- Keep 3d-force-graph as the render engine; do not reintroduce React Three Fiber.
- All analytics must be pure functions in `app/src/analytics/` (new folder) with vitest coverage — no analytics logic inside components.
- Reuse the existing visual language (colors above, tiny uppercase labels, rounded-lg cards).
- `npm run build` (tsc + vite) must pass at the end of every phase; run `npm test` too.
- Commit per phase on branch `claude/procurement-analytics-spider-web-6jsda3`, push after each phase.

---

## Capability design

### A. Analysis Lenses (view modes on the 3D web)
A single segmented control "Lens" in the toolbar that re-colors/re-sizes the whole graph to answer one question at a time:

| Lens | Node color driven by | Extra visual | Question answered |
|---|---|---|---|
| Structure (default) | node type (current) | — | What's connected? |
| Spend | white→cyan intensity by node value; size by value | top-10 spend nodes get labels always-on | Where is the money? |
| Risk | green→amber→red by entity/contract risk | pulsing halo on high risk | Where am I exposed? |
| Expiry | time-to-expiry gradient (red <30d, amber <90d, blue >1y, grey no date) on contracts; entities colored by worst child | — | What's about to lapse? |
| Concentration | suppliers colored by dependency (share of their departments' spend); single-source suppliers get a warning ring | — | Who am I locked into? |
| Data quality | grey nodes with % completeness tint; missing-owner/value contracts flagged | — | Can I trust this data? |

Implementation: one pure function `lensStyle(node, lens, ctx) → { color, sizeMult, ring?, labelAlways? }` in `app/src/analytics/lenses.ts`; PlanetaryWeb consumes it in `makeNodeObject` and refreshes on lens change (same pattern as current highlight refresh).

### B. Insights Engine (the "so what" panel)
Pure function `generateInsights(contracts, nodes, links) → Insight[]` in `app/src/analytics/insights.ts`.

```ts
interface Insight {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: 'concentration' | 'expiry' | 'renewal' | 'stakeholder' | 'data' | 'spend'
  title: string        // "Acme Corp is a systemic dependency"
  narrative: string    // 1–2 sentences with concrete numbers
  valueAtRisk?: number // € affected
  nodeKeys: string[]   // graph nodes to highlight when clicked
  action?: string      // suggested next step
}
```

Detectors (each its own small function, individually unit-tested):
1. **Systemic supplier** — supplier serving ≥3 departments or ≥15% of total spend.
2. **Single-source category** — category with one supplier and >1 contract or spend above median.
3. **Cliff-edge expiry** — >X% of a department's spend expiring within 90 days.
4. **Silent renewal window** — auto-renew contracts whose notice deadline falls within 30 days (reuse metrics.ts logic).
5. **Owner overload / key-person risk** — one owner holding ≥N contracts or ≥20% of spend; also owners who are the *only* owner in a department.
6. **Orphan spend** — contracts with no owner, aggregated by department with € totals.
7. **Tail spend** — count/value of suppliers each under 1% of spend (consolidation opportunity).
8. **Concentration (HHI)** — Herfindahl index per category; flag >0.5.
9. **Expired but active** — contracts past end date still in the data.
10. **Data confidence** — completeness below threshold reduces trust; emit info insight.

Insights are ranked: severity first, then valueAtRisk desc. Clicking an insight selects/highlights its `nodeKeys` in the 3D web and switches to the fitting lens.

### C. Focus mode (ego network / blast radius)
- Double-click (or "Focus" button in drawer) on any node → dim everything outside its 1–2 hop neighborhood (opacity 0.06), camera eases toward the subgraph.
- For suppliers this doubles as **impact simulation**: the drawer shows "If this supplier fails: N contracts, €X annual value, departments A, B, C affected" — computed from the ego network.
- Esc or background click exits focus.

### D. Stakeholder & centrality analytics
`app/src/analytics/centrality.ts`:
- Degree and weighted degree (spend-weighted) per node.
- Betweenness approximation via BFS from entity nodes only (graph is small, exact is fine ≤2k nodes).
- Output feeds: "Key stakeholders" card in the EmptyState drawer (top 5 suppliers by systemic score, top 5 owners by load), and the Concentration lens.

### E. Executive summary bar (top of Spider Web)
A collapsible strip above the canvas with 5 KPIs from `portfolioSummary` + insights: Total annual spend · Value at risk (sum of critical insights) · Contracts expiring ≤90d (count + €) · Single-source categories · Data confidence %. Each KPI clickable → applies the matching lens/filter.

### Deliberately out of scope (do not build)
Multi-dataset time series (no historical data exists), currency conversion, editable data, server/backend, PDF export (Reports tab already exists), ML anything.

---

## Execution plan — phases for Sonnet

Work phase by phase. **Finish, verify, commit, and push each phase before starting the next.** Each phase below is written as a self-contained prompt.

### Phase 1 — Analytics foundation (no UI)
> Create `app/src/analytics/` with `lenses.ts`, `insights.ts`, `centrality.ts` as specified in sections A, B, D of `docs/ANALYTICS_EXECUTION_PLAN.md`. Pure functions only, typed against `app/src/data/types.ts`; reuse (import, don't duplicate) risk logic from `PlanetaryWeb.tsx` — if that creates a component→analytics import direction problem, first move `riskScore/riskLevel/riskReasons/RISK_COLORS/daysDiff/fmtK/fmtDate` into `app/src/analytics/risk.ts` and re-export them from `PlanetaryWeb.tsx` so `WebScreen.tsx` keeps working. Add `app/src/tests/insights.test.ts` and `centrality.test.ts` with small synthetic contract fixtures covering every detector (positive + negative case each). `npm test` and `npm run build` must pass.

### Phase 2 — Lenses in the 3D web
> Wire the lens system into the Spider Web. Add a segmented "Lens" control to the WebScreen toolbar (Structure / Spend / Risk / Expiry / Concentration / Data). Thread the selected lens into `PlanetaryWeb` via props; inside `makeNodeObject`, call `lensStyle()` for color/size/ring/label decisions instead of hardcoded NODE_COLORS when a non-Structure lens is active. Follow the existing ref-based pattern (like `selectedRef`) to avoid stale closures, and trigger a node-object refresh on lens change the same way selection changes do. Update the top-left legend to describe the active lens (color scale meaning). Verify visually with the Playwright screenshot flow used earlier (dev server port 5200, chromium at /opt/pw-browsers) — take one screenshot per lens and confirm colors actually differ.

### Phase 3 — Insights panel
> Replace the EmptyState drawer content in `WebScreen.tsx` with an Insights panel: ranked list from `generateInsights`, grouped by severity, each card showing severity dot, title, narrative, and value-at-risk chip. Clicking a card: (a) sets the graph highlight to the insight's `nodeKeys` (add a `highlightKeys` prop to PlanetaryWeb reusing the existing highlightSet mechanism), (b) switches to the lens named by the insight's category (concentration→Concentration, expiry/renewal→Expiry, spend→Spend, data→Data, stakeholder→Structure), (c) shows a "clear" affordance. Keep the three summary StatRows above the list. Add a "Key stakeholders" card (top suppliers/owners from centrality.ts) below the insights.

### Phase 4 — Focus mode & impact simulation
> Implement focus mode per section C: double-click a node (3d-force-graph `onNodeClick` already exists — add dblclick detection via click timestamp, or use `onNodeRightClick`) to enter focus; dim non-neighborhood nodes/links via the lens/refresh mechanism; `cameraPosition` transition toward the ego subgraph centroid over 800ms. In the drawer for a focused supplier/owner/category, add an "Impact if lost" card: contracts count, € annual value, affected departments list. Esc key and background click exit focus. Make sure focus, lens, and search highlighting compose without fighting (define precedence: focus dims first, then lens colors, then search/selection rings).

### Phase 5 — Executive summary bar + polish
> Add the collapsible executive KPI strip (section E) above the toolbar in WebScreen; each KPI click applies its lens/filter. Then a polish pass: consistent number formatting via `fmtK`, empty/zero states for every new panel, drawer scroll behavior with long insight lists, and a final Playwright visual check of all lenses + focus mode + insights click-through. Run `npm test` and `npm run build`. Update `README.md` (or create `docs/FEATURES.md`) with a short user-facing description of lenses, insights, and focus mode.

### Working agreements for the implementing agent
- Read `PlanetaryWeb.tsx` fully before touching it; its init-once/refresh pattern and camera polling are load-bearing.
- Never put computation in render paths — memoize analytics with `useMemo` keyed on `contracts`.
- If a phase's spec conflicts with what you find in code, prefer the code's existing pattern and note the deviation in the commit message.
- One commit per phase, message format: `Phase N: <capability>`.
