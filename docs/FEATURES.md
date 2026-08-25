# Spider Web — analytics features

The Spider Web is a navigable dashboard over the contract network, styled as a
terminal: a data ticker on top, mono-set figures, one lens active at a time.


## How the tabs fit together

| Tab | What it answers | How to work it |
|---|---|---|
| **Web** | What is connected, and where is the signal? | Pick a lens; its briefing names the top three things it found here. Hover to feel the graph, click to have a node explain itself, double-click to isolate. PRESENT narrates the whole portfolio. |
| **Diagnostics** | What should I do, with whom, by when? | Use the sub-nav rail. OVERVIEW composes the rest; ACT and AUDIT are sortable tables that jump into the Calendar and the Web. |
| **Calendar** | What can I still decide, and when does it close? | Leads with decidable deadlines; overdue collapses into a band. Scroll to zoom, drag to pan, click a month bar to zoom to it. |
| **Kraljic** | What is my strategy per category? | Click a dot for a brief assembled from the engines, with a playbook naming real suppliers and dates. Drag a dot to override its position. |
| **Reports** | What do I circulate? | Print report and enriched CSV export. |

Every entity name in every tab links into the Web with that node selected.
Press `?` on the Web tab for the full keyboard sheet.

## Focus Frames — what happens when you click a finding

Every way into the web — a briefing chip, a finding, a ticker figure, a gap, an
entity link from another tab, a story step — stages the same thing: a **Focus
Frame**. A frame is never a set of floating dots, because the relationships are
the only thing the 3D view offers that a table does not.

- **It is an induced subgraph.** The subjects of the finding *plus the
  connective tissue between them* — the departments, categories, suppliers and
  owners that link them. Two hops, not one: a supplier's departments sit behind
  its contracts, so stopping at one hop would answer none of the questions the
  frame exists to answer.
- **Two tiers.** Subjects are ringed and always labelled — they outrank the
  whole field for label space. The connectors stay lit and labelled where they
  fit. Everything else drops to near-black, far deeper than a selection dims,
  so the frame reads as *the* picture.
- **Links are the point.** Every link inside the frame is drawn at full
  strength in the colour of the entity it leads to, at double weight where it
  touches a subject. Links outside it fade almost to nothing.
- **The camera always responds.** It flies to frame the members; when it is
  already there, the subjects pulse instead. No click is ever silent.
- **A card explains it.** Bottom-left: the finding, its figure, the members as
  clickable chips, what the ring and the line colours mean *in this frame*, the
  suggested next step, and a jump into the Calendar or Diagnostics where one
  applies. Arriving from another tab carries its origin into the caption.
- **One escape.** Esc releases the frame first and the selection second; the
  `FRAME …` chip in the state strip and the card's × do the same.

Frames are engine output end to end — `src/analytics/focusFrame.ts` composes
what the detectors already found and performs no analysis of its own, so a
frame can never disagree with the panel that produced it. When the surrounding
context is too large to show, the frame keeps the most connected nodes and the
caption says so rather than pretending it showed everything.

## Reading the map

- The default view is **fully labelled**: an importance-ranked label engine
  places as many names as fit and guarantees no two labels ever overlap.
  Hover always wins a label; so does the selection.
- **Hover** lifts a node, brightens its connections in their relationship
  colours, and shows a readout pill (name, type, spend, links).
- The **ticker** carries the portfolio's vitals — spend, value at risk,
  expiring 90d, open windows, structural gaps — each clickable into the lens
  that explains it.
- **Filters**: free-text find, department multi-select, risk level
  (all / medium+ / high), expiring window, minimum spend, and the node-type
  legend. Every active dimension appears as a removable chip in the state
  strip, with CLEAR ALL; breadcrumbs of recent nodes and Alt+← history live
  in the same strip.
- **Keyboard**: 1–7 lenses, F fit, S spotlight, Esc clear, arrows in story
  mode, Alt+← back.
- The **minimap** (bottom right) is a floor plan of the whole layout; click it
  to jump. The layout freezes once settled so the map you learn stops moving —
  the re-layout button reshuffles on demand.

## Gaps lens

The seventh lens renders what is *missing*: hollow wireframe phantoms with
dashed connectors mark absences — an "unassigned owner" hub, a "2nd supplier?"
slot beside every sole-source category. The drawer lists each gap with the
spend it exposes; clicking frames it.

## Present mode

PRESENT composes a narrated fly-through from the analytics engines — the
portfolio, where the money goes, the biggest dependency and its blast radius,
what is at risk, what lands next, what is missing, what to do about it. Each
step drives the lens, the highlight and the camera, with a narration card and
its key figure. Steps with nothing to say drop out. Arrow keys navigate; Esc
exits. Every number in a narration comes from the same engine the panels use.

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

Clicking a finding stages it as a **Focus Frame** (see above): its nodes plus
what connects them, lit and labelled against a dimmed field, with the lens
switched, the camera moved and a card explaining what you are looking at.

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

## Reading a selection

Selecting a node explains what surrounds it, without a second click:

- **Direct neighbours** stay at full colour and are labelled with the
  relationship — `Lisa van Dam · owner`, `HR · department`.
- **Links take the colour of the entity they lead to**, matching the node-type
  legend: green to an owner, blue to a department, amber to a category, pink to
  a supplier, purple to a contract. Direct links are drawn heavier.
- **A relevance-filtered second ring** is dimmed but visible: for a supplier or
  owner, the departments, categories and owners reached through its contracts;
  for a contract, its highest-value sibling contracts in the same department or
  category (capped at eight so a large department cannot flood the view).
- **Everything else** drops to a faint grey dot.

Labels render on a backing plate at a constant on-screen size, so they stay
readable however far the camera pulls back to frame the neighbourhood. The
drawer's chips carry the same relationship colours as the graph.

## Diagnostics

Diagnostics is prescriptive, not descriptive: it answers what to do, with whom,
and by when.

**Action strip** — addressable savings (a range), open negotiation windows,
critical term findings, and the next act-by date.

**What to act on** — every decision date in the next 12 months, soonest first.
Notice deadlines are listed as their own events, because that is when the
decision actually has to be made; a deadline already passed on a live
auto-renewing contract shows as *missed*. Supplier names link through to the
Spider Web.

**Where the money could come from** — tail-supplier consolidation, bundling in
fragmented categories, payment-terms harmonisation and renewal interception.
Every figure is a range with its assumption printed beneath it. The total
attributes each contract to the single highest rate claiming it, so overlapping
opportunities cannot inflate it past total spend.

**Supplier leverage** — our position against each supplier (strong when a
renewal window is open and a credible alternative exists, weak when
sole-sourced), the next act-by countdown, and the levers available: the anchor
renewal window, consolidating separate agreements, co-terming scattered end
dates, competitive tension from suppliers already in the category, and
harmonising to payment terms the supplier already accepts elsewhere.

**Terms & conditions audit** — nine detectors over the contract paper:

1. Auto-renewal with no notice period recorded — the decision date is unknown,
   not distant.
2. Notice window already closed on a live auto-renewing contract.
3. Supplier-friendly notice periods (120 days or more), escalated when the
   supplier is sole-sourced.
4. Notice periods of 30 days or less on top-quartile spend — not enough time to
   run an alternative.
5. Terms of three years or more that renew themselves.
6. One supplier paid on several different payment terms.
7. Paying faster than the conventional 30-day floor.
8. Indexation or unilateral-change keywords found in unmapped source columns —
   flagged as *review manually*, never as a conclusion.
9. A register that contradicts itself on status versus end date.

**Cuts of the portfolio** — risk against spend (the top-right corner is large
and exposed), renewal load by quarter, and a department-by-category heatmap.
Payment-terms analysis appears only when enough spend carries readable terms;
otherwise the tab says so rather than drawing a misleading chart. The original
charts and per-entity health cards remain under *Classic views*.

## Renewal timeline

The Calendar tab is a timeline, not a list. Each contract is one row with a bar
running to its end date against a month axis, with a vertical line marking
today.

- The **notice period** is the hatched tail of the bar, with a diamond at the
  last day notice can still be given. When a contract auto-renews and that day
  has passed, the marker turns red and the row carries a renew icon — the term
  is already locked for another cycle.
- Every bar is annotated at its end: `45d (90d notice)`, or `45d` with no
  notice period, or `12d overdue`.
- **Bar colour** follows the same urgency thresholds as the Expiry lens: red
  under 30 days, amber under 90, blue within the year.
- **Window presets** — Next 12 months, Next 90 days, Overdue, All. The window
  is defined by when contracts expire, so anything expiring outside it is
  excluded rather than drawn as a full-width bar.
- **Group by department or category** adds section headers with a count and
  expiring value, which is what makes a heavy month visible at a glance.
- Clicking a row expands dates, notice deadline, auto-renew, owner and value.
- Contracts **without an end date** cannot be placed on a timeline; they are
  listed in a footer strip with their combined value.
- **Export ICS** produces the same events as before: one per expiry, plus one
  per notice deadline.

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
- `focusFrame.ts` — connective closure, and the frame behind every jump in.

Run `npm test` for the analytics suite and `npm run build` to type-check.
