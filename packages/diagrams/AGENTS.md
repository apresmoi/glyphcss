# @glyphcss/diagrams — agent guide

2D diagrams as cell text: graphs (Mermaid `flowchart`/`graph` or JSON), sequences and lane DAGs. No scene-object or camera API. Root rules in `../../AGENTS.md` apply.

## Pipeline

Adapters → `GlyphGraph` → measure → reserve ports → layout (dagre) → center → route → paint on a fresh canvas. `renderGlyphDiagram` owns cell-budget fitting and reuses its accepted layout/routes for paint; bare call defaults to `target: "web"`.

## 2D entry points

- Root: camera-free 2D text. Never imports glyphcss's scene/rasterizer or elkjs (`./elk` is a stub).
- `./sequence` and `./lanes`: own IR/pipeline (`GlyphSequence`/`GlyphLaneDag`, never `GlyphGraph`), isolated from each other and root — `color.ts` (below) is the one shared exception.

## Sequence diagrams (`./sequence`)

No layout problem: order is authored, time runs downward, and geometry is a function of label lengths (no dagre, A*, or ranks). Pipeline: validate → column layout → row layout → paint, composed by `renderGlyphSequence`. The IR (`types.ts`) is domain-agnostic: no `service`/`endpoint`/`request`/`http` vocabulary; self-ness and direction derive from `from`/`to`; every frame/branch `kind` renders VERBATIM.

### Invariants

- A frame boxes its messages: label in the top border, dashed branch dividers, sides `1 + depth` outside its lifelines and around inner boxes. Columns make room for frames and self-labels. A note is a 3-row floating bar clamped on-canvas.
- A message crossing an unrelated lifeline paints a 4-way junction glyph, never a silent gap. Self-messages get their own 3-row loop (tee→dash→corner, corner→arrowhead), never a zero-width arrow. Every glyph paints with whole-cell `canvas.text`, never `canvas.line()` (braille/blocks rasterise that at sub-cell dots).
- Degrade: (1) one shrinking cap (floor 3) abbreviates participants and WRAPS messages (cutting only an over-long word); leftover width un-wraps, cheapest first; a frame label fills its box; cuts are logged; (2) page by TIME at a message boundary, repeating the header per panel, when height doesn't fit (`overflow: "expand"` grows instead); a cut frame reopens under its current branch at full width, and panels centre on the whole sequence's ink. Both logged; still-too-wide at the floor logs `sequence-layout-overflow`.

### Don't

- Don't hardcode Mermaid's `alt`/`else`/`opt`/`loop`, or allow `-` in a Mermaid participant id. Don't split a page inside a row-group.

## Lane DAGs (`./lanes`)

Git is the familiar instance, not the vocabulary (no `commit`/`sha`/`branch`/`ref`/`author`; `marks` are opaque tags). `nodes` is NEWEST FIRST; every parent must occur LATER (`bad-parent-order`, the cycle-free proof). Pipeline: optional git-log adapter → validate → lane rows → lane cap → paint, composed by `renderGlyphLaneDag`.

### Invariants

- Lane allocation is the one new algorithm: assign on first appearance, keep while unresolved, FREE on merge for reuse — stops a long history drifting rightward.
- One node row (`*` + `id  (marks)  label`) per node; merges join on a connector row ABOVE their node (git's `|/`), branches leave on one BELOW — never a spacer row.
- `applyGlyphLaneCap`'s `cap` is a TOTAL column budget (dense + one shared overflow column) — collapsing fewer than two lanes saves nothing; a collapsed node keeps its row/label, only its lane position, logged as `lane-cap-collapsed`. Degrade order: lane-cap → pagination (never splitting a node from its connectors) → content truncation (`label-abbreviated`).
- Connector corners reuse the tier's own square junction glyphs (`┌┐└┘├┤`), never new arc glyphs in glyphcss's shared tables.

## Colour

`nodeColor`/`edgeColor`, `laneColor`, `participantColor` take `string | ((item) => string)`, resolved once per item and checked against `bad-color` through `color.ts`, the ONE shared implementation. Root keeps a flat default; lanes/participants cycle the palette by index. `color: "none"` stays byte-identical — colour is never the only way to tell two things apart.

## Invariants

- `GLYPH_DIAGRAM_VALIDATION_RULES` backs runtime/schema, every rule with its own repair hint. `report.ledger` is `GlyphDiagramLedgerEntry[]` `{ code, message, detail? }`.
- `unroutable` describes final output only; a layout that doesn't fit is `layout-overflow`, never `routing-attempt`. Malformed JSON is `GLYPH_DIAGRAM_BAD_JSON`; `engine: "elk"` is `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert, never executed.
- A loop starts at its authored-first node: canonical nodes keep authored order; a loop dagre ranks backwards is re-laid out with back edges reversed.
- Never cut words while a whole-word fit exists: whole-word wraps, snake (`snake.ts`), in-viewport repair, expand taller at the same width, then cut words.
- Fit uses measured labels, ports and routes, never node/edge-count cutoffs or viewport presets. Search distinct wraps and independent gaps; return edges may need widening. `autoDirection` permits the perpendicular; all modes fit before semantic degradation.
- `overflow: "paginate"` (default) keeps exact requested canvas dimensions. `"expand"` explicitly permits a connected canvas beyond those dimensions, with `layout-expanded` diagnostics. Ladder after fitting fails: decoration → duplicates → leaf clusters → split; never decoration once it fits, except explicit `simplified`.
- Paint order: routes → junctions → node fills → target-border arrowheads → labels; an edge label touches its own route or is dropped. Text/HTML/ANSI are separate exits, each page carrying its `canvas`.

## Don't

- Don't reuse a canvas across renders/panels — re-registering a route can't erase its old glyphs. Don't hide an unroutable edge under a later box fill; log `unroutable`, paint no transit.
- Don't assign reserved port slots in lexical order — dagre reorders siblings; use the laid-out transverse order. Don't use a flat compaction floor — it's per graph (`max(3, widest fan + 1)`), stepped down from caller spacing.
- Don't move fitting into consumers, use font scaling, or accept a node bounding box without testing centered routes. Deduplicate candidates before layout; reject immovable port collisions before searching for outer routing space.
- Don't split Mermaid statements on `;` inside quotes, `-. text .->`/`|label|` spans, or decode entities/escapes in two passes.

## Gate tests

Every `src/**/*.test.ts` plus `packages/compile/src/diagramCli.test.ts`. Run `pnpm --filter @glyphcss/diagrams test`/`build`. API and usage: `README.md`.
