# @glyphcss/diagrams — agent guide

Cell-text graphs, sequences and lane DAGs. Root rules apply.

## Pipeline

Adapters → `GlyphGraph` → measure/wrap → reserve ports → layout (dagre ranks/order/alignment → gap channels) → center → route → paint on a fresh canvas. `renderGlyphDiagram` owns cell-budget fitting and reuses its accepted layout/routes; a bare call defaults to `target: "web"`.

## 2D entry points

- Root never imports glyphcss's scene or elkjs (`./elk` is a stub).
- `./sequence` and `./lanes`: own IR/pipeline (never `GlyphGraph`), isolated from each other and root except `color.ts`.

## Sequence diagrams (`./sequence`)

Order is authored, time runs downward, geometry follows label lengths. Pipeline: validate → columns → rows → paint. Direction derives from `from`/`to`; frame/branch `kind` renders verbatim.

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

`nodeColor`/`edgeColor`, `laneColor`, `participantColor` take `string | ((item) => string)`, resolved once per item and checked (`bad-color`) through `color.ts`, the shared implementation. Root keeps a flat default; lanes/participants cycle the palette. `color: "none"` stays byte-identical; colour is never the only cue.

## Invariants

- `GLYPH_DIAGRAM_VALIDATION_RULES` backs runtime/schema, with repair hints. `report.ledger` entries are `{ code, message, detail? }`.
- `unroutable` describes final output only; a layout that doesn't fit is `layout-overflow`, never `routing-attempt`. Malformed JSON is `GLYPH_DIAGRAM_BAD_JSON`; `engine: "elk"` is `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert, never executed. Every node/edge/loop/group/title label folds through `measureGlyphGraph`'s one `fold` and reports `label-folded`; an empty row never places text or emits label ledger entries. A loop reserves its full label rectangle, including blank rows and unused row width, against every other label. Wrapped rows use `edge-row:` plus a JSON `[edgeId, rowIndex]` tuple, separate from `edge:` ids, and retain their edge colour. The compaction floor counts routed connections, not loops.
- `stateDiagram` adapts into the graph IR (`mermaidState.ts`). One start and one end `point` per scope (diagram, each composite), written as the node's LABEL (`kind` is informational, never overrides one); `<<choice>>` is a diamond. A `point` is its glyph alone: 2k-1 cells across for k ports; one entry is one arrowhead before the glyph, several meet in a bar and one arrowhead; several exits leave through a bar on the glyph's line (all tier junctions). The snake draws points left to right, padding row starts by two columns. A self edge on a point is `point-loop`. Edges join nodes, not groups: into a composite lands on its inner start, out of it on its inner end (else first/last inner state); a composite cannot loop to itself; its label is its name, then `P : text` lines after " - ". An id reused in a second composite is the same state (`state-shared`). A group names its `parent` only when it lists the same nodes as the enclosing group. A quote opens a name only after `state`; elsewhere it is text. Entering a composite uses its start marker or first child, leaving its end marker or last child, recursively. Notes, `--` regions and fork/join reject by `GLYPH_MERMAID_STATE_*`.
- A self-edge is a fixed four-cell loop, never an A* search: both ports on the side no flow edge uses (`e` in TB/BT, `s` in LR/RL), room reserved EXACTLY by a dagre self-edge dummy AFTER the node (`labelpos: "c"`, or none when `nodesep` already suffices). Its label wraps like a node's (`loopLabelWidth`, traded by the fitter) and sits one blank cell past the loop, the one label that need not touch its route. Frames and the snake treat a loop and its label as part of their node.
- A loop starts at its authored-first node; nodes keep authored order and backwards dagre ranks are re-laid out with back edges reversed.
- Frame insets alone keep graphs with no loops, points or nested groups byte-identical. ASCII marker folds (`●`/`◆`/`◉` → `*`/`*`/`@`) and punctuation wrapping are output exceptions. Nested-frame padding is a preference: fitting falls back to shared-border frames (`frameInset: false`) before letter cuts or splitting. Wrapping can break after `-`, `+`, `/`, `:`; punctuation stays on the first row and is not a word cut. Letter cuts log `word-cut`.
- Bounded search: first routable snake gaps, one branch gap without hanging nodes, loops pruned by stacked footprint. Expansion: <=256 spacing/replay candidates per pass, <=128 gutters and <=384 routes across alignments; exhaustion logs `fit-search-limited` and retains the best fit. Reuse routes; skip disconnected A* targets and stop failed probes early. Whole words precede cuts. Keep a whole-word default exact; otherwise try UL/UR/DL/DR by canvas cost without added bends or a larger canvas, sharing identical layouts/routes and snake work. Plain aligned ranks reserve crossing channels, a turn and an extra escape cell; loops/frames keep Dagre room.
- Fit uses measured labels, ports and routes, never node/edge-count cutoffs or viewport presets. Search distinct wraps and independent gaps; all modes fit before semantic degradation.
- `overflow: "paginate"` (default) keeps exact canvas size; `"expand"` permits a larger one (`layout-expanded`). Ladder after fitting fails: decoration → duplicates → leaf clusters → split; never decoration once it fits, except `simplified`.
- Paint: routes → junctions → fills → target-border heads → labels; an edge label touches its own route or is dropped (a loop's sits one cell past it). Text/HTML/ANSI exits each carry their `canvas`.

## Don't

- Don't reuse a canvas across panels or hide an unroutable edge under a box fill; log `unroutable`.
- Don't assign reserved port slots in lexical order — dagre reorders siblings; use the laid-out transverse order. Don't claim the fan floor (`max(3, widest fan + 1)`) guarantees search: above caller spacing it leaves that axis unchanged.
- Don't move fitting into consumers, use font scaling, or accept a node box without testing centered routes. Deduplicate candidates before layout.
- Don't widen a node for loop room. Don't split Mermaid statements on `;` inside quotes, edge-text spans or after a state transition's `:`.

## Gate tests

`src/**/*.test.ts` plus `packages/compile/src/diagramCli.test.ts`. API: `README.md`.
