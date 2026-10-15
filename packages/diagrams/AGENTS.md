# @glyphcss/diagrams — agent guide

## Flow

Graph → wrap → ports → layout → route → compact → paint.

## Entry points

- Root: no scene/elkjs.
- `./sequence`, `./lanes`: separate IR/pipelines; share `color.ts`.

## Sequence (`./sequence`)

Time downward. Validate → columns → rows → paint. `from`/`to`: direction; frame/branch `kind`: verbatim. Mermaid authored order survives validation/paging; JSON: dividers → openings → notes.

### Invariants

- Frames: top captions, dashed dividers, sides `1 + depth` past lifelines. Notes: 3-row bars; left/right beside one lane, reserving gaps/frame room. Repeat title; options override it.
- Lifeline crossings: 4-way junctions; self-messages: 3-row loops. `canvas.text`, never `canvas.line()`.
- Degrade: cap to 3 → abbreviate participants/side notes → wrap messages/log → page by time with repeated headers (`expand` grows). Too wide: `sequence-layout-overflow`.
- Mermaid: activation suffixes/directives ignored; left/right notes, `autonumber`, `title`, cross/open arrows normalized to solid/dashed; `par`/`and`, `critical`/`option`, `break` frames. Branches need matching frames. `rect` inert; `box` declarations only. Unsupported: `GLYPH_SEQUENCE_MERMAID_SYNTAX`.

### Don't

- Don't hardcode Mermaid frame kinds or page inside row-groups.

## Lanes (`./lanes`)

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

- Ledger `{ code, message, detail? }`; repair hints.
- `unroutable`: final output only; non-fitting layout: `layout-overflow`, never `routing-attempt`. Bad JSON: `GLYPH_DIAGRAM_BAD_JSON`; ELK: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid v11 → approved families (`mermaidShapes.ts`); assets inert. `mermaid-degraded`/canonical fallback. Diamond markers are measured/painted presentation, never graph labels/meta. Source/graph share state: keep clean fits; compare troubled fits without markers. If better, drop all (`diamond-markers-dropped`), even faithful; preserve authored/state glyphs. Heads: arrow/circle/cross/none; bidirectional ONE edge. Invisible links only lay out. Log length, local direction, group endpoint, markdown/metadata approximations. Parse once; link ids own metadata.
- Mermaid `classDef`/`class`/`style`/`click`/`linkStyle`/`%%` are inert; never execute. Labels share `measureGlyphGraph`'s `fold` (`label-folded`); empty rows place no text/label ledger entries. Loops reserve full label rectangles, including blanks, against labels. Wrapped rows: `edge-row:` + JSON `[edgeId, rowIndex]`; distinct ids, edge colour. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR (`mermaidState.ts`). One start/end `point` per diagram/composite; glyph in label, informational `kind`. `<<choice>>` is a diamond.
- Points: glyph, 2k-1 transverse cells for k ports. Entry: head before glyph; several: bar then head. Exit: bar/tier junctions on glyph row. Snake: LR, two-column row padding. Self-edge: `point-loop`.
- Composite edges enter start/first child, exit end/last child; no self-loop. Empty composites are states. Caption: name then `P : text` after " - ".
- Shared ids: one state (`state-shared`); equal members need `parent`. Quotes open names after `state`. Notes, regions, fork/join reject: `GLYPH_MERMAID_STATE_*`.
- Self-edges: 4-cell loops on `e` (TB/BT), `s` (LR/RL). Dagre dummy after node (`labelpos: "c"`) only if needed. Labels wrap at `loopLabelWidth`, one cell past loop. Frames/snake include them.
- Loops start at authored-first. Flat LR cycles: spine, top return, feeders below targets. Stack side joins by spine column; reserve clearance, rewrap within caps, merge into bottom centres. Side joins exit laterally; try zero margin before Dagre. Validate options first; other cycles use Dagre/snake.
- Insets stay byte-identical except approved markers/folds and punctuation wraps. Nested padding yields to shared borders before cuts/splits. Wrap after `+/:`; split hyphenated tokens only beyond wrap width. Letter cuts log `word-cut`.
- Expansion: ≤256 probes, ≤128 gutters, ≤384 routes (`fit-search-limited`). Reuse routes; stop on failure.
- Budget: 2,500,000; edges cubed/layout, squared/snake; 1,000/routing, one/A* or flood expansion. Shared probes/splits; reserve wraps, two gaps, one route. Exhaustion keeps a fit or edge panels (`render-work-limited`); no resets/partial probes.
- Before cuts, uncapped nodes may keep their longest token. Crowded sources try one-cell gaps and trade widths for the tallest label, balancing equally short wraps. Spacing >=3. Compact post-fit; protect gaps/turns/ports/loops/frames.
- Widen cuts once. Score: words → crossings → frames → bends → detours → length. Replay UR/UL labels and two perpendicular wraps; first improvement. Wide LR/RL DAGs try two vertical wraps before repair. No new crossings/drops.
- Straighten single links/subtrees in all directions within free space; other shifts ≤3 cells. No added crossings/frames/drops.
- Fold one ≥3-box TB/BT tail/suffix LR to save rows. Gaps 2 then 1; widen tall labels into spare cells. Reserve entry clearance. For frames, try one gap-1 probe centred inside the framed source span; require improvement. Before expansion when feasible. No groups/loops/points.
- Equivalent flat LR/RL siblings follow authored order. Fans share ports/trunks by style; mixed fan-in/out connections, returns, parallel edges, points and frame crossings keep lanes. Never join two buses through one shared edge. Shared exits: junctions; fan-ins: one head. Flat LR/RL sink fans align near edges with one blank sibling row. Singleton styles share exit stubs; separate buses, no extra rows. Order single-source feeders beside targets; guard crossings.
- Fan captions follow their exclusive segment/stem and prefer their own entry. Move entries for label room; vertical fan-ins shift boxes ≤1 cell with centre ports. Missing captions reserve room, then two compact margin-0 probes.
- Compact pass-through slices; protect labels, borders, bends, ports and box/route moats. Keep grouped geometry.
- `overflow: "paginate"` (default) keeps exact canvas size; `"expand"` grows canvases (`layout-expanded`). After fit fails: decoration → duplicates → leaf clusters → split; no further decoration loss on a fit except optional diamond markers or `simplified`.
- Sibling frame entries: nearer border first at equal priority. Paint: routes → junctions → fills → heads → labels. Labels clear vertical stems by one blank cell; otherwise touch their route or drop (loops: one cell past). Dotted straight cells use continuous hop glyphs. Text/HTML/ANSI carry `canvas`.

## Don't

- Don't reuse panel canvases or hide unroutable edges under fills; log `unroutable`.
- Don't assign ports lexically: follow sibling order. Don't merge style buses beyond a shared exit stub or move loop slots.
- Don't move fitting to consumers, scale fonts, or skip centered-route tests. Deduplicate first.
- Don't widen a node for loop room. Don't split Mermaid statements on `;` inside quotes, edge-text spans or after a state transition's `:`.

## Tests

`src/**/*.test.ts`; CLI: `diagramCli.test.ts`.
