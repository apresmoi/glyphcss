# @glyphcss/diagrams — agent guide

No scene/elkjs.


## Sequence (`./sequence`)

Validate → columns → rows → paint. `from`/`to`: direction; verbatim `kind`. Mermaid order; JSON: dividers → openings → notes.

### Contracts

- Frames: top captions, dashed dividers, sides `1 + depth` past lifelines. Notes: 3 rows; side notes reserve gaps/frame room beside one lane. Repeat title; options override.
- Lifeline crossings: 4-way; self: 3-row loops. `canvas.text`, never `canvas.line()`.
- Degrade: cap to 3 → abbreviate participants/side notes → wrap messages/log → page by time with repeated headers (`expand` grows). Too wide: `sequence-layout-overflow`.
- Mermaid: activations inert; side notes, autonumber, title; cross/open → solid/dashed. par/and, critical/option, break frames; branches require matching frames. rect inert; box declarations only. `GLYPH_SEQUENCE_MERMAID_SYNTAX`.

### Don't

- No hardcoded frame kinds or paging inside row-groups.

## Lanes (`./lanes`)

`nodes`: newest first; parents later (`bad-parent-order`). Git-log/Mermaid → validate → rows → cap → paint.

### Contracts

- One row/node: `* [id  ](marks)  label` (git-log ids default on). Merge connectors above, branch below; no spacers.
- `truncated: true` permits absent older parents; open lanes end dashed (`continuation`, `lane-history-continues`).
- `oldest-first` inverts; `continuesFrom` keeps original first-parent lane.
- Label cuts: one `label-abbreviated` summary/render.
- Lane cap: total columns; collapse keeps row/label (`lane-cap-collapsed`). Degrade cap → page (node+connectors) → truncate.

- gitGraph → lanes: tags/types/provenance text; pick parent = current head. TB/LR oldest-first, BT newest-first; log LR/config fallback. Lanes: main/unordered/numeric; mainBranchOrder overrides. Scalar name/order/visibility; strip YAML comments. `GLYPH_MERMAID_GIT_SYNTAX`.
- Mindmap → LR undirected tree: indent stack/uneven dedents/distinct repeats; literal apostrophes. Families: bang/cloud/default rounded; hex rect. Icons/classes/config inert; markdown plain; log fallbacks. `GLYPH_MERMAID_MINDMAP_SYNTAX`.

## Class/ER

- `compartment`: rect/header/left `compartments: string[][]`; no other shape accepts members. Measure/fit includes rows; omit empty sections. Ports avoid rules/corners.
- `-` ids; spaced generics/ER backtick attributes. Literal typography; namespaces/groups, notes/rows, multiplicity/bracket captions (source first). Config/styles/URLs inert; log fallbacks. `GLYPH_MERMAID_{CLASS,ER}_SYNTAX`.
- Heads: UML markers; ER: border + escape. Preserve semantics; auto-direction/caption-safe LR room once; CJK: `label-folded`.

## Block, architecture, requirement and C4

- Structured: tolerant; inert assets/directives; named errors.
- Block hints: objects only. Recursive grids; span N = N columns + N−1 gaps; frame inset: 2 cells. Words → fewer columns (`block-row-wrap`) → fitter for crowding/height/>256 (`block-layout`). Empty/spaces → blank/title + `block-empty`; JSON nonempty. Arrows: asymmetric + tag.
- Architecture: icon tags (`database` → `[db]`), junction `+`. First source side guides direction; ports/alignment/group edges approximate, logged. Self-loop → rounded.
- Requirements: compartments/fields/seven labelled relations; plain markdown. C4: person rounded, Db cylinder, Queue rect, Ext marker; stereotypes. Boundaries: groups. Dynamic: relation order. Index/style/layout/title/assets inert. Adaptive direction preserves captions unless overridden; missing captions try perpendicular fit.

## Colour

`string | ((item) => string)`, once/item (`color.ts`, `bad-color`). Lanes/participants cycle. `color: "none"` byte-identical; never sole cue.

## Contracts

- Ledger: `{ code, message, detail? }`; inert config: `mermaid-degraded`.
- `unroutable`: final output; non-fitting: `layout-overflow`, never `routing-attempt`. JSON: `GLYPH_DIAGRAM_BAD_JSON`; ELK: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid: shared `@glyphcss/core/mermaid` preamble/entities/comment spans; grammar-specific scanners. `classDiagram-v2`/`flowchart-elk` normalise/log native layout; bare flow/graph: TB. Approved families (`mermaidShapes.ts`), inert assets, `mermaid-degraded`. Diamond markers: measured/painted, never text/meta; same source/graph selection. Clean fits keep markers; troubled fits drop all if better (`diamond-markers-dropped`), even faithful; keep authored/state glyphs. Heads: `types.ts`; bidirectional: one edge; invisible: layout only. Log syntax fallbacks. Parse once; link ids own metadata.
- Styles/interactions/comments inert; classDiagram `class` declares nodes. Folding logs `label-folded`; blank rows have no text/ledger. Loops reserve blank rows too. Wrapped labels: `edge-row:` + JSON `[edgeId, rowIndex]`; distinct ids/edge colour. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR. Start/end: one glyph `point` per scope/region; `kind` is informational. Choice: diamond.
- Points: glyph, 2k-1 transverse cells for k ports. Equal heads may share bars/tips; mixed heads keep ports. Exit junctions on glyph row. LR snake: two-column padding. Self-edge: `point-loop`.
- Composites: empty → state; concurrent: one frame edge/rank-only peers; others: start/first in, end/last out. Ports clear captions/dividers (≥2); align frame/root units. Self: `state-composite-loop`; sole point → rounded (`state-point-loop`).
- Labelled regions: default perpendicular fit; caption room once. Confine region routes; only drawn borders/dividers block captions and penalize routes.
- States: reused ids → `state-shared`; equal groups: `parent`. Quotes only after `state`. `--`: scoped markers/dividers, no rings; authored regions across flow. Symbols survive copies, not JSON. Omit/log empty regions. Notes → description rows (composite → first child); fork/join → rounded labels; nested direction/styles/config inert. Log fallbacks; bad notes/separators: named errors.
- Self-edges: 4-cell loops on `e` (TB/BT), `s` (LR/RL). Dagre dummy after node only if needed. Labels wrap at `loopLabelWidth`, one cell past loop. Frames/snake include them.
- Loops start authored-first. Flat LR: spine/top return/feeders below targets; stack joins by column, reserve clearance, rewrap, merge bottom centres. Side joins exit laterally; margin 0 before Dagre. Validate options; other cycles: Dagre/snake.
- Share borders before cuts/splits; wrap after `+/:`; split hyphens beyond width; log `word-cut`.
- Fit caps: 256 expansions/128 gutters/384 routes; shared 2,500,000 units, no resets/partial probes. Reserve wraps/gaps/route; reuse routes. Exhaustion: fit or edge panels (`render-work-limited`).
- Words before cuts; widen tall labels, balance wraps, try gap 1 for crowded sources. Compact: ports/routes/loops/frames/moats; region flow gaps ≥2. Score words/crossings/frames/bends/detours/length; probes cannot add crossings/fake frames/dropped edges.
- Chains snake within occupied bands. Fold one TB/BT tail/suffix LR before expansion (flat, no loops/points). Preserve authored LR/RL siblings. Fans share same-style trunks/ports; mixed/parallel/point/frame links keep lanes. Side feeders stay beside targets. Never join buses through one edge.
- Fan captions: exclusive stems/entries; vertical fan-ins shift boxes ≤1, centre ports. Reserve missing captions, then two margin-0 probes.
- `overflow: "paginate"` keeps exact size; `"expand"` grows (`layout-expanded`). Failed fit: decoration → duplicates → leaves → split; fitted decoration survives except optional diamond markers or `simplified`.
- Frame entries at equal priority: nearer first. Paint routes/junctions/fills/heads/labels. Labels clear vertical stems by 1; else touch/drop (loops: 1 past). Dotted hops stay continuous.

## Don't

- Don't reuse canvases or hide unroutable edges under fills; log `unroutable`.
- Ports: sibling order, not lexical. Style buses share exit stubs only; keep loop slots.
- Fit here; no font scaling. Deduplicate first.
- No loop widening. Preserve quoted/edge-text/state-caption `;`.
