# Selection Context — Design & Execution Plan

**Problem:** selecting a node dims the rest of the graph, but the surviving
neighbourhood doesn't explain itself. Labels are too small to read at the
camera distance selection leaves you at, every connection line looks the same,
and second-order context is missing entirely — selecting a supplier should
immediately show, in colour and text, the owner behind its contracts and the
sibling contracts in the same department or category.

**Goal:** the moment a node is selected, the graph answers "what is around
this and how is it related" without any further clicks.

---

## As-is (baseline, after the Phase 1–5 analytics work)

- `app/src/graph/PlanetaryWeb.tsx` — `highlightSet` = selected node + direct
  neighbours only (a flat `Set<string>`); everything else renders as a dim grey
  sphere in `makeNodeObject`. `linkColor` paints links touching the selected
  node `#60A5FA` and all others near-invisible — no per-relationship colours.
  Name labels are sprites scaled to node radius (tiny for small nodes), only
  shown for entity nodes / highlighted nodes. Precedence today: focus >
  insight highlight > selection. Lens styling mutates `fgNodes` in place.
- `app/src/graph/buildGraph.ts` — `GraphLink` is `{source, target}` with no
  relationship type, although `buildGraph` knows which pair it connects at
  creation time.
- `app/src/analytics/` — pure functions (risk, lenses, insights, centrality)
  with vitest coverage in `app/src/tests/`.
- `NODE_COLORS`: department `#4da3ff`, category `#ffb347`, supplier `#ff6b81`,
  owner `#7bd88f`, contract `#b48cff`.

Constraints (unchanged from the analytics plan):
- Analytics logic is pure functions in `app/src/analytics/` with tests; no
  computation in render paths (memoize on inputs).
- Follow `PlanetaryWeb.tsx`'s existing patterns: refs for values read inside
  graph callbacks (avoid stale closures), visual refresh by re-setting
  `nodeColor`/`nodeThreeObject`/`linkColor` accessors, never replace
  `graphData` for a styling change (it would reset the force layout).
- `npm test` and `npm run build` must pass at the end of every phase; verify
  visually with Playwright against the dev server (port 5200, chromium at
  /opt/pw-browsers) before committing.
- One commit per phase on `claude/procurement-analytics-spider-web-6jsda3`,
  message format `Selection N: <capability>`; push after each phase.

---

## Design

### A. Selection context model
A selection produces a typed context, not a flat set:

```ts
export type RelationType = 'supplies' | 'owned-by' | 'in-category' | 'in-department' | 'contract-of'
export type ContextTier = 'core' | 'direct' | 'related'

export interface SelectionContext {
  core: string                                   // selected node key
  tiers: Map<string, ContextTier>                // every involved node
  relations: Map<string, RelationType>           // direct-ring node key → how it relates to the selection
}
```

- **direct** = the selected node's neighbours, each tagged with its relation
  *as seen from the selection* (select a supplier → its contracts are
  `contract-of`; select a contract → its supplier is `supplies`, its owner
  `owned-by`, etc.).
- **related** = second ring, filtered for relevance rather than raw 2-hop:
  - selecting a **supplier/owner**: the departments, categories and owners
    reached through its contracts;
  - selecting a **contract**: sibling contracts sharing its department or
    category, capped at the top 8 by annual value (so a big department doesn't
    light up half the graph), plus its own entity ring;
  - selecting a **department/category**: its top-8-by-spend contracts and the
    suppliers/owners behind them.

### B. Typed links
`GraphLink` gains a `relation` field assigned in `buildGraph` (it knows the
pair types at `addLink` time). On selection, a link's colour is the
`NODE_COLORS` hue of the entity-type endpoint it leads to — a line to an owner
is green, to a category amber, to a department blue, to a supplier pink — so
the existing legend already explains the colours. Direct-ring links render
wider (via the `linkWidth` accessor) and full-strength; related-ring links same
hue at lower opacity; unrelated links stay faded as today.

### C. Legible relationship labels
- Direct-ring nodes always get a name label on selection, scaled up and
  **capped independent of node radius** (small nodes currently get unreadably
  small sprites), on a dark backing plate for contrast.
- Label text carries the relationship: `Sanne de Vries · owner`,
  `IT Hardware · category`, using the relation from the context model.
- Related-ring nodes get smaller, dimmer name-only labels; render at most ~12
  (prioritise by spend) to avoid clutter.

### D. Tiered rendering instead of binary dim
`makeNodeObject` renders four states: core (full colour, selection ring,
bold label) → direct (full colour, relationship label) → related (~60%
opacity, small label) → rest (current dim grey). Focus mode and insight
highlighting keep their precedence above selection; inside focus, selection
still shows its typed links and labels for nodes within the focus set.

### E. Drawer echo
The entity drawer's neighbour chips take the same relationship colours
(border/dot in the entity-type hue), and hovering a chip temporarily raises
that node to `core`-style emphasis in the graph via the existing refresh
mechanism — one visual language across panel and graph.

Out of scope: any change to layout/physics, new tabs, persistence.

---

## Execution plan — phases for Sonnet

Work phase by phase; finish, verify, commit, push before the next.

### Selection 1 — context model + typed links (no UI)
> Read `docs/SELECTION_CONTEXT_PLAN.md` sections A and B. Add `relation` to
> `GraphLink` in `app/src/data/types.ts` and assign it in `buildGraph.ts` at
> `addLink` time (derive from the two node types; keep the existing
> de-duplication). Create `app/src/analytics/selection.ts` implementing
> `selectionContext(node: GraphNode): SelectionContext` per section A,
> including the top-8-by-value capping and the per-node-type related-ring
> rules. Add `app/src/tests/selection.test.ts` with fixtures covering: each
> selectable node type; supplier→owner reachability through contracts;
> sibling-contract capping at 8; relation tagging correctness in both
> directions (supplier→contract vs contract→supplier). `npm test` and
> `npm run build` must pass.

### Selection 2 — tiered rendering + typed link colours
> Wire `selectionContext` into `PlanetaryWeb.tsx`. Replace the selection
> branch of the `highlightSet` memo with the context's tier map (keep a
> `Set`-compatible view or refactor consumers to the map — focus mode and
> insight highlighting keep precedence and their current behaviour).
> Implement section D's four render states in `makeNodeObject` and section
> B's link colouring/width in the `linkColor`/`linkWidth` accessors, reading
> the context through a ref like `highlightSetRef`. Unrelated-link and
> dim-node treatment stays as today. Verify with Playwright: select one node
> of each type, screenshot each, confirm typed link colours differ and tiers
> are visually distinct; no console errors.

### Selection 3 — relationship labels
> Implement section C in `makeNodeObject`: fixed-cap label sprites with a dark
> backing plate; direct ring shows `name · relation`, related ring shows a
> smaller name-only label, at most 12 related labels prioritised by node
> value. Make sure labels don't regress the no-selection state, lens
> `labelAlways` behaviour, or focus mode. Playwright-verify legibility at the
> default post-selection camera distance (screenshot and confirm label text is
> readable at 100% zoom).

### Selection 4 — drawer echo + final verification
> Apply relationship colours to the entity drawer's neighbour chips in
> `WebScreen.tsx` (dot or border in the entity-type hue). Add chip-hover →
> temporary graph emphasis using a ref + the existing visual-refresh effect
> (no re-render of graph data). Then a full pass: `npm test`,
> `npm run build`, and a Playwright script that selects a supplier, a
> contract, and a department, screenshots each, and confirms (a) owner link
> is green and labelled, (b) sibling contracts appear for a contract
> selection, (c) focus mode and insight clicks still behave. Update
> `docs/FEATURES.md` with a short "Reading a selection" subsection.

### Working agreements
- Read `PlanetaryWeb.tsx` fully before editing; its init-once/refresh pattern,
  ref usage and camera polling are load-bearing.
- Never replace `graphData` for styling; mutate `fgNodes`/refresh accessors.
- If the spec conflicts with what the code does, prefer the code's pattern and
  note the deviation in the commit message.
