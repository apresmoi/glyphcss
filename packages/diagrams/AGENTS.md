# @glyphcss/diagrams — agent guide

## Flow

Graph → wrap → ports → layout → route → compact → paint.

## Entry points

- Root: no scene/elkjs.
- `./sequence`, `./lanes`: separate IR/pipelines; share `color.ts`.

## Sequence (`./sequence`)

Time downward; validate → columns → rows → paint. `from`/`to`: direction; `kind`: verbatim. Preserve Mermaid order through validation/paging; JSON: dividers → openings → notes.

### Invariants

- Frames: top captions, dashed dividers, sides `1 + depth` past lifelines. Notes: 3-row bars; left/right beside one lane, reserving gaps/frame room. Repeat title; options override it.
- Lifeline crossings: 4-way junctions; self-messages: 3-row loops. `canvas.text`, never `canvas.line()`.
- Degrade: cap to 3 → abbreviate participants/side notes → wrap messages/log → page by time with repeated headers (`expand` grows). Too wide: `sequence-layout-overflow`.
- Mermaid: activations inert; side notes, autonumber, title; cross/open → solid/dashed. par/and, critical/option, break frames; branches require matching frames. rect inert; box declarations only. Invalid: `GLYPH_SEQUENCE_MERMAID_SYNTAX`.

### Don't

- Don't hardcode Mermaid frame kinds or page inside row-groups.

## Lanes (`./lanes`)

`nodes`: newest first; parents later (`bad-parent-order`). Git-log/Mermaid → validate → rows → cap → paint.

### Invariants

- One row/node: `* [id  ](marks)  label` (git-log ids default on). Merge connectors above, branch below; no spacers.
- `truncated: true` permits absent older parents; open lanes end dashed (`continuation`, `lane-history-continues`).
- `oldest-first` inverts (`invert.ts`); `continuesFrom` keeps original first-parent lane.
- Label cuts: one `label-abbreviated` summary/render.
- Lane cap: total columns; collapse keeps row/label (`lane-cap-collapsed`). Degrade cap → page (node+connectors) → truncate.

- Mermaid gitGraph → lanes (grammar: README). Text tags/types/provenance; picks parent only current head. TB/LR oldest-first, BT newest-first; log LR/config degradation. Branch lanes: main first; unordered then numeric order; mainBranchOrder overrides. Scalar name/order/visibility; strip YAML comments. `GLYPH_MERMAID_GIT_SYNTAX`.
- Mindmap → LR undirected tree: indent stack, uneven dedents, distinct repeats; apostrophes literal. Approved families; bang/cloud/default rounded, hex rect. Icons/classes/config inert, markdown plain; log approximations. `GLYPH_MERMAID_MINDMAP_SYNTAX`.

## Colour

Colors: `string | ((item) => string)`, resolved once/item (`color.ts`, `bad-color`). Lanes/participants cycle. `color: "none"` byte-identical; never sole cue.

## Invariants

- Ledger `{ code, message, detail? }`; repair hints.
- `unroutable`: final output only; non-fitting layout: `layout-overflow`, never `routing-attempt`. Bad JSON: `GLYPH_DIAGRAM_BAD_JSON`; ELK: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid → approved families (`mermaidShapes.ts`), inert assets, `mermaid-degraded` fallbacks. Diamond markers: measured/painted, never labels/meta; source/graph share selection. Keep clean fits; compare troubled fits without markers, drop all if better (`diamond-markers-dropped`), even faithful; preserve authored/state glyphs. Heads: arrow/circle/cross/none; bidirectional one edge; invisible links layout only. Log length/direction/group/markdown/metadata approximations. Parse once; link ids own metadata.
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert; never execute. Labels share `measureGlyphGraph`'s `fold` (`label-folded`); empty rows place no text/label ledger entries. Loops reserve full label rectangles, including blanks, against labels. Wrapped rows: `edge-row:` + JSON `[edgeId, rowIndex]`; distinct ids, edge colour. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR (`mermaidState.ts`). One start/end `point` per diagram/composite; glyph in label, informational `kind`. `<<choice>>` is a diamond.
- Points: glyph, 2k-1 transverse cells for k ports. Entries share a bar/tip only for equal heads; mixed heads stay on their ports. Exit junctions on glyph row. LR snake: two-column padding. Self-edge: `point-loop`.
- Composites: enter start/first child, exit end/last; no self-loop. Empty → state. Caption: name then `P : text` after " - ".
- Shared ids: one state (`state-shared`); equal members need `parent`. Quotes open names after `state`. Notes, regions, fork/join reject: `GLYPH_MERMAID_STATE_*`.
- Self-edges: 4-cell loops on `e` (TB/BT), `s` (LR/RL). Dagre dummy after node (`labelpos: "c"`) only if needed. Labels wrap at `loopLabelWidth`, one cell past loop. Frames/snake include them.
- Loops start authored-first. Flat LR cycles: spine, top return, feeders below targets; stack side joins by spine column, reserve clearance, rewrap within caps, merge bottom centres. Side joins exit laterally; try margin 0 before Dagre. Validate options first; other cycles Dagre/snake.
- Insets byte-identical except approved markers/folds/punctuation wraps. Nested padding yields to shared borders before cuts/splits. Wrap after `+/:`; split hyphens only beyond wrap width; letter cuts log `word-cut`.
- Expansion ≤256 probes, ≤128 gutters, ≤384 routes (`fit-search-limited`); reuse routes, stop on failure.
- Budget 2,500,000: edges cubed/layout, squared/snake; 1,000/routing, one/A*/flood expansion. Shared probes/splits; reserve wraps, two gaps, one route. Exhaustion: keep fit or edge panels (`render-work-limited`); no resets/partial probes.
- Before cuts, uncapped nodes keep longest tokens. Crowded sources try one-cell gaps; trade widths for tallest labels, balance equally short wraps. Spacing >=3. Compact post-fit; protect gaps/turns/ports/loops/frames.
- Widen cuts once. Score words → crossings → frames → bends → detours → length. Replay UR/UL labels, two perpendicular wraps; first improvement. Wide LR/RL DAGs try two vertical wraps before repair; no new crossings/drops.
- Straighten single links/subtrees within free space, any direction; other shifts ≤3 cells. No added crossings/frames/drops.
- Fold one ≥3-box TB/BT tail/suffix LR before expansion when feasible. Gaps 2 then 1; widen tall labels in spare cells; reserve entry clearance. Frames: one gap-1 probe centred in framed source span, only if better. No groups/loops/points.
- LR/RL tree children and equivalent flat siblings keep authored order. Fans share ports/trunks by style; mixed fan-in/out connections, returns, parallel edges, points and frame crossings keep lanes. Never join two buses through one shared edge. Shared exits: junctions; fan-ins: one head. Flat LR/RL sink fans align near edges with one blank sibling row. Singleton styles share exit stubs; separate buses, no extra rows. Order single-source feeders beside targets; guard crossings.
- Fan captions follow exclusive segments/stems and own entries. Move entries for room; vertical fan-ins shift boxes ≤1 cell, centre ports. Missing captions reserve room, then two compact margin-0 probes.
- Compact pass-through slices; protect labels/borders/bends/ports, box/route moats and grouped geometry.
- `overflow: "paginate"` (default) keeps exact canvas size; `"expand"` grows canvases (`layout-expanded`). After fit fails: decoration → duplicates → leaf clusters → split; no further decoration loss on a fit except optional diamond markers or `simplified`.
- Sibling frame entries: nearer border first at equal priority. Paint routes → junctions → fills → heads → labels. Labels clear vertical stems by one blank cell; else touch route or drop (loops: one cell past). Dotted straights: continuous hop glyphs.

## Don't

- Don't reuse canvases or hide unroutable edges under fills; log `unroutable`.
- Ports follow sibling order, never lexical. No style-bus merges beyond shared exit stubs; keep loop slots.
- Fit here; no font scaling; keep centered-route tests. Deduplicate first.
- No loop-driven node widening. Preserve `;` in quotes, edge-text spans, and after state-transition `:`.

## Tests

`src/**/*.test.ts`.
