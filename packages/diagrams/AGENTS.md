# @glyphcss/diagrams — agent guide

2D diagrams as cell text: graphs (Mermaid `flowchart`/`graph`/`stateDiagram` or JSON), sequences and lane DAGs. No scene or camera API. Root rules in `../../AGENTS.md` apply.

## Pipeline

Adapters → `GlyphGraph` → measure → reserve ports → layout (dagre) → center → route → paint on a fresh canvas. `renderGlyphDiagram` owns cell-budget fitting and reuses its accepted layout/routes; a bare call defaults to `target: "web"`.

## 2D entry points

- Root: camera-free 2D text; never imports glyphcss's scene or elkjs (`./elk` is a stub).
- `./sequence` and `./lanes`: own IR/pipeline (never `GlyphGraph`), isolated from each other and root except `color.ts`.

## Sequence diagrams (`./sequence`)

Order is authored, time runs downward, geometry follows label lengths. Pipeline: validate → columns → rows → paint. The IR is domain-agnostic; self-ness and direction derive from `from`/`to`; every frame/branch `kind` renders VERBATIM.

### Invariants

- A frame boxes its messages: label in its top border, dashed branch dividers, sides `1 + depth` outside the lifelines. A note is a 3-row bar.
- A message crossing a lifeline paints a 4-way junction; a self-message gets a 3-row loop. Glyphs paint with whole-cell `canvas.text`, never `canvas.line()`.
- Degrade: (1) one shrinking cap (floor 3) abbreviates participants and WRAPS messages, logged; (2) page by TIME at a message boundary, repeating the header (`expand` grows instead). Too wide at the floor logs `sequence-layout-overflow`.

### Don't

- Don't hardcode Mermaid's `alt`/`else`/`opt`/`loop`, or split a page inside a row-group.

## Lane DAGs (`./lanes`)

`nodes` is NEWEST FIRST; every parent must occur LATER (`bad-parent-order`). Pipeline: git-log adapter → validate → rows → cap → paint.

### Invariants

- One node row (`*` + `[id  ](marks)  label`; `ids` default on for a git-log string) per node; merges join on a connector row ABOVE, branches leave on one BELOW — never a spacer row.
- `truncated: true` marks `nodes` as a window (an absent parent is older history). Open lanes after the last node get a dashed `continuation` row, logged `lane-history-continues`.
- `order: "oldest-first"` renders the INVERSION (`invert.ts`) through the same layout (`continuesFrom` keeps a node on its ORIGINAL first parent's lane).
- Label cuts log ONE `label-abbreviated` summary per render.
- The lane `cap` is a TOTAL column budget; a collapsed node keeps its row/label, only its lane (`lane-cap-collapsed`). Degrade: cap → pagination (never splitting a node from its connectors) → label truncation.

## Colour

`nodeColor`/`edgeColor`, `laneColor`, `participantColor` take `string | ((item) => string)`, resolved once per item and checked (`bad-color`) through `color.ts`, the ONE shared implementation. Root keeps a flat default; lanes/participants cycle the palette. `color: "none"` stays byte-identical; colour is never the only cue.

## Invariants

- `GLYPH_DIAGRAM_VALIDATION_RULES` backs runtime/schema, each with its own repair hint. `report.ledger` entries are `{ code, message, detail? }`.
- `unroutable` describes final output only; a layout that doesn't fit is `layout-overflow`, never `routing-attempt`. Malformed JSON is `GLYPH_DIAGRAM_BAD_JSON`; `engine: "elk"` is `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert, never executed. Every graph label (node, edge, loop, group, title) folds through `measureGlyphGraph`'s one `fold` and reports `label-folded`; an empty row never places text or emits label ledger entries. A loop reserves its full label rectangle, including blank rows and unused row width, against every other label. Wrapped rows use `edge-row:` plus a JSON `[edgeId, rowIndex]` tuple, separate from `edge:` ids, and retain their edge colour. The compaction floor counts routed connections, not loops.
- `stateDiagram` adapts into the graph IR (`mermaidState.ts`). One start and one end `point` per scope (diagram, each composite), written as the node's LABEL (`kind` is informational, never overrides one); `<<choice>>` is a diamond. A `point` is its glyph alone: 2k-1 cells across for k ports; one entry is one arrowhead before the glyph, several meet in a bar and one arrowhead; several exits leave through a bar on the glyph's line (all tier junctions). The snake draws a point left to right, with two columns before one that opens a row. A self edge on a point is `point-loop`. Edges join nodes, not groups: into a composite lands on its inner start, out of it on its inner end (else first/last inner state); a composite cannot loop to itself; its label is its name, then `P : text` lines after " - ". An id reused in a second composite is the same state (`state-shared`). A group names its `parent` only when it lists the same nodes as the enclosing group. A quote opens a name only after `state`; elsewhere it is text. Entering a composite uses its start marker or first child, leaving its end marker or last child, recursively. Notes, `--` regions and fork/join reject by `GLYPH_MERMAID_STATE_*`.
- A self-edge is a fixed four-cell loop, never an A* search: both ports on the side no flow edge uses (`e` in TB/BT, `s` in LR/RL), room reserved EXACTLY by a dagre self-edge dummy AFTER the node (`labelpos: "c"`, or none when `nodesep` already suffices). Its label wraps like a node's (`loopLabelWidth`, traded by the fitter) and sits one blank cell past the loop, the one label that need not touch its route. Frames and the snake treat a loop and its label as part of their node.
- A loop starts at its authored-first node: nodes keep authored order; a loop dagre ranks backwards is re-laid out with back edges reversed.
- Frames padded outside the frames they hold are a preference: graphs with no loops, points or nested groups are byte-identical to before (`ascii` folds `●`/`◆`/`◉` to `*`/`*`/`@`, not `?`, in any label: the second intended exception), and the fitter falls back to shared-border frames (`frameInset: false`) before it cuts words or splits. A cut word is logged (`word-cut`).
- Snake and fit searches are bounded: first routable gap set, one branch gap when nothing hangs, and loop wraps limited to those whose stacked footprint could fit (the same list for both; a candidate that cannot fit the requested height is not routed). Never cut words while a whole-word fit exists. Exhaust the authored direction first (whole-word wraps, snake (`snake.ts`, LR only), in-viewport repair, expand taller), then the perpendicular under `autoDirection`, then cut words.
- Fit uses measured labels, ports and routes, never node/edge-count cutoffs or viewport presets. Search distinct wraps and independent gaps; all modes fit before semantic degradation.
- `overflow: "paginate"` (default) keeps exact canvas size; `"expand"` permits a larger one (`layout-expanded`). Ladder after fitting fails: decoration → duplicates → leaf clusters → split; never decoration once it fits, except `simplified`.
- Paint order: routes → junctions → node fills → target-border arrowheads → labels; an edge label touches its own route or is dropped (a loop's sits one cell past it). Text/HTML/ANSI are separate exits, each page carrying its `canvas`.

## Don't

- Don't reuse a canvas across panels. Don't hide an unroutable edge under a box fill; log `unroutable`.
- Don't assign reserved port slots in lexical order — dagre reorders siblings; use the laid-out transverse order. Don't use a flat compaction floor: it is per graph (`max(3, widest fan + 1)`).
- Don't move fitting into consumers, use font scaling, or accept a node box without testing centered routes. Deduplicate candidates before layout.
- Don't widen a node for loop room. Don't split Mermaid statements on `;` inside quotes, edge-text spans or after a state transition's `:`.

## Gate tests

Every `src/**/*.test.ts` plus `packages/compile/src/diagramCli.test.ts`. API and usage: `README.md`.
