# Diagrams

No scene/ELK; `</br>` = `<br>`.

## Sequence (`./sequence`)

Validate → columns → rows → paint. `from`/`to`: direction; verbatim `kind`. Mermaid order; JSON: dividers → openings → notes.

- Frames: top captions/dashed dividers; sides `1 + depth` past lifelines. Notes: 3 rows; side notes reserve gaps/frame room. Repeat title; options override.
- Lifeline crossings: 4-way; self: 3-row loops. `canvas.text`, never `canvas.line()`.
- Degrade: cap 3 → abbreviate participants/notes → wrap/log → page by time/repeat headers (`expand` grows). Too wide: `sequence-layout-overflow`.
- Mermaid: preamble/init/menus inert/logged; types → lane + kind, external alias wins; hyphen ids. Create/destroy → full lifelines; half/central arrows → directed solid/dashed, logged. Autonumber start/step. Activations/rect/box inert; side notes/title; par/and, critical/option, break; matched branches. `GLYPH_SEQUENCE_MERMAID_SYNTAX`.

### Don't

- No hardcoded frame kinds or in-group paging.

## Lanes (`./lanes`)

`nodes`: newest first, parents later (`bad-parent-order`). Git-log/Mermaid → validate → rows → cap → paint.

- Row/node: `* [id  ](marks)  label`; git-log ids default on. Merge above, branch below. Web Mermaid spends spare height on ≤2 stem rows/gap; others stay compact.
- `truncated: true` permits absent older parents; open lanes end dashed (`continuation`, `lane-history-continues`).
- `oldest-first` inverts; `continuesFrom` keeps original first-parent lane.
- Label cuts: one `label-abbreviated` summary/render.
- Lane cap: total columns; collapse keeps row/label (`lane-cap-collapsed`). Degrade cap → page (node+connectors) → truncate.

- gitGraph → lanes: tags/types/provenance text; pick parent=head. Ids: stable 7-digit hex; avoid collisions; duplicate authored ids → distinct nodes + id text/log. TB/LR oldest-first, BT newest-first; log LR/config fallback. Lanes: main/unordered/numeric; mainBranchOrder overrides. Scalar name/order/visibility; strip YAML comments. `GLYPH_MERMAID_GIT_SYNTAX`.
- Mindmap: LR tree; uneven dedents/repeats/apostrophes. Bang/cloud/default rounded; hex rect. Icons/classes/config inert; plain markdown/log fallbacks. `GLYPH_MERMAID_MINDMAP_SYNTAX`.

## Class/ER

- `compartment`: rect/header/left `compartments: string[][]`; measure/fit rows, omit empty sections; ports off rules/corners.
- `-` ids; spaced generics/ER backticks; literal typography; namespaces/groups/notes/rows; source-first bracket multiplicity. Config/styles/URLs inert/logged; ER left `o{`/endpoint classes accepted. `GLYPH_MERMAID_{CLASS,ER}_SYNTAX`.
- UML/ER heads semantic; auto-direction; LR caption room once; CJK `label-folded`. Joined UML DAG: 1 clean caption-complete lane probe, else fallback.

## Block/architecture/requirement/C4

- Structured: tolerant; inert directives/assets; named errors. C4: whole words/captions before gutters; width then height; explicit direction wins.
- Block hints: recursive grids; span N = N columns + N−1 gaps; inset 2. Words → fewer columns (`block-row-wrap`) → fitter for crowding/height/>256 (`block-layout`). Empty/spaces: blank/title + `block-empty`; JSON nonempty. Arrows: asymmetric + tag.
- Architecture: icon tags (`database` → `[db]`), junction `+`; first source side guides direction. Ports/alignment/group edges approximate/logged; self-loop → rounded.
- Requirements: compartments/fields/7 relations/plain markdown. C4: person rounded, Db cylinder, Queue rect, Ext marker; stereotypes/boundaries/dynamic order. Index/style/layout/title/assets inert.

## Colour

`string | ((item) => string)`, once/item (`bad-color`). Lanes/participants cycle. `none`: byte-identical; never sole cue.

## Contracts

- Ledger: `{ code, message, detail? }`; inert config: `mermaid-degraded`.
- `unroutable`: final output; non-fitting: `layout-overflow`, never `routing-attempt`. JSON: `GLYPH_DIAGRAM_BAD_JSON`; ELK: `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`.
- Mermaid: `@glyphcss/core/mermaid` preprocessing + grammar scanners. `classDiagram-v2`/`flowchart-elk`: normalise/log layout; bare flow/graph: TB. `mermaidShapes.ts`; inert assets, `mermaid-degraded`. Diamonds: measured/painted, not text/meta; source/graph parity. Clean: keep markers; troubled: drop all if better (`diamond-markers-dropped`), even faithful; keep authored/state glyphs. Heads: `types.ts`; bidirectional: one edge; invisible: layout only. Log fallbacks. Parse once; metadata by link id.
- Styles/interactions/comments inert; classDiagram `class` declares nodes. `label-folded`; blank rows: no text/ledger; loops reserve them. Wrapped labels: `edge-row:` + JSON `[edgeId, rowIndex]`; own ids/colours. Compaction floor: connections, not loops.
- `stateDiagram` → graph IR. Start/end: one glyph `point` per scope/region; `kind` is informational. Choice: diamond.
- Points: k ports need 2k-1 transverse cells. Equal heads share bars/tips; mixed keep ports. Exits on glyph row. LR snake: pad 2; self: `point-loop`. Shift nodes to straighten jogged edges in vertical point chains too.
- Composites: empty → state; concurrent: one frame edge/rank-only peers; others: start/first in, end/last out. Ports clear captions/dividers (≥2); align frame/root units. Self: `state-composite-loop`; sole point → rounded (`state-point-loop`).
- Labelled regions: perpendicular fit; caption room once. Confine routes; drawn borders/dividers block captions and penalize routes.
- States: reused ids → `state-shared`; equal groups: `parent`. Quotes after `state` only. `--`: scoped markers/dividers, no rings; authored regions across flow. Symbols: copies, not JSON. Omit/log empty regions. Notes → rows (composite → first child); fork/join → rounded. Nested direction/styles/config inert. Log fallbacks; bad notes/separators: named errors.
- Self-edges: 4-cell loops: `e` (TB/BT), `s` (LR/RL). Dagre dummy only if needed. Wrap at `loopLabelWidth`, one cell past loop; include in frames/snake.
- Loops authored-first. Flat LR: spine/top return/feeders below targets; stack joins by column, reserve clearance, rewrap, merge bottom centres. Side joins exit laterally; margin 0 before Dagre. Other cycles: Dagre/snake.
- Share borders before cuts/splits; wrap after `+/:`; split hyphens beyond width; log `word-cut`.
- Fit caps: 256 expansions/128 gutters/384 routes; shared 2,500,000 units; charge sparse/nested Dagre; no resets/partial probes. Reuse routes. Exhaustion: fit/panels + captions (`render-work-limited`). Cache ≤32 clean fits; clone, key symbols/options; bypass terminal/limited work. Grow shortest first.
- Whole words; balance tall wraps; crowded sources: gap 1. Compact ports/routes/loops/frames/moats; region gaps ≥2. Score words/crossings/frames/bends/detours/length; probes cannot add crossings/fake frames/dropped edges.
- Snakes: occupied bands, straight turns past loops. Repair after gaps: upper band, loop room, margin 0, reroute. Fold flat TB/BT tails/suffixes LR before expansion (no loops/points); keep LR/RL siblings. Same-style fan trunks/ports; mixed/parallel/point/frame links keep lanes. Marked source heads never share ports. Feeders beside targets; no edge-owned bus.
- Fan captions: own stems/entries; vertical fan-ins shift ≤1, centre ports. Reserve missing captions, then two margin-0 probes. Block/compartment repair: ≤96 probes/3 passes/shared budget; facing ports first; stop at clean, then captions. Block polish reduces bends.
- `overflow: "paginate"` keeps exact size; `"expand"` grows (`layout-expanded`). Failed fit: decoration → duplicates → leaves → split; fitted decoration survives except optional diamond markers or `simplified`.
- Frame-entry nearer first. Paint routes/junctions/fills/heads/labels. Title/caption moat 1; else touch/drop (loops: 1 past). Dotted hops continuous.

## Don't

- Don't reuse canvases or hide unroutable edges under fills; log `unroutable`.
- Ports: sibling order. Buses share exit stubs only; keep loop slots.
- Fit here; no font scaling. Deduplicate first.
- No loop widening. Preserve quoted/edge/state-caption `;`.
