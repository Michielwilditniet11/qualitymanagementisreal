# Spider Web — analytics features

The Spider Web tab turns the contract register into a decision tool. It answers
five questions a Head of Procurement or CFO actually asks, without needing a
query language.

## Executive KPI strip

The bar above the graph carries the five numbers worth knowing at a glance:

| KPI | Meaning |
|---|---|
| Total annual spend | Sum of annual value across the register. |
| Value at risk | Annual value of contracts flagged by a **critical** finding. Each contract counts once even when several findings flag it, so this can never exceed total spend. |
| Expiring ≤ 90 days | Count and value of contracts whose end date falls inside 90 days. |
| Single-sourced categories | Categories where every contract sits with one supplier. |
| Data confidence | Share of the six key fields (supplier, category, department, owner, annual value, end date) that are populated. Every other figure is only as good as this one. |

Each KPI is clickable and switches the graph to the lens that shows it.
"Hide" collapses the strip to a one-line summary.

## Analysis lenses

A lens recolours and resizes the whole graph to answer one question. Switching
lenses never re-runs the layout, so the network keeps the shape you have
learned to read.

| Lens | Question | What you see |
|---|---|---|
| Structure | What is connected? | Nodes coloured by type — the default map. |
| Spend | Where is the money? | Brightness and size scale with spend; the ten largest nodes stay labelled. |
| Risk | Where am I exposed? | Green → amber → red by contract risk; entities take the worst risk among their contracts. High-risk nodes are ringed. |
| Expiry | What is about to lapse? | Red under 30 days, amber under 90, blue within the year, grey where no end date exists. |
| Concentration | Who am I locked into? | Suppliers only: magenta where systemic (3+ departments or 15%+ of spend), purple where multi-department. An amber ring marks a sole source. |
| Data | Can I trust this data? | Red where fields are missing, amber where partial, grey where complete. |

## Findings panel

With nothing selected, the right drawer ranks what needs attention — critical
first, then by value at risk. Each finding is a sentence with real numbers, not
a metric:

> **FlexForce is a systemic dependency** — FlexForce holds 3 contracts worth
> €695K (9% of total spend) across 3 departments.

Ten detectors run over the register:

1. **Systemic supplier** — spans three or more departments, or 15%+ of spend.
2. **Single-source category** — one supplier holds the whole category.
3. **Expiry cliff** — 30%+ of a department's spend expires within 90 days.
4. **Silent renewal** — an auto-renew notice deadline falls inside 30 days.
5. **Owner overload** — one person owns 10+ contracts or 20%+ of spend.
6. **Orphan spend** — contracts with nobody accountable.
7. **Tail spend** — five or more suppliers each under 1% of spend.
8. **Concentration (HHI)** — a category above 0.5 on the Herfindahl index.
9. **Expired but active** — contracts past their end date still in the register.
10. **Data confidence** — completeness below 90%.

Clicking a finding pins its nodes in the graph, dims everything else, switches
to the lens that shows it best, and flies the camera to frame the cluster. The
open card also carries a suggested next step. "Clear highlight" releases it.

Below the findings, **Key suppliers** and **Contract owners** rank stakeholders
by a systemic score blending spend, department reach and connectivity.

## Focus mode and impact simulation

Double-click any node — or use **Focus on this node** in the drawer — to isolate
its two-hop neighbourhood. Everything outside dims hard and the camera eases
onto the subgraph. Esc or a background click exits.

For a supplier, owner or category, the drawer then answers the continuity
question directly under **Impact if lost**: how many contracts, what annual
value, what share of the portfolio, and which departments would have to
re-source.

Precedence when several highlights are active: focus wins, then an insight
highlight, then selection-neighbourhood highlighting.

## Reading the graph

- Number on a node = contracts linked to it.
- Node size = spend volume (scaled further by the active lens).
- Left legend describes the active lens and toggles node types.
- Orbit, zoom, click to inspect, double-click to focus.

## Where the logic lives

All analytics are pure functions under `app/src/analytics/`, unit-tested in
`app/src/tests/`, with no computation in the render path:

- `risk.ts` — contract risk scoring, entity roll-up, formatters.
- `lenses.ts` — lens definitions and per-node styling.
- `insights.ts` — the ten detectors and the ranking engine.
- `centrality.ts` — systemic scoring, ego networks, impact assessment.

Run `npm test` for the analytics suite and `npm run build` to type-check.
