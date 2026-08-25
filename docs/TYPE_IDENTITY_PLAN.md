# Type Identity Plan — a selection must show at a glance who is a person, what is a contract

**Status: implemented.** All four phases landed; see `docs/FEATURES.md`
("Reading a selection") and `src/analytics/typeIdentity.ts`.

## The problem, precisely

Select a contract and its surroundings light up — but they all light up *the
same way*. Two causes, both in the renderer:

1. **Lens colours override type colours for everything in a selection.**
   `nodeColor` in `PlanetaryWeb.tsx` returns `n.color` — the *lens* style —
   for every context member. Under the risk lens a contract's owner, its
   department and the contract itself are all red/amber/green; under spend
   they are all brightness-of-money. The one moment the user is asking "what
   *kinds* of things surround this?" is the moment type identity is
   painted over.
2. **Every node is the same sphere.** Even under the structure lens, where
   type colours survive, a person and a contract differ only by hue — a code
   the user has to have memorised from the legend. Nothing on the node itself
   says "this is a person" or "this is a live contract".

The relation subtitles (`Lisa van Dam · owner`) exist but only appear on
labels that win collision space, and a subtitle is reading, not seeing.

## Design decision

**Inside a selection or Focus Frame, entity nodes wear their type colour;
contracts wear their status.** The lens keeps the field; the context answers
"who is around this". Concretely:

| Node in context | Fill | Extra mark |
|---|---|---|
| Owner (person) | type green `#7bd88f` | person glyph badge |
| Department | type blue `#4da3ff` | building glyph badge |
| Category | type amber `#ffb347` | tag glyph badge |
| Supplier | type pink `#ff6b81` | factory glyph badge |
| Contract, live | type violet `#b48cff` | none — the plain sphere *is* "a contract" |
| Contract, expired-but-listed | desaturated violet | hollow/dashed ring |
| Contract, auto-renew locked | type violet | small renew mark on the label |

Outside any selection/frame the graph is unchanged: lenses keep full
authority over the field, because recolouring the whole graph by type would
destroy what lenses are for. This is a *context* rule, not a global one.

The links already lead with type colour ("lines take the colour of what they
lead to") — after this change the line and the node it reaches finally agree.

## Phases

### Phase 1 — Colour authority rule in the renderer

In `nodeColor` (and the matching logic in `paint()` for count/ring opacity):
when a node is in the active tier map (`selection`, `focusFrame`, or focus
mode) and is **not** the core node, return:

- entities → `NODE_COLORS[type]`;
- contracts → `NODE_COLORS.contract`, desaturated (mix toward `#3A465C`) when
  `contract.endDate < now` while still listed (the "expired but active"
  anti-pattern the insights engine already detects — reuse its predicate, do
  not re-derive).

The **core** node keeps its lens colour plus the selection ring, so the
subject still shows *why* you selected it (e.g. red under risk). `related`
tier gets the same type colour at the existing 0.6 alpha. Pure function
`contextColor(node, tier, lens, now)` in `src/analytics/lenses.ts` (or a new
`typeIdentity.ts`), unit-tested; the renderer only calls it.

### Phase 2 — Glyph badges on entity nodes

Extend `buildNodeVisual` (`nodeFactory.ts`) with one more sprite: a small
badge rendered once per type onto a shared cached canvas texture (5 textures
total, not per-node): person, building, tag, factory silhouettes drawn as
simple 2-colour canvas paths — no icon font, no external assets. Badge sits
top-right of the sphere, `sizeAttenuation: false` so it stays readable at any
camera distance, hidden when the node is dimmed. Visible **only when the node
is in a context tier or hovered** — the resting graph stays calm. Expired
contracts additionally switch their ring to a dashed hollow style (a second
cached ring geometry with gaps, not a new material per node).

### Phase 3 — Labels and drawer agree with the graph

- Direct-ring label titles take the node's type colour (today only the
  subtitle does), so a label alone identifies the kind.
- The drawer's neighbour chips already use type colours — verify and align
  the exact hex values through `NODE_COLORS` everywhere (FrameCard, drawer,
  legend) so no surface drifts.
- Legend gains one line under NODE TYPES: "In a selection, nodes show their
  type; badges mark people, departments, categories, suppliers."

### Phase 4 — Prove it

- Unit tests: `contextColor` returns type colour for entities under every
  lens; core keeps lens colour; expired contracts desaturate; glyph texture
  cache allocates ≤ 5 badge textures however many nodes exist.
- Playwright: select a contract under the risk lens; assert via `__web` that
  the owner node's material colour is the owner green, not a risk colour;
  screenshot review at 1600px.
- Update `docs/FEATURES.md` ("Reading a selection"), rebuild the bundle,
  republish the artifact.

## Out of scope

Re-shaping node geometry per type (cubes/cones): tried mentally and rejected —
3d-force-graph's picking and the existing size-by-spend encoding both assume
spheres, and shape-at-a-distance reads worse than a badge. Revisit only if
badges prove insufficient.
