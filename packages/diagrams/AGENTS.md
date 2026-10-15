# @glyphcss/diagrams — agent guide

## Flow

Graph → wrap → ports → layout → route → compact → paint.

## Entry points

Root: no scene/elkjs. `./sequence`, `./lanes`: separate pipelines; share `color.ts`.

## Sequence (`./sequence`)

Time downward: validate → columns → rows → paint. `from`/`to`: direction; `kind`: verbatim. Mermaid order; JSON: dividers → openings → notes.

### Contracts

- Frames: top captions, dashed dividers, sides `1 + depth` beyond lifelines. Notes: 3 rows; side notes reserve gaps/frame room beside one lane. Repeat title; options override.
- Lifeline crossings: 4-way junctions; self-messages: 3-row loops. `canvas.text`, never `canvas.line()`.
- Degrade: cap to 3 → abbreviate participants/side notes → wrap messages/log → page by time with repeated headers (`expand` grows). Too wide: `sequence-layout-overflow`.
- Mermaid: activations inert; side notes, autonumber, title; cross/open → solid/dashed. par/and, critical/option, break frames; branches require matching frames. rect inert; box declarations only. `GLYPH_SEQUENCE_MERMAID_SYNTAX`.

### Don't

- Don't hardcode Mermaid frame kinds or page inside row-groups.

## Lanes (`./lanes`)

`nodes`: newest first; parents later (`bad-parent-order`). Git-log/Mermaid → validate → rows → cap → paint.

### Contracts

- One row/node: `* [id  ](marks)  label` (git-log ids default on). Merge connectors above, branch below; no spacers.
- `truncated: true` permits absent older parents; open lanes end dashed (`continuation`, `lane-history-continues`).
- `oldest-first` inverts (`invert.ts`); `continuesFrom` keeps original first-parent lane.
- Label cuts: one `label-abbreviated` summary/render.
- Lane cap: total columns; collapse keeps row/label (`lane-cap-collapsed`). Degrade cap → page (node+connectors) → truncate.

- gitGraph → lanes (README). Tags/types/provenance as text; picks parent only current head. TB/LR oldest-first, BT newest-first; log LR/config fallback. Lanes: main/unordered/numeric; mainBranchOrder overrides. Scalar name/order/visibility; strip YAML comments. `GLYPH_MERMAID_GIT_SYNTAX`.
- Mindmap → LR undirected tree: indent stack/uneven dedents/distinct repeats; literal apostrophes. Families: bang/cloud/default rounded; hex rect. Icons/classes/config inert; markdown plain; log fallbacks. `GLYPH_MERMAID_MINDMAP_SYNTAX`.

## Class and ER

- `compartment`: rect/header/left-aligned members; alone accepts `compartments: string[][]`. Measure/fit includes members; empty sections omitted. Ports avoid rules/corners in all layouts/loops.
- `-` ids; spaced generics/ER backtick attributes. Literal typography; namespaces/groups, notes/rows, multiplicity/bracket captions (source first). Config/styles/URLs inert; log fallbacks. `GLYPH_MERMAID_{CLASS,ER}_SYNTAX`.
- Heads: `relation-markers`, pending approval; ER: border + escape. Degradation keeps semantics. Auto-direction: caption-safe viewport pressure; LR room once. Captions clear frame borders. CJK: `label-folded`.

## Colour

`string | ((item) => string)`, once/item (`color.ts`, `bad-color`). Lanes/participants cycle. `color: "none"` byte-identical; never sole cue.

## Contracts

- Ledger `{ code, message, detail? }`; repair hints.
- `unroutable`: final output only; non-fitting layout: `layout-overflow`, never `routing-attempt`. Bad JSON: `GLYPH_DIAGRAM_BAD_JSON`; ELK: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid → approved families (`mermaidShapes.ts`); assets inert; log `mermaid-degraded`. Diamond markers are measured/painted, never labels/meta; source/graph share selection. Clean fits keep markers; troubled fits drop all if better (`diamond-markers-dropped`), even faithful; keep authored/state glyphs. Heads: vocabulary in `types.ts`; bidirectional one edge; invisible links layout only. Log length/direction/group/markdown/metadata fallbacks. Parse once; link ids own metadata.
- Styles/interactions/comments inert; `class` declares classDiagram nodes. Shared measurement `fold` logs `label-folded`; blank rows place no text/ledger. Loops reserve full label rectangles, including blanks. Wrapped rows: `edge-row:` + JSON `[edgeId, rowIndex]`; distinct ids, edge colour. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR (`mermaidState.ts`). One start/end `point` per scope; label glyph, informational `kind`. `<<choice>>` is a diamond.
- Points: glyph, 2k-1 transverse cells for k ports. Equal heads may share bars/tips; mixed heads keep ports. Exit junctions on glyph row. LR snake: two-column padding. Self-edge: `point-loop`.
- Composites: enter start/first child, exit end/last; no self-loop. Empty → state. Caption joins name/descriptions with " - ".
- States: shared ids log `state-shared`; equal groups need `parent`. Quotes open after `state`. Notes/regions/fork/join reject (`GLYPH_MERMAID_STATE_*`).
- Self-edges: 4-cell loops on `e` (TB/BT), `s` (LR/RL). Dagre dummy after node (`labelpos: "c"`) only if needed. Labels wrap at `loopLabelWidth`, one cell past loop. Frames/snake include them.
- Loops start authored-first. Flat LR cycles: spine/top return/feeders below targets; stack side joins by column, reserve clearance, rewrap within caps, merge bottom centres. Side joins exit laterally; margin 0 before Dagre. Validate options; other cycles use Dagre/snake.
- Insets byte-identical except approved markers/folds/wraps. Nested padding yields to shared borders before cuts/splits. Wrap after `+/:`; hyphen splits only beyond width; letter cuts log `word-cut`.
- Limits: 256 expansion probes/128 gutters/384 routes (`fit-search-limited`). Shared budget 2,500,000: edges cubed/layout, squared/snake; 1,000/route, one/A*/flood expansion. Reserve wraps/two gaps/one route; reuse routes, stop on failure. Exhaustion keeps fit or edge panels (`render-work-limited`); no resets/partial probes.
- Chain snakes reflect occupied bands; align turns within clearance. Branches/loops unchanged.
- Before cuts, keep longest uncapped tokens. Crowded sources try one-cell gaps; trade widths for tallest labels, balance short wraps. Spacing >=3. Compact post-fit; protect gaps/turns/ports/loops/frames and box/route moats.
- Widen cuts once. Score words/crossings/frames/bends/detours/length. Replay UR/UL labels, two perpendicular wraps; first improvement. Wide LR/RL DAGs try two vertical wraps before repair; no new crossings/drops.
- Straighten links/subtrees in free space, any direction; other shifts ≤3 cells. No added crossings/frames/drops.
- Fold one ≥3-box TB/BT tail/suffix LR before expansion. Gaps 2 then 1; widen tall labels; reserve entries. Frames: one gap-1 probe centred in source span, only if better. No groups/loops/points.
- LR/RL siblings keep authored order. Fans share style ports/trunks; mixed fans/returns/parallel edges/points/frame crossings keep lanes. Never join buses through one edge. Exits: junctions; fan-ins: one head. LR/RL sinks align near edges, one blank sibling row. Singleton styles share exit stubs, separate buses, no extra rows. Single-source feeders beside targets; no added crossings.
- Fan captions follow exclusive stems/entries. Move entries for room; vertical fan-ins shift boxes ≤1 cell, centre ports. Missing captions reserve room, then two margin-0 probes.
- `overflow: "paginate"` keeps exact size; `"expand"` grows (`layout-expanded`). Failed fit: decoration → duplicates → leaves → split; fitted decoration survives except optional diamond markers or `simplified`.
- Equal-priority frame entries: nearer border first. Paint routes/junctions/fills/heads/labels. Labels clear vertical stems by one cell; else touch route or drop (loops: one cell past). Dotted straights use continuous hops.

## Don't

- Don't reuse canvases or hide unroutable edges under fills; log `unroutable`.
- Ports follow sibling order, never lexical. No style-bus merges beyond shared exit stubs; keep loop slots.
- Fit here; no font scaling. Deduplicate first.
- No loop-driven node widening. Preserve `;` in quotes, edge-text spans, and after state-transition `:`.
