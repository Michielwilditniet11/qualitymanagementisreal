# UX Overhaul — Design & Execution Plan

**Problem statement, per surface:**
- The **Calendar** is the weakest screen in the product: mechanically a Gantt,
  but it buries the actionable future under a wall of identical overdue rows,
  wastes most of its width on dead window space, draws misleading bars for
  contracts with no start date, has no filters, no decision emphasis, no
  cross-links, native browser tooltips, and never received the terminal
  restyle.
- The **Spider Web** is powerful but unexplained: a first-time user does not
  know how to read it, what the lenses are for, or what value each one adds.
  The lenses are labels, not invitations; nothing tells you what *this
  dataset* looks like through each one before you click.
- **Diagnostics** is a giant vertical list. Six sections of genuinely good
  intelligence, consumed by scrolling. There is no overview that composes
  them, no way to jump, no sub-navigation, no sorting or filtering inside the
  big tables.
- **Kraljic** is a static poster: a drag-to-override scatter with generic
  quadrant tactics, unconnected to the levers, gaps, calendar and insights
  the tool already computes. Low value add, old visual identity.
- Underneath all four: the terminal design system exists only as an inline
  `T` object in WebScreen.tsx; Calendar, Kraljic, Reports and the app header
  still wear the old slate/rounded look, and `fmtMoney`/`fmtDate` are
  re-declared in four files.

**Goal:** every tab reads as one product in the terminal idiom, every screen
leads with what matters and can be operated (filtered, sorted, jumped,
cross-linked), and the Spider Web teaches its own value. Six phases, UX1
first — it is the foundation the rest reuse.

This plan is the *experience* layer. It deliberately does not build
persistence, snapshots or decision states — those are BP1–BP8
(`docs/BEST_PRACTICE_PLAN.md`). Where a UX feature would ideally persist
(Kraljic overrides, calendar zoom), build it session-state now with the
store shaped so BP1 can add persistence without renaming anything, and say
"session only" nowhere — silence is fine; false claims are not.

---

## As-is facts an implementer must know

- Terminal tokens live inline in `src/features/web/WebScreen.tsx` as
  `export const T = { ground:'#04070E', panel:'#080D18', hairline:'#16233A',
  mono:…, amber:'#FFB020', cyan:'#2FD3E6', green:'#22C55E', red:'#FF4D4D',
  text:'#E6EDF6', muted:'#5B6B84', faint:'#3A465C' }`. The Spider Web and its
  drawer use it; nothing else does.
- `PlanetaryWeb` exposes `WebHandle { fit, frame(keys), relayout }` via
  `onReady`, plus `gaps`, `hiddenKeys`, `spotlight`, `chromeless` props, a
  6Hz label engine, a camera director, PRESENT story mode
  (`analytics/story.ts`), and the `uiStore.inspectInWeb(pendingSelection)`
  cross-link consumed once by WebScreen.
- Engines available to every screen (all pure, tested):
  `insights`, `selection`, `centrality` (assessImpact), `lenses` (LENSES,
  lensStyle), `terms` (auditTerms, noticeDeadline), `levers`
  (supplierLeverage, negotiationCalendar), `savings`, `gaps` (findGaps,
  gapExposure), `story` (buildStory), `timeline`
  (timelineWindow/Rows/monthTicks/annotate/urgencyColor).
- Calendar code: `src/features/calendar/CalendarScreen.tsx` +
  `src/analytics/timeline.ts`. Known defects (verified by review):
  end-date-ascending sort floods the top with overdue; `overdue` window ends
  today leaving months of dead space; `all` stretches to the oldest start
  date; missing startDate draws the bar from the window edge as if real;
  notice diamond is 8px and visually last; native `title` tooltips; sticky
  group headers use a magic `top: 28px`; grouping is dept/category only; no
  filters, search, cross-links, keyboard, or per-row export; ICS is
  all-or-nothing; "expiring in view" caption is wrong on the Overdue preset.
- Diagnostics: one scroll, sections in order (action strip, calendar table
  capped at 40 rows, savings bars, leverage cards, T&C audit cards, cuts,
  classic views). Tables have no sort/filter beyond the audit's clause chips.
- Kraljic: `KraljicScreen.tsx` — SVG scatter, drag overrides in useState,
  static QUADRANTS tactics text, detail panel of numbers, old palette.
- Verification regime (unchanged): pure logic tested in vitest with injected
  clocks; `npm test` + `npm run build` green per phase; Playwright against
  port 5200 (chromium at /opt/pw-browsers) with screenshots per phase; no
  horizontal page overflow at 1600 and 1100px; one commit per phase
  (`UX N: <capability>`) on `claude/procurement-analytics-spider-web-6jsda3`,
  pushed after each phase.

---

## Design principles (bind every phase)

1. **One idiom.** Near-black ground, hairline borders, sharp corners
   (rounded-sm at most), mono for every number and micro-label, uppercase
   tracking for section labels, cyan = interactive, amber = attention,
   red/green = semantic only. No emoji as UI. No rounded-xl cards left
   anywhere.
2. **Lead with the decision.** Every screen's first row answers "what needs
   me": the calendar leads with decidable deadlines, diagnostics with a
   composed overview, Kraljic with the quadrant that demands action.
3. **Aggregate before detail.** Long lists get a density/summary band on top
   and progressive disclosure below — never 40 rows as the opening statement.
4. **Everything cross-links.** Any supplier, category, department or contract
   name anywhere is a link into the Spider Web (via `inspectInWeb`), and
   web/diagnostics/calendar journeys are round trips, not dead ends.
5. **The tool explains itself.** Lenses, matrices and marks carry one-line
   "what this answers" copy and live counts from this dataset — value shown,
   not asserted.
6. **Honest marks.** Unknown data renders as visibly unknown (dashed,
   hollow, "no start date"), never as a confident shape.

---

## UX1 — Terminal design system extraction

The prerequisite. Create `src/ui/` with:

- `theme.ts` — move the `T` tokens out of WebScreen (re-export from the old
  site so nothing breaks), plus semantic aliases (`urgent`, `warn`, `ok`,
  `info`) and the urgency function currently duplicated in Diagnostics.
- `format.ts` — one `fmtK`, `fmtMoney`, `fmtDate`, `fmtDays` (re-export from
  `analytics/risk` where they already live; delete the four local
  re-declarations across Calendar/Diagnostics/Kraljic/Reports).
- Primitives, each small and styled once: `Panel` (hairline box),
  `SectionLabel` (uppercase tracked micro-label), `Tick` (ticker cell — move
  from WebScreen), `Chip` (removable state chip — move from WebScreen),
  `TerminalSelect` (move), `DataTable` (sticky header, sortable columns,
  urgency-coloured cells, keyboard row focus, an `onRowClick`), `Tooltip`
  (custom hover card replacing every native `title`), `EntityLink` (name +
  type-coloured dot that calls `inspectInWeb`), `EmptyState` (icon, one
  sentence of what to do), `MiniBar` (labelled horizontal bar used by
  savings and density strips).
- Restyle the **app header** (App.tsx) to the idiom: ground colour, mono
  uppercase tab labels with active cyan underline, and a right-side dataset
  badge (source name · contract count · imported date) fed from the store.
- Convert **Reports** and **Upload** surface chrome to the tokens (layout
  unchanged — full Reports rebuild stays BP7).

Tests: format module unit tests; DataTable sort logic as a pure helper with
tests. Playwright: header + one screen screenshot; no visual regression on
the web tab (its own components now imported from `src/ui`).

## UX2 — Calendar rebuilt as the renewal cockpit

Replace the current screen using `analytics/timeline.ts` (extended, not
forked) and the UX1 kit.

**Layout, top to bottom:**
1. **Cockpit strip** (mono): decidable deadlines ≤90d (count · value),
   next act-by (name + days), missed windows (count · value), expiring with
   no successor (from `gaps`). Each scrolls/zooms to its subject.
2. **Density header**: expiring value per month across the window as a
   compact bar band (MiniBar row, urgency-coloured); clicking a month zooms
   the window to it. This chart moves *here* from Diagnostics' "cuts" (leave
   it there too — same component now).
3. **Decision lane**: one horizontal lane of notice-deadline diamonds only —
   the marks that matter most, large (10px+), urgency-coloured, overlap-
   staggered, each with a custom Tooltip (contract, supplier, act-by,
   value) and click-to-select its row. Missed ones render hollow.
4. **The timeline** (rebuilt rows):
   - **Sort**: decidable-first — open notice windows by act-by date, then
     future expiries, then a single **collapsed overdue band** ("18 overdue ·
     €4.5M — expand") instead of 18 red rows; expanding lists them.
   - **Window**: presets become Next 90d / 12m / 24m plus wheel-zoom and
     drag-pan on the axis (clamped to data extent); the window never
     auto-includes years of dead space — `timelineWindow` gets a
     `fitToData` mode with padding, tested.
   - **Honest bars**: no startDate → bar starts as a dashed fade-in edge
     with tooltip "start date unknown"; term bars slim (8px), notice tail
     hatched as now but with the diamond enlarged and layered above.
   - Row hover = custom tooltip; row click = expand (detail grid as now,
     restyled, plus EntityLink supplier/department and a per-row "ICS"
     button exporting just that contract's events).
5. **Command bar** (above it all, terminal styled): search, department
   multi-select, supplier select, group-by none/department/category/
   supplier/owner, min-value slider, preset/zoom controls, Export ICS
   (exports current filtered scope; caption counts corrected — "expired",
   not "expiring", when that is what they are).

Keyboard: ↑/↓ move row focus, Enter expands, arrows with Alt pan the
window, +/- zoom, `g` cycles grouping. Sticky offsets derived from measured
header height, not magic numbers.

Timeline.ts extensions (pure, tested): `fitToData` window mode; zoom/pan
window arithmetic (`zoomWindow(win, factor, focusPct)`, `panWindow(win,
deltaPct)` with clamps); month density aggregation; decidable-first sort
comparator; overdue partitioning.

Playwright: default view leads with decidable rows and a collapsed overdue
band; zoom changes the axis; a month click zooms; supplier grouping renders;
per-row ICS click fires a download event stub; narrow-width pass.

## UX3 — Spider Web: teach the value

The web works; nobody is told how to work it. Add a guidance layer, all in
the terminal idiom, all dismissible, never blocking:

1. **Lens briefings.** Selecting a lens opens a compact briefing strip under
   the command bar (closable, remembered per session): the lens question,
   its colour scale in words, and — the value-add — the **top three things
   this lens found in this dataset**, computed from the engines
   (`risk`: top 3 by score·value; `expiry`: next 3 windows; `concentration`:
   top systemic suppliers; `gaps`: top 3 by exposure; `spend`: top 3 nodes;
   `data`: worst 3 completeness). Each is one line + click-to-frame
   (`WebHandle.frame`). Pure helper `lensBriefing(lens, contracts, nodes) →
   {question, scaleNote, items: {label, figure, nodeKeys}[]}` in
   `src/analytics/briefings.ts`, tested (items must equal engine outputs).
2. **Lens tabs show live counts** — RISK·33, GAPS·25, EXP·17 — tiny mono
   badges from the same briefing module, so the tabs themselves advertise
   where the signal is.
3. **First-run coach marks.** On the web tab's first open per session (until
   BP1 persists the flag): three sequenced callouts anchored to real UI —
   (1) the graph: "hover to feel it, click to explain a node, double-click
   to isolate", (2) the lens bar: "each lens answers one question — the
   badges show where the signal is", (3) PRESENT: "turns this data into a
   narrated walk-through". Esc/any-click advances; never shows again that
   session; `?` reopens it alongside the shortcut sheet.
4. **`?` shortcut overlay** (global, but built here): two-column mono sheet
   of every binding (web, calendar, story).
5. **Empty-selection drawer** gets a two-line "how to read this" intro above
   the findings list (currently it jumps straight to findings).

Playwright: coach marks appear once and not twice per session; lens badge
numbers match drawer counts; briefing item click frames nodes (camera moves
— assert via `__web` debug camera position change).

## UX4 — Diagnostics: from list to cockpit

Keep every engine section; change the architecture of consumption.

1. **Sticky sub-nav rail** (left, terminal): OVERVIEW · ACT · SAVINGS ·
   SUPPLIERS · AUDIT · CUTS · CLASSIC — mono labels with live counts
   (ACT·46, AUDIT·25). Clicking scrolls; scroll-spy highlights. At <1280px
   it collapses to a horizontal chip row.
2. **OVERVIEW** — a real composed dashboard replacing the bare action
   strip: 2×2 grid of compact modules, each a distilled version of its
   section with a "open →" jump: top-5 act queue (DataTable, dense),
   savings summary (total range + top 2 MiniBars), leverage top-4 (mini
   cards: name, position badge, window countdown), audit pulse (critical
   count + worst finding one-liner). Plus the existing 4 KPI tiles restyled
   as Ticks in one row.
3. **ACT** — the calendar table becomes a UX1 `DataTable`: sortable (act-by,
   value, supplier), filter chips (missed / notice / expiry / department),
   full list with virtual "show more" instead of the silent 40-row cap,
   EntityLink suppliers, per-row expand showing the action text and a jump
   to the Calendar tab scrolled to that contract (uiStore gains
   `pendingCalendarFocus`, consumed once — same pattern as
   `pendingSelection`).
4. **SUPPLIERS** — leverage board gets sort (leverage/spend/window) as now
   plus a position filter, and each card's levers render with their
   estimate chips; "open in web" affordance standardised (EntityLink).
5. **AUDIT** — findings become a DataTable (severity dot, clause,
   title, exposure, act-by; sortable, clause+severity filter chips) with
   row-expand for detail/fix — replacing the unbounded card stack.
6. **CUTS** — unchanged charts, retiled into a 2-col grid with
   SectionLabels; classic views stay collapsed.
7. Whole tab on terminal tokens; the old Card/rounded-xl look goes.

Playwright: sub-nav jump + scroll-spy; sort by value reorders; audit filter;
overview module jump; cross-tab jump to Calendar focuses the row.

## UX5 — Kraljic: from poster to workbench

Keep the matrix; make it the entry point to category strategy. (This is the
UX half of BP5 — persistence of strategy notes/review dates stays in BP;
overrides remain session state behind the same store shape.)

1. **Matrix rebuilt** (SVG stays, terminal styled): dots sized by spend,
   **coloured by dominant risk level** of the category's contracts (not
   flat amber); hollow ring = single-source category (ties to gaps); axis
   captions in plain words ("hard to replace →" / "more money →" as
   subtitles under the technical labels); quadrant corner chips showing
   count · total value; hover = custom Tooltip (spend, suppliers, top
   supplier share, health); drag-to-override kept, overridden dots keep a
   dashed halo + "adjusted" note.
2. **Category brief panel** (right side, replaces the number list): for the
   selected category, assembled *entirely from engines*:
   - header: spend, contracts, quadrant (computed vs adjusted);
   - **suppliers** with leverage position badges and next-window countdowns
     (from `supplierLeverage`, filtered to the category) — EntityLinks;
   - **open decisions**: calendar items for the category's contracts, act-by
     coloured;
   - **gaps touching it** (from `findGaps`);
   - **savings opportunities naming it** (from `savingsOpportunities`);
   - **playbook, instantiated**: the quadrant tactic rewritten with real
     names by a pure helper `categoryPlaybook(category, quadrant, engines)`
     → e.g. Leverage: "Aggregate PackRight + PrintPro volume (€350K
     movable); market-test before the Packaging window closes in 39d." One
     template per quadrant, filled only with engine facts, tested.
   - "Inspect in web" (frames the category node) and "See its renewals"
     (Calendar focus) buttons.
3. **Quadrant summary strip** above the matrix: four Ticks (count · value ·
   worst health per quadrant); clicking highlights that quadrant's dots and
   filters the brief list.
4. New module `src/analytics/kraljicBrief.ts` (pure, tested): quadrant
   computation reuse, brief assembly, playbook instantiation — component
   renders only.

Playwright: select a category → brief shows engine numbers (assert one
equals the diagnostics leverage figure); adjusted dot shows its halo;
cross-links fire; terminal restyle screenshot.

## UX6 — Coherence pass & release gallery

1. Sweep for stragglers: every remaining native `title`, rounded-xl,
   non-mono number, old-palette hex in Calendar/Kraljic/Diagnostics/
   Reports/Upload/App; every icon button gets an aria-label and visible
   focus ring (`:focus-visible` outline in cyan).
2. Cross-link audit: every entity name in every tab is an EntityLink; every
   "open in X" affordance uses the same icon and behaviour; round-trip
   journeys verified (web → diagnostics supplier → back; calendar → web →
   calendar).
3. Keyboard audit against the `?` sheet — every listed binding works, every
   working binding is listed.
4. `docs/FEATURES.md` rewritten per tab as "what it answers · how to work
   it"; bottom-hint lines updated.
5. Release gallery: full Playwright sweep, all six tabs at 1600 and 1100px,
   light interaction states (lens briefing open, calendar zoomed, kraljic
   brief, diagnostics overview), archived to the scratch gallery and
   referenced in the final commit message.

---

## Working agreements

- Read the current code before each phase; every file named here has been
  rewritten at least once this project and will be again.
- UX1's kit is the only source of panels, chips, tables, tooltips and
  formats from UX2 onward — a phase that hand-rolls a second table style has
  failed review.
- Engines stay pure and stay the single source of every number; briefing,
  playbook and cockpit strips are *presentations* of engine output, tested
  as equal to it. No new arithmetic in components.
- Session state that BP1 will later persist lives in zustand stores with
  BP1's names (`kraljicOverrides`, `preferences`) so persistence is a
  hydration change, not a rename.
- Cross-tab focus handoffs follow the existing `pendingSelection` pattern:
  store field, consumed once, cleared.
- Honest marks and honest captions everywhere; if a count's noun is wrong
  ("expiring" for expired), fixing the copy is in scope for the phase that
  touches the screen.
- If a phase's spec conflicts with engine or layout reality, prefer what
  works, note the deviation in the commit message.
