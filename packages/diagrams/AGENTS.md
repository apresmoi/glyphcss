# @glyphcss/diagrams — agent guide

## Flow

Graph → wrap → ports → layout → route → compact → paint.

## Entries

Root: no scene/elkjs. Separate sequence/lane pipelines.

## Sequence (`./sequence`)

Time downward: validate → columns → rows → paint. `from`/`to`: direction; verbatim `kind`. Mermaid order; JSON: dividers → openings → notes.

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

- `compartment`: rect/header/left-aligned `compartments: string[][]`; no other shape accepts members. Measure/fit includes rows; omit empty sections. Ports avoid rules/corners.
- `-` ids; spaced generics/ER backtick attributes. Literal typography; namespaces/groups, notes/rows, multiplicity/bracket captions (source first). Config/styles/URLs inert; log fallbacks. `GLYPH_MERMAID_{CLASS,ER}_SYNTAX`.
- Heads: `relation-markers`, pending approval; ER: border + escape. Degradation keeps semantics. Auto-direction: caption-safe viewport pressure; LR room once. Captions clear frame borders. CJK: `label-folded`.

## Block, architecture, requirement and C4

- Structured Mermaid: tolerant; inert assets/directives; named errors (shared shapes/links: generic).
- Block hints survive object renders, not JSON. Recursive columns/rows; span N = N columns + N−1 gaps; frames inset content by 2 cells. Wrap words → fewer columns (`block-row-wrap`) → fitter for crowding/height/>256 (`block-layout`). Empty/spaces → blank/title + `block-empty`; JSON nonempty. Arrows: asymmetric + tag.
- Architecture: icon tags (`database` → `[db]`), junction `+`. First source side guides direction; ports/alignment/group edges approximate, logged. Self-loop → rounded.
- Requirements: compartments/fields/seven labelled relations; plain markdown. C4: person rounded, Db cylinder, Queue rect, Ext marker; stereotypes. Boundaries: groups. Dynamic numbers: relation order. Index/style/layout/title/assets inert. Adaptive orientation preserves captions unless overridden; missing group captions try perpendicular fit.

## Colour

`string | ((item) => string)`, once/item (`color.ts`, `bad-color`). Lanes/participants cycle. `color: "none"` byte-identical; never sole cue.

## Contracts

- Ledger: `{ code, message, detail? }` + hints.
- `unroutable`: final output only; non-fitting layout: `layout-overflow`, never `routing-attempt`. Bad JSON: `GLYPH_DIAGRAM_BAD_JSON`; ELK: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid → approved families (`mermaidShapes.ts`); assets inert; log `mermaid-degraded`. Diamond markers are measured/painted, never labels/meta; source/graph share selection. Clean fits keep markers; troubled fits drop all if better (`diamond-markers-dropped`), even faithful; keep authored/state glyphs. Heads: vocabulary in `types.ts`; bidirectional one edge; invisible links layout only. Log length/direction/group/markdown/metadata fallbacks. Parse once; link ids own metadata.
- Styles/interactions/comments inert; classDiagram `class` declares nodes. Shared folding logs `label-folded`; blank rows have no text/ledger. Loops reserve blank rows too. Wrapped labels: `edge-row:` + JSON `[edgeId, rowIndex]`; distinct ids, edge colour. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR (`mermaidState.ts`). One start/end `point` per scope; label glyph, informational `kind`. `<<choice>>` is a diamond.
- Points: glyph, 2k-1 transverse cells for k ports. Equal heads may share bars/tips; mixed heads keep ports. Exit junctions on glyph row. LR snake: two-column padding. Self-edge: `point-loop`.
- Composites: enter start/first child, exit end/last; no loop. Empty → state. Caption: name/descriptions joined by " - ".
- States: shared ids log `state-shared`; equal groups need `parent`. Quotes open after `state`. Notes/regions/fork/join reject (`GLYPH_MERMAID_STATE_*`).
- Self-edges: 4-cell loops on `e` (TB/BT), `s` (LR/RL). Dagre dummy after node (`labelpos: "c"`) only if needed. Labels wrap at `loopLabelWidth`, one cell past loop. Frames/snake include them.
- Loops start authored-first. Flat LR cycles: spine/top return/feeders below targets; stack side joins by column, reserve clearance, rewrap within caps, merge bottom centres. Side joins exit laterally; margin 0 before Dagre. Validate options; other cycles use Dagre/snake.
- Insets byte-identical except markers/folds/wraps. Shared nested borders before cuts/splits. Wrap after `+/:`; split hyphens beyond width; log `word-cut`.
- Bounded fit: 256 expansion probes/128 gutters/384 routes; shared 2,500,000 work units, no resets/partial probes. Reserve wraps, gaps and a route; reuse routes. Exhaustion keeps fit or edge panels (`render-work-limited`).
- Whole words before cuts; widen tall labels, balance short wraps, try gap 1 for crowded sources. Compact protects ports/routes/loops/frames/moats. Score words/crossings/frames/bends/detours/length; readability probes cannot add crossings, fake frames or dropped edges.
- Chains snake within occupied bands. Fold one TB/BT tail/suffix LR before expansion (no groups/loops/points). Preserve authored LR/RL siblings. Fans share same-style trunks/ports; mixed/parallel/point/frame links keep lanes. Side feeders stay beside targets. Never join buses through one edge.
- Fan captions: exclusive stems/entries; vertical fan-ins shift boxes ≤1, centre ports. Reserve missing captions, then two margin-0 probes.
- `overflow: "paginate"` keeps exact size; `"expand"` grows (`layout-expanded`). Failed fit: decoration → duplicates → leaves → split; fitted decoration survives except optional diamond markers or `simplified`.
- Equal-priority frame entries: nearer first. Paint routes/junctions/fills/heads/labels. Labels clear vertical stems by 1; else touch route/drop (loops: 1 past). Dotted straights: continuous hops.

## Don't

- Don't reuse canvases or hide unroutable edges under fills; log `unroutable`.
- Ports follow sibling order, never lexical. No style-bus merges beyond shared exit stubs; keep loop slots.
- Fit here; no font scaling. Deduplicate first.
- No loop widening. Preserve `;` in quotes, edge-text spans, and after state-transition `:`.
