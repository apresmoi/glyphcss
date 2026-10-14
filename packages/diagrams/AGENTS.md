# @glyphcss/diagrams — agent guide

Cell-text graphs, sequences, lane DAGs; root rules apply.

## Pipeline

Adapters → `GlyphGraph` → measure/wrap → ports → layout (Dagre ranks/order/alignment → gap channels) → center → route → fresh-canvas paint. `renderGlyphDiagram` fits/reuses layout/routes; default target web.

## 2D entry points

- Root never imports glyphcss's scene or elkjs (`./elk` is a stub).
- `./sequence`, `./lanes`: separate IR/pipelines, never `GlyphGraph`; share only `color.ts` with each other/root.

## Sequence diagrams (`./sequence`)

Authored order; time downward; label-sized. Validate → columns → rows → paint. `from`/`to` give direction; frame/branch `kind` renders verbatim. Mermaid note/opening/divider order survives validation/paging; JSON: dividers → openings → notes.

### Invariants

- Frames: top-border label, dashed dividers, sides `1 + depth` past lifelines. Notes: 3-row bars; `placement: "left" | "right"` beside one lane; reserve neighbouring gaps and enclosing-frame room. `title` repeats above headers; render options override it.
- Lifeline crossings: 4-way junctions; self-messages: 3-row loops. Whole-cell `canvas.text`, never `canvas.line()`.
- Degrade: shrink cap to 3, abbreviate participants/side notes, WRAP messages and log; then page by TIME at message boundaries with repeated headers (`expand` grows). Too wide at floor: `sequence-layout-overflow`.
- Mermaid: activation suffixes/directives ignored; left/right notes, `autonumber`, `title`, cross/open arrows normalized to solid/dashed; `par`/`and`, `critical`/`option`, `break` frames. Branches need matching frames. `rect` inert; `box` declarations only. Unsupported: `GLYPH_SEQUENCE_MERMAID_SYNTAX`.

### Don't

- Don't hardcode Mermaid frame kinds or page inside row-groups.

## Lane DAGs (`./lanes`)

`nodes`: NEWEST FIRST; parents LATER (`bad-parent-order`). Git-log → validate → rows → cap → paint.

### Invariants

- One row per node: `*` + `[id  ](marks)  label` (`ids` defaults on for git-log). Merge connectors ABOVE, branch connectors BELOW; no spacer rows.
- `truncated: true` allows absent older parents. Open lanes end in dashed `continuation`, logged `lane-history-continues`.
- `order: "oldest-first"` inverts (`invert.ts`) through this layout; `continuesFrom` keeps the ORIGINAL first-parent lane.
- Label cuts: one `label-abbreviated` summary per render.
- Lane `cap` is TOTAL columns; collapse preserves row/label (`lane-cap-collapsed`). Degrade: cap → page (node+connectors together) → truncate labels.

## Colour

`nodeColor`/`edgeColor`/`laneColor`/`participantColor`: `string | ((item) => string)`; resolve once/item; shared `color.ts` checks (`bad-color`). Root flat; lanes/participants cycle palette. `color: "none"` byte-identical; colour never the sole cue.

## Invariants

- `GLYPH_DIAGRAM_VALIDATION_RULES`: runtime/schema plus repair hints. `report.ledger` entries are `{ code, message, detail? }`.
- `unroutable`: final output only; non-fitting layout: `layout-overflow`, never `routing-attempt`. Malformed JSON: `GLYPH_DIAGRAM_BAD_JSON`; `engine: "elk"`: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid shapes: cylinder → `cylinder`, double circle → `circle`, parallelogram/trapezoid/hexagon → `rect`. `<-->` → two directed edges; `--->` solid; `o--o`/`x--x` undirected; `~~~` named rejection (no layout-only edge).
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert; never execute. Labels share `measureGlyphGraph`'s `fold` (`label-folded`); empty rows place no text/label ledger entries. Loops reserve full label rectangles, blank rows/unused width included, against other labels. Wrapped rows: `edge-row:` + JSON `[edgeId, rowIndex]`, distinct from `edge:` ids; keep edge colour. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR (`mermaidState.ts`). One start/end `point` per diagram/composite; glyph in LABEL, `kind` informational. `<<choice>>` is a diamond.
- Points: glyph alone, 2k-1 cells across, k ports. One entry: arrowhead before glyph; several: bar then one head. Several exits: bar on glyph's line; all junctions use the tier. Snake: points left-to-right, two-column row-start padding. Point self-edges: `point-loop`.
- Composite edges join inner nodes: recursively enter start/first child, exit end/last child. No composite self-loop. Empty composites are ordinary states. Label: name then `P : text` lines after " - ".
- Reused ids are one state (`state-shared`); explicit `parent` requires identical enclosing membership. Quotes open names only after `state`. Notes, `--` regions, fork/join reject as `GLYPH_MERMAID_STATE_*`.
- Self-edges: fixed four-cell loops, not A*; ports on a side no flow edge uses (`e` in TB/BT, `s` in LR/RL), exact room: Dagre dummy AFTER node (`labelpos: "c"`, or none when `nodesep` already suffices). Loop labels wrap like node labels (`loopLabelWidth`, traded by fitter), sit one blank cell past the loop, and alone need no route contact. Frames/snake count loops/labels with their node.
- Loops start at the authored-first node; preserve node order. Re-layout backwards Dagre ranks with back edges reversed. Back edges: transverse ports on Dagre's side; keep self-loop sides and point flow ports.
- Without loops/points/nested groups, frame insets stay byte-identical. ASCII folds (`●`/`◆`/`◉` → `*`/`*`/`@`) and punctuation wrapping are output exceptions. Nested padding yields to shared borders (`frameInset: false`) before cuts/splits. Wrap after `-`, `+`, `/`, `:`; punctuation stays on the first row, not a word cut. Letter cuts log `word-cut`.
- Bounded search: first routable snake gaps; one branch gap without hanging nodes; prune stacked loops and impossible node area/acyclic rank paths.
- Expansion per pass: <=256 spacing/replay candidates, <=128 gutters, <=384 routes across alignments (`fit-search-limited`). Reuse routes; skip disconnected targets; stop failed probes early.
- Render budget: 2,500,000 search units; non-self edges cubed/layout, squared/snake; 1,000/routing, one/A* or flood expansion. Shared across directions, frames, rungs and splits. Reserve panel wrapping, two gap choices and one route. Exhaustion keeps the best fit or uses wrapped edge panels (`render-work-limited`); no resets or partial probes.
- Whole words before cuts. Keep passing whole-word defaults exact; blocked ones try aligned one-cell gap repairs before wraps. Try UL/UR/DL/DR by canvas cost without extra bends/size; share layouts/routes and snake work when identical. Plain aligned ranks reserve crossing channels plus turn/escape cells; loops/frames keep Dagre room.
- Fit measures labels/ports/routes; no count cutoffs/viewport presets. Search distinct wraps/independent gaps within the shared work budget before semantic degradation.
- `overflow: "paginate"` (default) keeps exact canvas size; `"expand"` grows canvases (`layout-expanded`). After fitting fails: decoration → duplicates → leaf clusters → split; no decoration once it fits, except `simplified`.
- Same-priority sibling frame entries: nearer flow-axis border first. Paint: routes → junctions → fills → target-border heads → labels; one-cell routes paint along the port axis; edge labels touch their route or drop (a loop's sits one cell past it). All Text/HTML/ANSI exits carry `canvas`.

## Don't

- Don't reuse a canvas across panels or hide an unroutable edge under box fill; log `unroutable`.
- Don't assign ports lexically: use Dagre's laid-out transverse sibling order. Don't claim fan floor (`max(3, widest fan + 1)`) guarantees search: above caller spacing it leaves that axis unchanged.
- Don't move fitting to consumers, scale fonts, or accept node boxes without testing centered routes. Deduplicate before layout.
- Don't widen a node for loop room. Don't split Mermaid statements on `;` inside quotes, edge-text spans or after a state transition's `:`.

## Gates

`src/**/*.test.ts` plus `packages/compile/src/diagramCli.test.ts`. API: `README.md`.
