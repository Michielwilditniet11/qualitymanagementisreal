# Calendar Timeline — Design & Execution Plan

**Problem:** the Calendar tab is a month-grouped list. You can read *that*
something expires, but not *when relative to everything else* — there is no
visual sense of density ("three big contracts all land in March"), no sense of
how close a notice deadline sits to today, and scanning 50 rows to understand
the next quarter is work the chart should do.

**Goal:** replace the list with a horizontal timeline (Gantt-style) where every
contract is a row with a bar running to its end date, "today" is a vertical
line, and each row is annotated `123d (90d notice)` — days until expiry, with
the notice period in brackets when one exists. What's urgent should be visible
from shape and colour before reading a single label.

---

## As-is (baseline)

- `app/src/features/calendar/CalendarScreen.tsx` — builds `CalendarEntry[]`
  (one entry per end date, plus one per notice deadline), groups by month,
  renders cards. Has an upcoming/overdue/all filter and an ICS export that
  must be preserved.
- Dark console palette elsewhere in the app: surfaces `#0A0F1A`/`#171e2e`,
  borders `#1E293B`/`#2a3650`, accent `#38BDF8`/`#4da3ff`, risk colours
  red `#DC2626`, amber `#D97706`, green `#059669`/`#10B981`.
- `app/src/analytics/risk.ts` has `daysDiff`, `fmtK`, `fmtDate` — reuse, don't
  duplicate. Recharts is a dependency but a hand-rolled div/SVG timeline gives
  better control here; do not pull in a Gantt library.

Constraints:
- Pure layout math in `app/src/analytics/timeline.ts` with vitest coverage; the
  component only renders.
- `npm test` + `npm run build` green per phase; Playwright visual check before
  each commit; one commit per phase (`Timeline N: <capability>`) on
  `claude/procurement-analytics-spider-web-6jsda3`, pushed.

---

## Design

### Layout
A scrollable chart area with a fixed left rail:

```
                 │ Jan ’26   Feb    Mar    Apr    May   …
─────────────────┼──────────────────────────────────────────
Laptop lease     │      ▒▒▒▒▒░░░█ 45d (90d notice)
TechLease · IT   │      today↑
Cleaning HQ      │  ████████████████████████▌ 210d (60d notice)
Office cateri…   │ ◀ overdue 12d
```

- **X axis**: time. Default window = today − 1 month → today + 12 months, with
  month gridlines and quarter labels. Header sticky on vertical scroll.
- **Today line**: a full-height vertical rule in the accent colour with a
  small "today" tag at the top.
- **One row per contract** (not per event — the notice deadline lives *inside*
  the row, unlike the current double-entry list):
  - the **bar** runs from `max(windowStart, startDate ?? windowStart)` to
    `endDate`, in the urgency colour (see below);
  - the **notice window** — the final `noticePeriodDays` of the bar — renders
    as a hatched/lighter segment of the same hue, and its left edge (the last
    day you can still give notice) gets a small diamond marker; if that edge
    is in the past on an auto-renew contract, mark the row with the silent-
    renewal warning treatment;
  - the **annotation** sits immediately after the bar end:
    `45d (90d notice)` — days to expiry, notice period in brackets, omitted
    when there is no notice period. Overdue rows read `12d overdue`.
- **Left rail** (fixed width ~220px): contract name (truncated), under it
  `supplier · fmtK(value)` in small muted text.
- **Urgency colour** (bar + annotation, same thresholds as the web view):
  overdue/`<30d` red, `<90d` amber, `<365d` blue, beyond grey-blue.
- **Sorting**: by end date ascending (soonest at top). Contracts with **no end
  date** don't fit a timeline — collapse them into a footer strip
  "N contracts without an end date · €X" that links to the Data lens idea
  (list expands on click).
- **Density**: rows are compact (~28px). With hundreds of contracts vertical
  scroll is fine; virtualisation is out of scope.

### Interaction
- Hover a row → tooltip with full name, supplier, department, owner, value,
  exact end date, notice deadline date.
- Click a row → row expands to a detail strip (dates, auto-renew, owner) —
  same information as today's card, so nothing is lost from the list view.
- Existing **filter** becomes window presets: `Next 12 months` (default) /
  `Next 90 days` / `Overdue` / `All` — Overdue and All adjust the time window
  (All spans min start → max end).
- **ICS export stays** exactly as is, exporting the filtered set.
- A **group-by toggle** (None / Department / Category): grouped mode inserts
  section headers with a per-group subtotal bar (sum of value expiring in the
  window) — this is what makes "March is heavy for IT" visible. Keep it simple:
  headers + indented rows, no swimlane nesting.

### What NOT to do
- No drag-to-reschedule, no zoom/pan gestures (preset windows only), no
  canvas/WebGL, no new dependencies, no month-grid "calendar" view.

---

## Execution plan — phases for Sonnet

### Timeline 1 — layout math (no UI)
> Read `docs/CALENDAR_TIMELINE_PLAN.md`. Create `app/src/analytics/timeline.ts`
> with pure functions: `timelineWindow(contracts, preset)` returning
> `{start, end}` per the preset rules; `timelineRows(contracts, window)`
> returning per-contract rows `{contract, barStartPct, barEndPct, noticeStartPct?,
> daysUntil, noticeDays?, overdue, silentRenewalRisk, offScale}` with
> percentages relative to the window (clamped 0–100, `offScale` when the end
> date falls outside); `monthTicks(window)` returning gridline positions and
> labels; and `annotate(row)` producing the exact label string: `"45d (90d
> notice)"`, `"45d"` when no notice period, `"12d overdue"` when overdue.
> Reuse `daysDiff`/`fmtK` from `analytics/risk.ts`. Add
> `app/src/tests/timeline.test.ts` covering: percentage clamping, notice
> segment position, annotation strings for all three shapes, no-end-date
> exclusion, preset windows, and silent-renewal flagging (auto-renew + notice
> edge in the past + not yet expired). `npm test` and `npm run build` green.

### Timeline 2 — the chart
> Rebuild `CalendarScreen.tsx` around the timeline per the Design section:
> sticky month header with gridlines, today line with tag, fixed left rail,
> one bar row per contract with notice segment, diamond notice marker and
> trailing annotation, urgency colours, end-date sort, and the
> no-end-date footer strip. Keep the header controls: window preset select
> (replacing the old filter, same state variable is fine) and the untouched
> ICS export. Rows are plain divs with percentage-positioned children inside a
> relatively-positioned track — no chart library. Playwright: load sample
> data, screenshot the tab, verify the today line, at least one hatched notice
> segment, and one `Nd (Md notice)` annotation are visible; no console errors
> and no horizontal page overflow.

### Timeline 3 — interaction + grouping
> Add hover tooltips, click-to-expand detail strips, and the group-by toggle
> (None/Department/Category) with section headers and per-group
> expiring-value subtotals per the Design section. Grouped rows keep their
> global urgency colours. Verify with Playwright: expand a row, switch
> grouping, switch to Overdue preset, screenshot each; `npm test` +
> `npm run build`; update `docs/FEATURES.md` with a "Renewal timeline"
> section.

### Working agreements
- Reuse `analytics/risk.ts` helpers; no duplicated date math in the component.
- Percentage-based positioning derived only from `timeline.ts` outputs — the
  component must not re-derive dates.
- Preserve ICS export behaviour byte-for-byte (same entries for the same
  filter semantics).
- If the spec conflicts with what the code does, prefer the code's pattern and
  note the deviation in the commit message.
