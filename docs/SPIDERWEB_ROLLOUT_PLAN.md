# Spider Web Rollout — Design & Execution Plan

**Ambition:** the Spider Web should feel like a polished, navigable dashboard,
not a 3D demo with panels attached. Fully legible from any angle and any
distance; smooth to operate with one coherent camera; navigable like a product
(history, bookmarks, keyboard, minimap); and useful as an *explanation device* —
finding gaps, spotlighting risks, and walking a stakeholder through the
portfolio's challenges step by step.

This is a broad renovation, planned wide on purpose. Seven phases: two fix the
foundations (legibility, camera), two build the navigation shell, and three add
the analysis-and-storytelling layer on top. Later phases depend on earlier
ones; do not reorder.

---

## As-is: a blunt inventory of what is wrong

`app/src/graph/PlanetaryWeb.tsx` is 736 lines and carries these known defects:

**Legibility**
- Every in-context label renders at fixed screen size regardless of density —
  at portfolio scale (100+ nodes in context) labels collide and stack into an
  unreadable pile. There is no screen-space collision culling and no
  level-of-detail policy.
- Out of context, entity labels scale with node radius (small nodes →
  unreadable sprites), and contract nodes have no labels at all — from most
  angles the default view is anonymous dots.
- No hover feedback whatsoever: the only emphasis is click-selection. You
  cannot "feel" the graph under the cursor.
- Occlusion is unmanaged: near nodes hide far ones, links pass through
  labels, and nothing separates foreground from background except fog.
- The dim tier (`#1F2937` spheres at 0.15 opacity) is nearly invisible — when
  a context is active the rest of the graph might as well not exist, which
  kills orientation ("where am I in the whole?").
- Link colours in the neutral (no-selection) state are a single grey — the
  type information the selection view teaches is absent the rest of the time.

**Smoothness**
- Five independent code paths drive the camera (init polling loop at line
  ~443, insight framing, focus framing, selection framing, search): they
  compete, interrupt each other mid-flight, and use different easings and
  distances. There is no notion of a current camera intent.
- Initial placement works by polling `setInterval(100ms)` for non-zero
  positions — functional, but it visibly jumps.
- Every visual refresh (`nodeThreeObject(nodeThreeObject())`) rebuilds every
  node's canvas textures and geometries from scratch — hover-emphasis at 60fps
  is impossible on this foundation, and lens switches visibly hitch.
- The force simulation re-heats on data changes; there is no way to pin the
  layout once it has settled, so the map the user has learned keeps moving.

**Navigation**
- No view history: clicking through supplier → owner → contract is one-way;
  there is no back, no breadcrumb, no way to retrace an exploration.
- No saved views, no reset-view control, no zoom-to-fit button, no keyboard
  operation at all (only Esc exits focus).
- Active state is scattered: lens in one control, filters in another, focus in
  a banner, insight highlight in the drawer — nothing shows the *combined*
  state in one place, and none of it is clearable in one action.
- No minimap or overview: once zoomed into a neighbourhood there is no sense
  of position in the whole.

**Explanation power**
- Insights highlight nodes but nothing narrates *on the canvas* — all reading
  happens in the side panel, so presenting to a third person means pointing at
  the screen with a finger.
- No way to spotlight, annotate, or capture a view for a deck.
- Gaps (missing owners, absent competition, unlinked spend) are only visible
  as list items in other tabs, never as *structure* — yet "what is missing"
  is exactly what a network view should show.

Existing assets to build on, not duplicate: analytics modules (`risk`,
`insights`, `selection`, `centrality`, `lenses`, `terms`, `levers`,
`savings`), `uiStore.pendingSelection` cross-navigation, tiered
selection-context rendering, the lens system, focus mode, the drawer.

Constraints (unchanged regime):
- Pure logic in `app/src/analytics/` or new `app/src/graph/lib/` modules with
  vitest coverage; components render memoized results. Injected clocks.
- 3d-force-graph stays the engine; no React Three Fiber; no new runtime
  dependencies without a stated reason in the commit message.
- `npm test` + `npm run build` green per phase; Playwright verification
  (port 5200, chromium at /opt/pw-browsers) with screenshots per phase; no
  horizontal page overflow at 1600px and 1100px.
- One commit per phase (`Web N: <capability>`) on
  `claude/procurement-analytics-spider-web-6jsda3`, pushed after each phase.

---

## Target experience (the bar every phase serves)

A CPO opens the tab and sees a calm, labelled map where the important names
are readable and the unimportant recede. The cursor makes the graph feel
alive: hover lifts a node and its connections. Click frames a neighbourhood
smoothly; back returns exactly where they were. The active lens, filters and
focus read in one strip and clear with one click. Keyboard drives everything
demos need: fit, next risk, back. "Present" turns the same data into a
narrated fly-through — overview, biggest dependency, expiry cliff, the gaps —
that they can step through in a board meeting without touching a mouse more
than once. Nothing moves unless asked; nothing readable is ever smaller than
the UI's own captions.

---

## Phase W1 — Legibility engine

The graph must read at three distances (overview / neighbourhood / node) from
any angle, with density-aware labels.

**Label LOD (`app/src/graph/lib/labelPolicy.ts`, pure):**
`labelPlan(nodes, screenPositions, mode) → Map<key, LabelLevel>` where
`LabelLevel = 'full' | 'name' | 'none'`.
- Importance score per node = spend share + type weight (departments >
  categories > suppliers/owners > contracts) + context tier when one is
  active + hover/selection override (always `full`).
- Greedy screen-space collision culling: sort by importance, project each
  candidate label's rectangle, drop any that intersects an already-placed one.
  Every node the policy labels is guaranteed non-overlapping; contract nodes
  earn labels at close range when space allows.
- The component feeds it projected positions each animation frame *throttled
  to ~5Hz* (labels don't need to re-plan at 60fps) and applies visibility by
  toggling sprite `.visible` — never by rebuilding objects.

**Persistent-object rendering (prerequisite for everything after):** refactor
`makeNodeObject` into build-once/update-many. Each node's THREE group is
created once (sphere, rings, label sprites) and cached by key + lens epoch;
updates mutate material colour/opacity/visibility. Canvas label textures are
cached by their text+style key in an LRU. Target: a lens switch or hover
update touches materials only — verified by counting texture allocations in a
test hook.

**Depth & occlusion treatment:** replace binary fog with depth-graded
desaturation (far nodes drop saturation and label contrast, not existence);
dim-tier nodes get a slightly stronger presence (0.3 opacity floor) so the
whole always remains an orientation backdrop; labels get `depthTest: false`
only for the hovered/selected node so the subject is never occluded.

**Hover:** raycast hover (3d-force-graph `onNodeHover`) lifts the node — scale
pulse ~1.15, full label, its links brighten to their type hues, cursor
pointer. Neutral-state links take a *faint* version of their type hue instead
of uniform grey, so the colour language is always present.

Tests: labelPolicy collision guarantees (no two visible rects intersect),
importance ordering, hover override, cache eviction. Playwright: overview
screenshot shows ≥10 readable non-overlapping labels; zoomed screenshot shows
contract labels appearing; hover screenshot shows emphasis.

## Phase W2 — One camera, one intent

**`app/src/graph/lib/cameraDirector.ts`** — the only code allowed to move the
camera. API: `flyTo(intent)`, `intents: overview | frameNodes(keys) |
approach(node) | orbit(node)`, plus `back()` support for W3. Internals:
- Computes framing (centroid + radius → distance, fog-aware clamp) in one
  place — delete the four scattered implementations and the init polling loop
  (subscribe to the engine tick instead: first tick with non-zero bounds →
  `flyTo(overview)` with no visible jump: start the camera far and ease in).
- A single in-flight tween; a new intent preempts cleanly from the current
  position (no teleports); durations scale with distance travelled
  (200–900ms); easing standardised.
- Every executed intent is recorded (for W3 history).

**Layout stability:** after first settle, freeze node positions (`fx/fy/fz`)
so the learned map never drifts; data changes reheat only *new* nodes. Add a
"re-layout" control for when the user actually wants a reshuffle.

**Controls polish:** orbit damping/inertia tuned; double-click background =
zoom-to-fit; a small on-canvas control cluster (fit, reset, re-layout);
scroll-zoom speed normalised.

Tests: director framing math, preemption (second intent starts from
interpolated position), history recording, freeze/reheat logic. Playwright:
select node A then immediately node B — camera lands on B without snap;
initial load shows no jump (two screenshots 300ms apart during intro are both
in-frame).

## Phase W3 — Navigation shell

**History & breadcrumbs:** every selection/focus/lens-change pushes a
navigation entry (uiStore). Back/forward buttons + Alt-arrows; a breadcrumb
trail of the last ~5 visited nodes above the canvas, clickable.

**Unified state strip:** one bar showing every active dimension as removable
chips — lens, node-type filters, min-spend, expiring window, search, focus,
insight highlight — plus "Clear all". This replaces scattered state cues; the
existing controls stay but the strip is the single source of truth for *what
am I looking at*.

**Saved views:** name and save the full view state (camera pose + lens +
filters + selection) to localStorage; a views menu restores them; ship three
built-ins (Overview, Risk posture, Renewal pressure).

**Keyboard:** `/` search, `F` fit, `Esc` clear-context (already partial),
`←/→` back/forward, `Tab/Shift-Tab` cycle through the current context's nodes
(selection follows), `1–6` lenses, `?` shortcut overlay.

**Minimap:** ~180px canvas in a corner rendering the settled layout's 2D
projection (dots coloured by current lens, current camera frustum footprint as
a rectangle, viewed-node marker). Click on minimap = `frameNodes` there.
Pure projection math in `lib/minimap.ts`, tested.

Playwright: click three nodes, back twice returns to the first (assert via
drawer title); chips reflect and clear state; keyboard cycle moves selection;
minimap screenshot.

## Phase W4 — Gap finder

Gaps are the absent structure a network view is uniquely placed to show.

**`app/src/analytics/gaps.ts`:** `findGaps(contracts, nodes) → Gap[]` with
kinds:
- `no-owner` — contracts with nobody accountable (ghost edge to a phantom
  "Unassigned" node).
- `no-competition` — categories with a single supplier (the missing
  second-supplier slot).
- `single-point` — an entity whose removal disconnects spend (articulation
  points on the entity graph — supplier serving a department no one else
  serves).
- `missing-data` — end-date/value holes big enough to distort the picture.
- `expiring-unplanned` — spend expiring ≤90d with no successor contract in
  the register (same category+department with a later term).

**Gap lens** (7th lens): affected nodes in warning treatment; *phantom nodes
and dashed ghost links* render what is missing — an "Unassigned owner" hub,
a hollow "2nd supplier?" slot beside sole-source categories. Phantoms are
visual objects only (never in the force sim's data — inject as overlay
objects positioned relative to their anchor each frame).

**Gap panel:** drawer section listing gaps ranked by exposed spend; click →
frames the gap with its phantom visible. KPI strip gains a "Structural gaps"
count wired to this lens.

Tests: each detector positive/negative, articulation-point correctness on a
crafted fixture, phantom anchoring math. Playwright: gap lens screenshot with
a visible dashed ghost link.

## Phase W5 — Emphasis & annotation

Turning the web from analysis surface into presentation surface.

- **Spotlight mode:** press `S` or drawer button on any selection — radial
  vignette dims to near-black outside the context, subject links pulse once,
  auto-orbit slowly (stop on input). Designed for "look at this" moments.
- **Callouts:** pin short text notes to nodes (in-memory + localStorage);
  rendered as connector-line labels that participate in the W1 collision
  policy at highest importance; a callouts list in the drawer; delete/edit.
- **Risk beacons:** optional toggle — high-risk / missed-window nodes carry a
  slow 2s pulse. Off by default; `prefers-reduced-motion` disables all pulse
  and auto-orbit globally (this is the phase that must wire the media query
  through).
- **View capture:** "Copy view" renders the canvas + a compact legend/state
  caption to a PNG on an offscreen canvas and puts it on the clipboard
  (`navigator.clipboard.write`) for pasting into decks; graceful message when
  the environment blocks downloads/clipboard.

Playwright: spotlight screenshot (vignette visible), callout added and
re-rendered after reload (localStorage), reduced-motion flag disables pulse
(assert via exposed debug state, not pixels).

## Phase W6 — Story mode

The explanation layer: a narrated fly-through of the portfolio's challenges.

**`app/src/analytics/story.ts`:** `buildStory(contracts, nodes) → StoryStep[]`
— auto-composed from existing engines, each step
`{ id, title, narration, lens, nodeKeys, cameraIntent, source }`:
1. *The portfolio* — overview, total spend, shape (structure lens).
2. *Where the money is* — top spend concentrations (spend lens).
3. *Who we depend on* — most systemic supplier + blast radius (concentration
   lens, focus framing).
4. *What is at risk* — value at risk + worst contracts (risk lens).
5. *What expires next* — the nearest cliff (expiry lens).
6. *What is missing* — top structural gaps (gap lens, phantoms visible).
7. *What we would do* — top 3 actions from the negotiation calendar.
Steps with nothing to say (no gaps, no risk) drop out automatically.
Narration strings are template-built from the same numbers the panels show —
no new arithmetic in the story layer (test: narration numbers equal engine
outputs).

**Presentation UI:** "Present" button → chrome collapses to a bottom strip
(step dots, prev/next, autoplay ~8s, Esc exits); each step drives lens +
highlight + camera through the director, with a narration card
(title + 2–3 sentences + the key figure) overlaid bottom-left; arrow keys
navigate. A step list in the drawer allows toggling steps off before
presenting (customisation without an editor).

Playwright: walk all steps, screenshot steps 1, 3 and 6; numbers in narration
match drawer values; Esc restores full UI and prior view.

## Phase W7 — Performance, resilience & final polish

- **Budget:** 60fps orbit / ≥30fps during transitions on the sample dataset;
  measure via `renderer.info` + frame timing in a debug hook; fix what misses.
  Auto-degrade ladder (drop glow → drop depth-grading → cap labels at 40)
  driven by measured frame time, with a console-visible state for tests.
- **Scale test:** generate a synthetic 500-contract dataset in a test fixture;
  ensure interaction stays usable and label policy holds (≤ configured label
  count, zero overlaps).
- **Resilience:** WebGL context-loss recovery (re-init scene, restore view
  state); empty/1-contract portfolios render sensibly everywhere (no NaN
  camera).
- **Consistency pass:** one shared tooltip/hover style across canvas and
  panels; drawer typography scale unified; every control keyboard-reachable
  with a visible focus state.
- **Docs:** rewrite the Spider Web section of `docs/FEATURES.md` around the
  new experience (distances, navigation, story mode); update the in-app
  bottom-right hint line.
- Full Playwright sweep at 1600px and 1100px across: default view, each lens,
  selection, focus, gaps, spotlight, story — archived as the release gallery.

---

## Sequencing rationale & risk notes

- W1's persistent-object refactor is the keystone: hover (W1), 60fps tweens
  (W2), phantoms (W4), pulses (W5) and story transitions (W6) are all
  infeasible on rebuild-everything rendering. Do it first and do it well.
- W2 deletes code (five camera paths → one). Expect regressions in focus and
  insight framing; the Playwright preemption test is the guard.
- W3 touches WebScreen state wiring broadly — keep the store changes additive
  (new fields, no renames) so Diagnostics cross-links keep working.
- Phantom nodes (W4) deliberately bypass the force sim; if overlay anchoring
  fights the engine's render loop, fall back to real fixed (`fx/fy/fz`) nodes
  flagged non-interactive — note the deviation in the commit message.
- Story mode (W6) must not fork analytics: if a narration needs a number the
  engines don't expose, extend the engine and its tests, then consume it.

## Working agreements
- Read `PlanetaryWeb.tsx` fully before each phase; it changes under you.
- The camera director is the only mover of the camera from W2 onward — new
  features request intents, never call `cameraPosition` directly.
- No per-frame allocations in hover/tick paths; reuse vectors and materials.
- Every threshold (label counts, LOD distances, pulse rates, budgets) is a
  named exported constant; tests reference the constants.
- Honesty rules from the diagnostics plan apply to narration: every number in
  a story card comes from an engine, with its assumption if it is an estimate.
- If a phase's spec conflicts with engine reality, prefer what works, note the
  deviation in the commit message, and keep the target experience as the bar.
