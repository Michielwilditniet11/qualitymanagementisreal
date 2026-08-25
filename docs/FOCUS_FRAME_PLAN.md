# Focus Frame Plan — every jump into the Spider Web lands as an explained relationship view

**Status: plan — not yet implemented.**
Target: implementation by Opus/Sonnet, phase by phase, committing per phase.

## The problem, precisely

The Spider Web currently has three ways in, and none of them pays off:

1. **Briefing chips** (the strip under the lens tabs) call `WebHandle.frame(keys)`
   and nothing else — a camera move with no selection, no highlight, no dim,
   no labels, no explanation. Items whose `nodeKeys` is empty (e.g. *"55
   contracts across 8 departments"*) are dead buttons: the click does nothing
   at all. Framing a single node clamps to `MIN_DISTANCE` and often barely
   moves the camera, so even a "working" click reads as nothing happened.
2. **Findings panel** clicks set an insight highlight + lens + camera, but the
   result is a set of brighter dots. The *relationships* — which departments
   those contracts run through, which supplier they share, who owns them —
   are exactly what the 3D web exists to show, and they are not drawn,
   labelled or explained.
3. **EntityLinks from other tabs** select a node and stop. The user arrives
   with no statement of why they are here or what to look at.

The user's verdict: *"jumping to the node doesn't give me enough benefit out
of the spider web. It only works if it shows me links between
contracts/departments etc — right now it feels like a gimmick."*

## The design contract

Every navigation into the web — briefing chip, finding, ticker KPI, gap,
entity link, story step — must land as a **Focus Frame**: one uniform
structure that the renderer knows how to stage. A Focus Frame is:

1. **An induced subgraph, never floating dots.** The finding's seed nodes
   *plus the connective tissue between them*: the shared departments,
   categories, suppliers and owners that link the seeds, and the links along
   those paths. A frame must always contain edges. If the seeds share
   nothing, each seed brings its 1-hop context so the relationships are still
   visible.
2. **Two visual tiers.** Seeds (the finding's subjects) get full colour, a
   ring, and a guaranteed label. Context nodes (the connectors) get full
   colour and a label where they fit. Everything else drops to a hard
   spotlight dim (≈0.08, far deeper than the current 0.3) so the frame is
   unmistakably *the* picture.
3. **Typed link emphasis.** Links inside the frame render at full strength in
   their relationship colours (the same palette as selection: green→owner,
   blue→department, amber→category, pink→supplier, purple→contract), heavier
   than resting weight. Links outside the frame fade with the nodes.
4. **A camera move that always visibly responds.** Frame the member+path set;
   if the camera is already effectively at the target pose, play a pulse on
   the seeds instead so every click has feedback. No click may be a no-op.
5. **A persistent explanation card.** While a frame is active, a card
   (bottom-left, above the minimap) states: the finding sentence, its figure,
   the members (each clickable to select), a one-line "how to read this"
   (what the ring means, what the line colours mean *in this frame*), the
   suggested next step, and cross-links (Open in Calendar / Diagnostics where
   applicable). This is the "why am I looking at this" that is missing today.
6. **One escape, everywhere.** Esc, a state-strip chip (`FRAME <title>` with
   ×), and a close on the card all release the frame and return the camera to
   the previous pose.

## Phase 0 — Reproduce and root-cause the dead clicks

Before building, verify empirically in the browser (the `window.__web` debug
hook exists) what each current entry point actually does:

- Click every chip of every lens briefing; log whether `fly` receives the
  intent, whether `poseFor` resolves positions for the keys, and how far the
  camera actually moves.
- Click three findings of different categories; confirm the highlight keys
  resolve against real node keys.
- Record the findings in the commit message of the fix. Known suspects:
  empty `nodeKeys` items; single-node frames whose pose change is beneath
  perception; key strings that don't resolve (`contract::<name>` built from
  strings that differ from node names after trimming/case).

Fix only what blocks Phase 1 verification; the real behaviour change comes
from the phases below.

## Phase 1 — The engine: `src/analytics/focusFrame.ts`

Pure, injected-clock, no rendering.

```ts
export interface FocusFrame {
  id: string                    // stable, for toggle semantics
  title: string                 // "IT is the largest department"
  figure: string                // "€2.3M"
  caption: string               // one sentence: why these nodes, what to see
  seedKeys: string[]            // tier 1
  contextKeys: string[]         // tier 2 — connectors
  linkKeys: string[]            // "a::…>b::…" pairs inside the frame
  legend: { color: string; meaning: string }[]  // frame-specific line legend
  nextStep?: string
  crossLinks: { label: string; target: 'calendar' | 'diagnostics'; id?: string }[]
}

export function buildFocusFrame(
  source:
    | { kind: 'briefing'; lens: LensId; item: BriefingItem }
    | { kind: 'insight'; insight: Insight }
    | { kind: 'gap'; gap: Gap }
    | { kind: 'kpi'; metric: 'spend' | 'atRisk' | 'expiring' | 'windows' | 'gaps' }
    | { kind: 'entity'; nodeKey: string },
  nodes: GraphNode[], links: GraphLink[], contracts: Contract[],
  now = new Date()
): FocusFrame
```

Core algorithm — **connective closure**:

- Resolve seeds defensively (by key, falling back to type+name lookup with
  trimmed comparison). Log nothing; unresolvable seeds are dropped, and a
  frame with zero resolvable seeds falls back to a defined portfolio-level
  frame rather than a dead click.
- Add every node adjacent to ≥2 seeds (the shared hubs — this is what turns
  dots into a story).
- If a seed ends up with no in-frame link, add its full 1-hop neighbourhood.
- Collect every link with both ends in the member set.
- Cap context at ~40 nodes by importance (spend, then degree) so a
  portfolio-wide finding cannot un-dim the whole graph; when capped, say so
  in the caption ("showing the 40 largest of 120").

Per-source captions come from the engines that produced the finding — this
module composes, it does not re-analyse. Zero-key briefing items get real
frames: *"55 contracts across 8 departments"* seeds the department hubs;
*"n expiring within 90 days"* seeds the expiring contracts and closes over
their departments and suppliers.

Tests (new `focusframe.test.ts`):
- every frame contains at least one link when the graph has any;
- connective closure finds the shared hub of two contracts in one department;
- the cap keeps the top-spend members and flags truncation in the caption;
- unresolvable seeds never produce an empty frame silently;
- each briefing item of each lens on the demo dataset yields a non-empty frame
  (this is the regression test for the dead chips).

## Phase 2 — The renderer: staging a frame in `PlanetaryWeb`

New prop `focusFrame: FocusFrame | null`. On change:

- **Dim discipline.** Members full colour; everything else to spotlight-grade
  dim (share the constant with story mode). Frame links render in
  relationship colours at ~2× resting width; non-frame links fade to near
  invisibility.
- **Tiers.** Seeds get the selection-style ring and are pinned into the label
  plan at maximum importance (above hover); context nodes enter the plan at
  high importance. The label policy already supports importance ranking — no
  new mechanism, just priority injection.
- **Camera.** `frameNodes` over all member keys. Compute the pose delta; if
  below a perception threshold (distance and angle), skip the fly and run a
  0.6s emphasis pulse on the seeds (scale + ring flash). Every activation has
  visible feedback — this is the invariant that kills "I clicked and nothing
  happened".
- **Precedence.** focus mode (double-click isolation) > focusFrame > selection
  neighbourhood. Activating a frame clears an insight highlight and vice
  versa — one staging mechanism at a time. Internally, migrate the existing
  `highlightKeys` insight path to be a consumer of focusFrame so there is one
  code path, not two.

## Phase 3 — Wire every entry point

- **Briefing chips** → `buildFocusFrame({kind:'briefing',…})`. Click again to
  release (toggle by frame id).
- **Findings panel** → `{kind:'insight'}` — replaces the current
  `activeInsight` highlight plumbing in `WebScreen`.
- **Ticker KPIs** → `{kind:'kpi'}` — e.g. AT RISK frames the flagged
  contracts and their connectors, not just a lens switch.
- **Gaps drawer** → `{kind:'gap'}` (phantoms stay; the frame adds the dim +
  card).
- **EntityLinks from Diagnostics/Kraljic/Calendar** → extend
  `uiStore.pendingSelection` with an optional frame source so arriving from
  another tab lands framed *and* selected, with the card explaining the
  origin ("From Diagnostics: notice window closes in 12 days").
- **Story mode** steps render their narration through the same card component.
- State strip gets the `FRAME` chip; Esc releases frame before it releases
  selection; `?` sheet and FEATURES.md updated.

## Phase 4 — The explanation card

One component (`FrameCard`) used by frames and story steps:

- title + figure (mono, amber) + caption;
- member chips in relationship colours — click selects that node without
  dropping the frame;
- frame-specific legend line ("● ring = flagged contract · blue line = runs
  through this department");
- next step + cross-links;
- close control mirroring the chip.

Placement: bottom-left, `max-width 380px`, above the minimap, never covering
the drawer. Reduced-motion honoured (no pulse, instant camera).

## Phase 5 — Prove it

- Playwright pass: for every lens, click every briefing chip and assert (via
  `window.__web`) that either the camera pose changed beyond the threshold or
  a pulse ran, that ≥1 link is emphasised, and that the card is present with
  a non-empty caption. Same for three findings and two ticker KPIs.
- Full unit suite + build clean at the existing bar (262 tests + new ones).
- Rebuild the standalone bundle and republish the artifact.

## Sequencing and size

Phases land in order; 1 and 4 are parallelisable after 0. Estimated diff:
one new engine module + tests (~350 lines), renderer staging (~150 lines
delta), WebScreen rewiring (~120 lines delta, net negative on the insight
path), card component (~120 lines). No new dependencies.

## Out of scope

Persistence of frames, multi-frame comparison, and 2D fallback rendering —
noted for BEST_PRACTICE_PLAN territory, not this change.
