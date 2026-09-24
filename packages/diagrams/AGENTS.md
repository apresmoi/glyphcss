# @glyphcss/diagrams — agent guide

Graphs (Mermaid `flowchart`/`graph` or JSON) rendered as cell text, plus other 2D forms over the same cell canvas (sequence diagrams and lane DAGs today). Root rules in `../../AGENTS.md` still apply.

## Pipeline

Adapters → `GlyphGraph` → `measureGlyphGraph` → `reserveGlyphGraphPorts` → `layoutGlyphGraph` (dagre) → `routeGlyphGraphEdges` → paint on a fresh canvas. `renderGlyphDiagram` composes them; bare call defaults to `target: "web"`.

## Root vs `./3d` vs `./sequence` vs `./lanes`

- Root: camera-free 2D text. Never imports glyphcss's scene/rasterizer or elkjs (`./elk` is a stub).
- `./3d`: same IR and adapters → `glyphDiagramObject`; `renderGlyphDiagram3d` is the static frame; live orbit view is web-only.
- `./sequence` and `./lanes`: own IR/pipeline (`GlyphSequence`/`GlyphLaneDag`, never `GlyphGraph`), isolated from each other, root and `./3d` — `color.ts` (below) is the one shared exception.

## Sequence diagrams (`./sequence`)

A `GlyphSequence` (`participants`, `messages`, optional `frames`/`notes`) has no layout problem: order is authored, time runs downward, every geometric decision is a function of label/message length (no dagre, A*, or ranks). Pipeline: `glyphSequenceFromMermaid`/JSON → `validateGlyphSequence` → `layoutGlyphSequenceColumns` (label-width x's, shrinking-cap degrade) → `layoutGlyphSequenceRows` (message/marker rows) → `paintGlyphSequence`. `renderGlyphSequence` composes them.

**Domain-agnostic IR** — no `service`/`endpoint`/`request`/`http`/`caller` vocabulary. Participant: `id`/`label`/informational `kind?: string`/rendering-only `shape?: "lane" | "actor"`. Message: `from`/`to`/`label`/`style` only — self-ness and direction are DERIVED, never a field. Frame: `{ kind, label?, from, to }`, `kind` rendered VERBATIM (Mermaid's `alt`/`else`/`opt`/`loop` unmapped). Note (`{ text, over, at }`): same floating-bar primitive, anchored to `over` lanes.

### Invariants

- A frame/note is ONE floating condition bar (border+label+border, 3 rows) centered on its touched columns, widened only for its label — never a UML box or a closing mark at `to`. `markerBox` sizes the pre-composed `text` once and clamps into `[0, canvasWidth)`, re-deriving `centerX` from the CLAMPED `x0` (`canvas.text` drops out-of-bounds cells).
- A message crossing an unrelated lifeline paints a 4-way junction glyph, never a silent gap. Self-messages get their own 3-row loop (tee→dash→corner, corner→arrowhead), never a zero-width arrow. Every glyph paints with whole-cell `canvas.text`, never `canvas.line()` (braille/blocks rasterise that at sub-cell dots).
- Degrade: (1) abbreviate participant AND message labels under one shrinking cap (floor 3); (2) page by TIME at a message boundary, repeating the header per panel, when height doesn't fit. Both logged; still-too-wide at the floor logs `sequence-layout-overflow`.

### Don't

- Don't derive a message's `kind` from anything but `from`/`to`, or hardcode Mermaid's `alt`/`else`/`opt`/`loop` (`GlyphSequenceFrame.kind` is opaque). Don't allow `-` in a Mermaid participant id. Don't box a frame's messages, or split a page inside a row-group.

## Lane DAGs (`./lanes`)

A `GlyphLaneDag` (`nodes`: `id`/`label`/`parents`/optional `marks`) is agnostic: git is the familiar instance, not the vocabulary (no `commit`/`sha`/`branch`/`ref`/`author`; `marks` is the caller's opaque tag array). `nodes` is NEWEST FIRST; every `parents` id must occur LATER (`bad-parent-order`, the cycle-free proof). Pipeline: optional `glyphLaneDagFromGitLog` → `validateGlyphLaneDag` → `layoutGlyphLaneRows` → `applyGlyphLaneCap` → `paintGlyphLaneDag`. `renderGlyphLaneDag` composes them.

### Invariants

- Lane allocation is the one new algorithm: assign on first appearance, keep while unresolved, FREE on merge for reuse — stops a long history drifting rightward.
- One node row (`*` + `id  (marks)  label`) per node, plus one connector row per branch/merge event only — never a spacer row with no topology change.
- `applyGlyphLaneCap`'s `cap` is a TOTAL column budget (dense + one shared overflow column) — collapsing fewer than two lanes saves nothing; a collapsed node keeps its row/label, only its lane position, logged as `lane-cap-collapsed`. Degrade order: lane-cap → pagination (never splitting a node row from its connector row) → content truncation (`label-abbreviated`).
- Connector corners reuse the tier's own square junction glyphs (`┌┐└┘├┤`), never new arc glyphs in glyphcss's shared tables. A lane merging into a hub and one branching out on the SAME row union their bits into one cell, never two exclusive paints.

## Colour

`nodeColor`/`edgeColor` (root), `laneColor` (`./lanes`), `participantColor` (`./sequence`): `string | ((item) => string)`, mirroring `./3d`'s own `nodeColor`. Resolved once per item, validated against `bad-color` before the canvas ever sees it. `color.ts`'s `GLYPH_DIAGRAM_PALETTE`/`resolveGlyphDiagramColor(Option)` is the ONE shared implementation. Root keeps its flat default (edgeColor's arrowhead/label stay node-blue when unset); lane/participant default from the palette, cycled by index. `color: "none"` stays byte-identical either way — colour is additive, never the only way to tell two things apart.

## Invariants

- `GLYPH_DIAGRAM_VALIDATION_RULES` backs runtime/schema, every rule with its own repair hint. `report.ledger` is `GlyphDiagramLedgerEntry[]` `{ code, message, detail? }`.
- `unroutable` describes final output only; a layout that doesn't fit is `layout-overflow`, never `routing-attempt`. Malformed JSON is `GLYPH_DIAGRAM_BAD_JSON`; `engine: "elk"` is `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert, never executed.
- Budget 9 nodes / 12 edges. Ladder: compaction → decoration → duplicates → leaf clusters → split; compaction is non-semantic, runs in every detail mode — never `layout-overflow` before it ran, never decoration once it already fits.
- Paint order: routes → junctions → node fills → target-border arrowheads → labels; an edge label touches its own route or is dropped. Text/HTML/ANSI are separate exits, each page carrying its `canvas`.
- 3D renders only `braille`/`blocks` (`ascii`/`box` degrade with `3d-charset-degraded`); edges are mesh geometry, only labels stamped; the static frame is byte-identical to the live scene at the same camera.

## Don't

- Don't reuse a canvas across renders/panels — re-registering a route can't erase its old glyphs. Don't hide an unroutable edge under a later box fill; log `unroutable`, paint no transit.
- Don't assign reserved port slots in lexical order — dagre reorders siblings; use the laid-out transverse order. Don't use a flat compaction floor — it's per graph (`max(3, widest fan + 1)`), stepped down from caller spacing.
- Don't split Mermaid statements on `;` inside quotes, `-. text .->`/`|label|` spans, or decode entities/escapes in two passes.
- Don't place or route 3D with dagre x/y or the 2D A*; only rank and within-rank order carry over. Don't pick 3D label placements at a reference zoom; cell rounding isn't affine-invariant, so run at the final camera.
- Don't space 3D ranks/rings/label gaps by flat world lengths — use screen-silhouette/half-extent bounds. Exception: an explicit-`size` rank gap (CNN slab) spaces by flow+depth half-extents, LR/RL only (`layout3d.ts`'s proof) — don't extend that or drop depth for TB/BT.

## Gate tests

- `src/fixtureRules.test.ts`, `src/render.test.ts`, `src/rules.test.ts`/`schema.test.ts`/`validate.test.ts`, `src/mermaid.test.ts`, `src/ledger.test.ts`, `src/bundle.test.ts`; `src/3d/*.test.ts`; `packages/compile/src/diagramCli.test.ts`; `sequence/{validate,schema,mermaid,render,ledger}.test.ts`; `lanes/{validate,schema,layout,render,ledger,git}.test.ts`.

Run `pnpm --filter @glyphcss/diagrams test`/`build`. API and usage: `README.md`.
