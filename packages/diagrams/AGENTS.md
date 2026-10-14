# @glyphcss/diagrams — agent guide

Graphs/sequences/lanes; root rules apply.

## Pipeline

Adapters → `GlyphGraph` → wrap → ports → Dagre ranks/order/alignment → gap channels → center → route → geometry compaction → fresh-canvas paint. `renderGlyphDiagram` reuses fits/routes; default web.

## 2D entry points

- Root imports no scene/elkjs (`./elk` stub).
- `./sequence`, `./lanes`: separate IR/pipelines, never `GlyphGraph`; share only `color.ts`.

## Sequence diagrams (`./sequence`)

Authored order/time downward. Validate → columns → rows → paint. `from`/`to` give direction; frame/branch `kind` renders verbatim. Mermaid note/opening/divider order survives validation/paging; JSON: dividers → openings → notes.

### Invariants

- Frames: top-border label, dashed dividers, sides `1 + depth` past lifelines. Notes: 3-row bars; `placement: "left" | "right"` beside one lane; reserve neighbouring gaps/frame room. `title` repeats above headers; options override it.
- Lifeline crossings: 4-way junctions; self-messages: 3-row loops. `canvas.text`, never `canvas.line()`.
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
- Label cuts: one `label-abbreviated` summary/render.
- Lane `cap` is TOTAL columns; collapse preserves row/label (`lane-cap-collapsed`). Degrade: cap → page (node+connectors together) → truncate labels.

## Colour

`nodeColor`/`edgeColor`/`laneColor`/`participantColor`: `string | ((item) => string)`; resolve once/item; shared `color.ts` checks (`bad-color`). Root flat; lanes/participants cycle colours. `color: "none"` byte-identical; colour never the sole cue.

## Invariants

- `GLYPH_DIAGRAM_VALIDATION_RULES`: runtime/schema + repair hints. `report.ledger` entries are `{ code, message, detail? }`.
- `unroutable`: final output only; non-fitting layout: `layout-overflow`, never `routing-attempt`. Malformed JSON: `GLYPH_DIAGRAM_BAD_JSON`; `engine: "elk"`: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid shapes: cylinder → `cylinder`, double circle → `circle`, parallelogram/trapezoid/hexagon → `rect`. `<-->` → two directed edges; `--->` solid; `o--o`/`x--x` undirected; `~~~` named rejection (no layout-only edge).
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert; never execute. Labels share `measureGlyphGraph`'s `fold` (`label-folded`); empty rows place no text/label ledger entries. Loops reserve full label rectangles, blank rows/unused width included, against other labels. Wrapped rows: `edge-row:` + JSON `[edgeId, rowIndex]`; distinct ids, edge colour. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR (`mermaidState.ts`). One start/end `point` per diagram/composite; glyph in LABEL, `kind` informational. `<<choice>>` is a diamond.
- Points: glyph alone, 2k-1 cells across, k ports. Entry: head before glyph; several: bar then head. Exits: bar on glyph row; tier junctions. Snake: points left-to-right, two-column row-start padding. Point self-edges: `point-loop`.
- Composite edges enter start/first child, exit end/last child; no self-loop. Empty composites are states. Label: name then `P : text` lines after " - ".
- Reused ids: one state (`state-shared`); identical members for `parent`. Quotes open names after `state`. Notes, regions, fork/join reject: `GLYPH_MERMAID_STATE_*`.
- Self-edges: 4-cell loops on `e` in TB/BT, `s` in LR/RL. Dagre dummy after node (`labelpos: "c"`), omitted when `nodesep` suffices. Wrap labels at `loopLabelWidth`, one blank cell past the loop. Frames/snake include loops/labels.
- Loops start at authored-first node. Reverse backwards ranks; returns use Dagre transverse sides; preserve loop/point ports.
- Without loops/points/nesting, frame insets stay byte-identical. ASCII folds (`●`/`◆`/`◉` → `*`/`*`/`@`) and punctuation wrapping are output exceptions. Nested padding yields to shared borders (`frameInset: false`) before cuts/splits. Wrap after `-`, `+`, `/`, `:`; punctuation stays above, not a word cut. Letter cuts log `word-cut`.
- Search: first routable snake gaps; prune impossible footprints.
- Expansion: ≤256 spacing/replay probes, ≤128 gutters, ≤384 routes (`fit-search-limited`). Reuse routes; stop on failure.
- Budget: 2,500,000; edges cubed/layout, squared/snake; 1,000/routing, one/A* or flood expansion. Shared across probes/splits. Reserve panel wraps, two gaps, one route. Exhaustion keeps a fit or edge panels (`render-work-limited`); no resets/partial probes.
- Whole words before cuts; compact post-fit. Reuse bounded UL/UR/DL/DR fits; protect gaps/turns/ports/loops/frames.
- Widen cuts into spare columns once. Score: words → crossings → frames → bends → detours → length. Replay fitted UR/UL labels and two perpendicular wraps; first improvement. Wide LR/RL DAGs try two vertical wraps before repair. No added crossings/drops.
- Straighten single links/subtrees within free space; other shifts ≤3 columns. No added crossings/frames/drops.
- Fold one ≥3-box TB/BT tail to reduce occupied rows, even within the canvas, left-to-right; move the head left if needed; reserve incoming clearance upstream. No groups/loops/points. Whole words before folding.
- Forward fans share ports/trunks by style; mixed fan-in/out connections, returns, parallel edges, points and frame crossings keep lanes. Never join two buses through one shared edge. Shared exits: junctions; fan-ins: one head. Flat LR/RL fans keep one blank sibling row; public spacing stays authored.
- Edge labels on exclusive branches. Reserve missing labels on the measured fit (one layout/reroute); vertical reservations include side room in bounds. One fit only.
- Compact pass-through rows/columns before paint; keep labels, borders, bends, ports and a blank box/route moat. Preserve grouped geometry.
- Wrap/gap before degrading.
- `overflow: "paginate"` (default) keeps exact canvas size; `"expand"` grows canvases (`layout-expanded`). After fitting fails: decoration → duplicates → leaf clusters → split; no decoration once it fits, except `simplified`.
- Sibling frame entries: nearer border first at equal priority. Paint: routes → junctions → fills → border heads → labels. One-cell routes use the port axis. Labels clear vertical stems by one blank cell; otherwise touch their route or drop (loops: one cell past). Dotted straight cells use continuous hop glyphs. Text/HTML/ANSI carry `canvas`.

## Don't

- Don't reuse a canvas across panels or hide an unroutable edge under box fill; log `unroutable`.
- Don't assign ports lexically: follow Dagre sibling order. Don't merge different styles or move loop slots when regrouping ports.
- Don't move fitting to consumers, scale fonts, or accept node boxes without centered-route tests. Deduplicate before layout.
- Don't widen a node for loop room. Don't split Mermaid statements on `;` inside quotes, edge-text spans or after a state transition's `:`.


## Gates

`src/**/*.test.ts` plus `packages/compile/src/diagramCli.test.ts`. `README.md`: API.
