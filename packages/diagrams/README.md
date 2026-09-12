# @glyphcss/diagrams

Mermaid flowcharts and JSON graphs rendered into text cells for chat, terminals, and HTML. Layout and rendering are asynchronous. The pipeline uses the public glyphcss cell canvas, with no camera, scene, or DOM renderer.

> Layout and the examples below use the installed `@dagrejs/dagre@3.1.1`. `fixtures/langgraph-export.mmd` is the real, unmodified `draw_mermaid()` export byte-for-byte (including its `&nbsp;`-padded conditional edge text); `fixtures/langgraph.mmd` is a variant that makes agent→tools solid and keeps a labelled dotted edge to `__end__`.

```ts
import { renderGlyphDiagram } from "@glyphcss/diagrams";

const diagram = await renderGlyphDiagram(`flowchart LR
  request[Request] --> agent[Agent] --> answer[Answer]
`, { target: "chat", charset: "box", width: 80, height: 20 });
console.log(diagram.text);
console.log(diagram.report.ledger);
```

`renderGlyphDiagram` accepts Mermaid source or a `GlyphGraph`. `glyphGraphFromJson` accepts an object with `nodes` and `edges`, defaulting `direction` to `TB`. `renderGlyphDiagramJson` accepts JSON text and returns a Promise of JSON text: `{ text, html?, meta, report }` on success or `{ error, code, hint }` on failure.

```ts
import { glyphGraphFromJson, renderGlyphDiagramJson } from "@glyphcss/diagrams";

const graph = glyphGraphFromJson({
  nodes: [{ id: "start", label: "Start" }, { id: "work", label: "Work", shape: "rounded" }],
  edges: [{ id: "run", from: "start", to: "work", label: "run", priority: 2 }],
  direction: "LR",
});
const encoded = await renderGlyphDiagramJson(JSON.stringify(graph), { target: "terminal" });
```

## Graph and source vocabulary

- Nodes: `{ id, label, kind?, group?, shape? }`. Shapes: `rect`, `rounded`, `diamond`, `circle`, `subroutine`, `asymmetric`, `stadium`; all reserve rectangular footprints, with cell-sized border distinctions.
- Edges: `{ id?, from, to, label?, style?, priority? }`. Styles: `solid`, `dotted`, `thick`, `undirected`. Larger priority routes first and wins an unavoidable crossing.
- Groups: `{ id, label?, members: string[] }[]`. Nested/disjoint membership uses compound dagre layout. Overlapping memberships use explicit member-list annotations when an enclosure would claim unrelated nodes.
- Directions: `TB`, `LR`, `BT`, `RL`; Mermaid `TD` normalizes to `TB`.
- Mermaid: `flowchart`/`graph`, `[ ]`, `( )`, `{ }`, `(( ))`, `[[ ]]`, `>( ]`, `([ ])`; `-->`, `---`, `-.->`, `==>`, `-- text -->`, `-->|text|`, `-. text .->`, chained edges, `&` fan-out, and `subgraph ... end`.
- `classDef`, `class`, `style`, `click`, `linkStyle`, and `%%` comments remain inert source directives, parsed as data and never executed. URLs/callbacks are never followed. LangGraph paragraph wrappers (`<p>…</p>`) are stripped and HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#NN;`, `&#xHH;`, `&nbsp;`) are decoded once in labels; `&nbsp;` becomes a plain space, trimmed at label ends. A quoted label, a `|label|` edge label, and a `-. text .->` edge-text span are all protected from statement-splitting, so an entity's own `;` can't truncate a statement early.
- Other diagram kinds reject by name, e.g. `GLYPH_MERMAID_UNSUPPORTED_SEQUENCEDIAGRAM`, `GLYPH_MERMAID_UNSUPPORTED_STATEDIAGRAM`, and `GLYPH_MERMAID_UNSUPPORTED_C4CONTEXT`.

## Output options

| Option | Values / default |
| --- | --- |
| `target` | `chat` (default), `terminal`, `web` |
| `charset` | `ascii`, `box`, `blocks`, `braille` |
| `color` | `none`, `ansi16`, `ansi256`, `truecolor`, `css` |
| `width`, `height` | Positive integer cells, per panel |
| `detail` | `auto`, `faithful`, `balanced`, `simplified` |
| `direction` | Optional graph direction override |
| `engine` | `dagre` only |
| `nodesep`, `ranksep` | Integer cells ≥ 3, default 4 / 4 |
| `title` | Optional label placed against the same obstacles as edge labels |
| `env` | Explicit `NO_COLOR` / `FORCE_COLOR` values; process environment is never read implicitly |

Target defaults match charts: chat = 72×24 box / no color; terminal = 80×24 braille / truecolor; web = 96×32 braille / CSS. Explicit options override target defaults. `ascii` constrains authored labels and diagram glyphs to 7-bit output. Non-ASCII tiers share the canvas's line vocabulary.

`text` is plain for `none`/`css`, and SGR encoded for ANSI color modes. `html` is present for `css` and escapes labels itself. Each result includes `grid`, `layout`, `routes`, `labels`, `meta`, `report`, and `pages`. `meta` preserves the original graph. `pages` contains every split panel; top-level `text`/`html` concatenate them with a blank line, while top-level `grid`/`layout`/`routes` describe the first panel.

## Cell budgets and fidelity

More than 9 nodes or 12 edges, an oversized layout, or an unroutable edge invokes the ordered ladder: drop decoration, merge duplicate connections, collapse sibling leaves, then split into edge-induced panels. Each change names what it did in the ledger; original nodes/edges/groups remain in `meta`. Boundary nodes repeat across panels so connections remain inspectable. `faithful` retains decoration, duplicates, and leaf identities and proceeds to splitting. `simplified` drops decoration immediately; `auto` and `balanced` use the same Phase 2 budget.

A panel that cannot fit even its endpoint boxes stays blank, reports the affected ids, and draws no clipped node or transit. `report.unroutable` describes final output only. Failed intermediate attempts are identified separately in the ledger. Edge labels can be abbreviated or dropped when no disjoint text rectangle fits.

## Staged API

```ts
import {
  glyphGraphFromMermaid, measureGlyphGraph, reserveGlyphGraphPorts,
  layoutGlyphGraph, routeGlyphGraphEdges, paintGlyphDiagram,
} from "@glyphcss/diagrams";

const graph = glyphGraphFromMermaid("graph LR; A --> B");
const measured = measureGlyphGraph(graph);
const reserved = reserveGlyphGraphPorts(measured);
const layout = await layoutGlyphGraph(reserved, { engine: "dagre", nodesep: 4, ranksep: 4 });
const routing = routeGlyphGraphEdges(layout, { width: 80, height: 24 });
const output = paintGlyphDiagram(layout, routing, { width: 80, height: 24, charset: "box", color: "none" });
```

Port reservation enlarges node sides before layout to at least `2N + 1` cells for `N` ports. A* uses unit steps, bend cost 4, crossing cost 12, node clearance, and reserved escape lanes. Routes contain every 4-adjacent cell; never replace them with a bend-only point list. Reserved slots follow Dagre’s actual endpoint order without changing node sizes or separation. Every paint call creates a fresh canvas and applies routes → junction resolution → node borders → target-border arrowheads → labels. Edge labels stay adjacent to their own route or are reported as dropped.

## Validation and optional ELK boundary

`GLYPH_DIAGRAM_VALIDATION_RULES` names errors; `glyphDiagramRepairHint(code)` describes repairs. `glyphDiagramJsonSchema()` includes structural constraints and a `glyphGraphIntegrity` keyword for graph relationships. Plain JSON Schema cannot compare an edge id reference against the node-id set. For full parity, register the supplied keyword definitions with Ajv:

```ts
import Ajv2020 from "ajv/dist/2020.js";
import { glyphDiagramJsonSchema, GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS } from "@glyphcss/diagrams";

const ajv = new Ajv2020({ strict: false });
for (const keyword of GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS) ajv.addKeyword(keyword);
const validate = ajv.compile(glyphDiagramJsonSchema());
```

`@glyphcss/diagrams/elk` reserves the later adapter. `layoutGlyphGraphElk()` currently rejects with `GLYPH_DIAGRAM_ELK_NOT_INSTALLED`; neither the root entry nor the workbench imports elkjs. Passing `engine: "elk"` to `layoutGlyphGraph`/`renderGlyphDiagram` directly rejects with the same code at the engine-selection boundary, not a generic `bad-options`. `renderGlyphDiagramJson` and the CLI's `.json` input path both tag malformed JSON as `GLYPH_DIAGRAM_BAD_JSON` (via `parseGlyphDiagramJson`), never a bare native `SyntaxError` with no `code`.

## CLI and workbench

`glyphcss diagram graph.mmd --target chat --charset ascii --width 80 --height 24` and `glyphcss diagram graph.json` use the same renderer. ANSI is the terminal default; piped output is plain unless explicitly overridden. Fidelity notes go to stderr. `/diagrams` uses the shared instrument shell with source tabs, output/layout/diagram controls, seven presets, copy/SVG export, ledger, and TS/Mermaid/JSON examples.

## Rendered examples

The fixture outputs below omit surrounding blank rows and trailing padding for readability. Full byte snapshots retain the complete viewport.

chain.box:

```text
                      ┌───────┐    ┌───────┐    ┌────────┐
                      │ Input │────▶ Parse │────▶ Render │
                      └───────┘    └───────┘    └────────┘
```

diamond.ascii:

```text
                                   +---------+
                                   | Request |
                                   +---------+
                                        |
                                        |
                                       ++
                                       |
                                   /---v----\
                                   | Ready? |
                                   \--------/
                                      | |
                                 yes  | |  no
                             +--------+ +--------+
                             |                   |
                          +--v---+            +--v---+
                          | Work |            | Wait |
                          +------+            +------+
                             |                   |
                             |                   |
                             +--------+ +--------+
                                      | |
                                    +-v-v--+
                                    | Done |
                                    +------+
```

langgraph.chat60x20:

```text
                  (───────────)
                  │ __start__ │
                  (───────────)
                        │
                        └┐
        ┌──────────────┐ │
        │              │ │
        │           (──▼─▼──)
        │           │ agent │
        │           (───────)
        │              │ │
        │              │       __end__
        │     ┌────────┘ └ · · · · · · · · ·┐
        │     │                             │
        │ (───▼───)                    (────▼────)
        │ │ tools │                    │ __end__ │
        │ (───────)                    (─────────)
        │     │
        └─────┘
```

langgraph-export.chat60x20 — the real, byte-for-byte `draw_mermaid()` export, rendered directly (no edits):

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
graph TD;
	__start__([<p>__start__</p>]):::first
	agent(agent)
	tools(tools)
	__end__([<p>__end__</p>]):::last
	__start__ --> agent;
	agent -.-> __end__;
	agent -. &nbsp;continue&nbsp; .-> tools;
	tools --> agent;
	classDef default fill:#f2f0ff,line-height:1.2
	classDef first fill-opacity:0
	classDef last fill:#bfb6fc
```

```text
                  (───────────)
                  │ __start__ │
                  (───────────)
                        │
                        └┐
        ┌──────────────┐ │
        │              │ │
        │           (──▼─▼──)
        │           │ agent │
        │           (───────)
        │              │ │
        │      continue
        │     ┌· · · · ┘ └ · · · · · · · · ·┐
        │     │                             │
        │ (───▼───)                    (────▼────)
        │ │ tools │                    │ __end__ │
        │ (───────)                    (─────────)
        │     │
        └─────┘
```
