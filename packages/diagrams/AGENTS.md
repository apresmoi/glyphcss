# @glyphcss/diagrams — agent guide

Cell-text graphs, sequences, lane DAGs. Root rules apply.

## Pipeline

Adapters → `GlyphGraph` → measure/wrap → ports → layout (dagre ranks/order/alignment → gap channels) → center → route → fresh-canvas paint. `renderGlyphDiagram` fits/reuses layout/routes; default `target: "web"`.

## 2D entry points

- Root never imports glyphcss's scene or elkjs (`./elk` is a stub).
- `./sequence` and `./lanes`: own IR/pipeline (never `GlyphGraph`), isolated from each other and root except `color.ts`.

## Sequence diagrams (`./sequence`)

Authored order; time downward; label-sized geometry. Validate → columns → rows → paint. `from`/`to` determine direction; frame/branch `kind` renders verbatim.

### Invariants

- Frames box messages: top-border label, dashed dividers, sides `1 + depth` outside lifelines. Notes are 3-row bars; optional `placement: "left" | "right"` sits beside one lane and reserves room inside frames. `title` repeats above headers; render options override it.
- Crossed lifelines get 4-way junctions; self-messages get 3-row loops. Whole-cell `canvas.text`, never `canvas.line()`.
- Degrade: shrinking cap (floor 3) abbreviates participants/side notes and WRAPS messages, logged; then page by TIME at message boundaries, repeating headers (`expand` grows). Too wide at floor logs `sequence-layout-overflow`.
- Mermaid: activation suffixes/directives ignored; left/right notes, `autonumber`, `title`, cross/open arrows normalized to solid/dashed; `par`/`and`, `critical`/`option`, `break` frames. Branches require matching frames. `rect` inert; `box` declarations only. Unsupported syntax: named `GLYPH_SEQUENCE_MERMAID_SYNTAX`.

### Don't

- Don't hardcode Mermaid frame kinds or split pages inside a row-group.

## Lane DAGs (`./lanes`)

`nodes` is NEWEST FIRST; parents occur LATER (`bad-parent-order`). Git-log → validate → rows → cap → paint.

### Invariants

- One row per node: `*` + `[id  ](marks)  label` (`ids` defaults on for git-log). Merge connectors ABOVE, branch connectors BELOW; no spacer rows.
- `truncated: true` permits absent older parents. Open lanes end in a dashed `continuation` row, logged `lane-history-continues`.
- `order: "oldest-first"` inverts (`invert.ts`) through the same layout; `continuesFrom` keeps the ORIGINAL first-parent lane.
- Label cuts log ONE `label-abbreviated` summary per render.
- Lane `cap` is a TOTAL column budget; collapsing preserves row/label (`lane-cap-collapsed`). Degrade: cap → page (node+connectors together) → truncate labels.

## Colour

`nodeColor`/`edgeColor`/`laneColor`/`participantColor`: `string | ((item) => string)`, resolved once per item, checked by shared `color.ts` (`bad-color`). Root default flat; lanes/participants cycle palette. `color: "none"` byte-identical; colour never the only cue.

## Invariants

- `GLYPH_DIAGRAM_VALIDATION_RULES` backs runtime/schema, with repair hints. `report.ledger` entries are `{ code, message, detail? }`.
- `unroutable` describes final output only; a layout that doesn't fit is `layout-overflow`, never `routing-attempt`. Malformed JSON is `GLYPH_DIAGRAM_BAD_JSON`; `engine: "elk"` is `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid strips shape delimiters: cylinder → `cylinder`, double circle → `circle`, parallelogram/trapezoid/hexagon → `rect`. `<-->` → two directed edges; `--->` solid; `o--o`/`x--x` undirected; `~~~` named rejection (no layout-only IR edge).
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert, never executed. All labels use `measureGlyphGraph`'s one `fold` (`label-folded`); empty rows place no text or label ledger entries. Loops reserve full label rectangles (blank rows/unused width included) against other labels. Wrapped rows use `edge-row:` + JSON `[edgeId, rowIndex]`, separate from `edge:` ids; edge colour persists. Compaction floor counts connections, not loops.
- `stateDiagram` adapts into the graph IR (`mermaidState.ts`). One start/end `point` per scope (diagram/composite), glyph in LABEL (`kind` informational); `<<choice>>` is a diamond. A `point` is its glyph alone: 2k-1 cells across for k ports; one entry is one arrowhead before the glyph, several meet in a bar and one arrowhead; several exits leave through a bar on the glyph's line (all tier junctions). Snake: points left-to-right, two-column row-start padding. A self edge on a point is `point-loop`. Edges join nodes, not groups: into a composite lands on its inner start, out of it on its inner end (else first/last inner state); a composite cannot loop to itself; its label is its name, then `P : text` lines after " - ". Ids reused across composites are the same state (`state-shared`). `parent` is explicit only for identical enclosing membership. Only after `state` does a quote open a name. Composite entry/exit resolves recursively to start/first and end/last child. Notes, `--` regions and fork/join reject by `GLYPH_MERMAID_STATE_*`.
- A self-edge is a fixed four-cell loop, not A*: both ports on the side no flow edge uses (`e` in TB/BT, `s` in LR/RL), room reserved EXACTLY by a dagre self-edge dummy AFTER the node (`labelpos: "c"`, or none when `nodesep` already suffices). Its label wraps like a node's (`loopLabelWidth`, traded by the fitter) and sits one blank cell past the loop, the only label exempt from route contact. Frames/snake count loops and labels with their node.
- A loop starts at its authored-first node; nodes keep authored order and backwards dagre ranks are re-laid out with back edges reversed.
- Without loops/points/nested groups, frame insets are byte-identical. ASCII marker folds (`●`/`◆`/`◉` → `*`/`*`/`@`) and punctuation wrapping are output exceptions. Nested padding yields to shared borders (`frameInset: false`) before cuts/splits. Wrapping can break after `-`, `+`, `/`, `:`; punctuation stays on the first row and is not a word cut. Letter cuts log `word-cut`.
- Bounded search: first routable snake gaps, one branch gap without hanging nodes, loops pruned by stacked footprint. Expansion: <=256 spacing/replay candidates per pass, <=128 gutters and <=384 routes across alignments; exhaustion logs `fit-search-limited` and retains the best fit. Reuse routes; skip disconnected A* targets and stop failed probes early. Whole words precede cuts. Keep a passing whole-word default exact; blocked ones probe aligned one-cell gap repairs before wraps. Then try UL/UR/DL/DR by canvas cost without extra bends/size; share identical layouts/routes and snake work. Plain aligned ranks reserve crossing channels plus turn/escape cells; loops/frames keep Dagre room.
- Fit measures labels/ports/routes; no count cutoffs or viewport presets. Search distinct wraps and independent gaps; all modes fit before semantic degradation.
- `overflow: "paginate"` (default) keeps exact canvas size; `"expand"` permits a larger one (`layout-expanded`). Ladder after fitting fails: decoration → duplicates → leaf clusters → split; never decoration once it fits, except `simplified`.
- Route same-priority sibling frame entries by nearer flow-axis border first. Paint: routes → junctions → fills → target-border heads → labels; edge labels touch their route or drop (a loop's sits one cell past it). Text/HTML/ANSI exits each carry their `canvas`.

## Don't

- Don't reuse a canvas across panels or hide an unroutable edge under a box fill; log `unroutable`.
- Don't assign reserved port slots in lexical order — dagre reorders siblings; use the laid-out transverse order. Don't claim the fan floor (`max(3, widest fan + 1)`) guarantees search: above caller spacing it leaves that axis unchanged.
- Don't move fitting into consumers, use font scaling, or accept a node box without testing centered routes. Deduplicate candidates before layout.
- Don't widen a node for loop room. Don't split Mermaid statements on `;` inside quotes, edge-text spans or after a state transition's `:`.

## Gate tests

`src/**/*.test.ts` plus `packages/compile/src/diagramCli.test.ts`. API: `README.md`.
