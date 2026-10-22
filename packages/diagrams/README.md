# @glyphcss/diagrams

[Workbench](https://glyphcss.com/diagrams/) · [Docs](https://glyphcss.com/diagrams/) · [Agent skill](https://github.com/apresmoi/glyphcss-diagrams)

Diagrams as pure text for people and agents working in chat, terminals, and web apps, from Mermaid or JSON data.

## Real output

Flowchart · 48 × 7 cells

```text
                                                
                                                
        ┌───────┐  ┌───────┐  ┌────────┐        
        │ Input │──▶ Parse │──▶ Render │        
        └───────┘  └───────┘  └────────┘        
                                                
                                                
```

Sequence · 40 × 8 cells

```text
    Client                       API    
       │                          │     
       │ GET /data                │     
       ├─────────────────────────▶│     
       │                          │     
       │ 200 OK                   │     
       │◀╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌┤     
       │                          │     
```

ER with crow's feet · 48 × 9 cells

```text
                                                
                                                
                                                
           ┌──────┐ places ┌───────┐            
           │ USER ┼┼──────○> ORDER │            
           └──────┘        └───────┘            
                                                
                                                
                                                
```

Git history · 48 × 8 cells

```text
                                                
            *   Start                           
            ├─╮                                 
            │ * Work  (feature)                 
            * │ Docs                            
            ├─╯                                 
            *   Ship  (main, merge)             
                                                
```

## Install

```sh
npm install @glyphcss/diagrams
```

## CLI

The `glyphcss` command comes from `@glyphcss/compile`.

```sh
npm install -g @glyphcss/compile
printf '%s\n' 'flowchart LR; A[Input] --> B[Parse] --> C[Render]' > flow.mmd
glyphcss diagram flow.mmd --target chat --width 48 --height 7
```

Mermaid chart headers also dispatch through `glyphcss diagram`. Use `--color css -o diagram.html` for an HTML export. Adaptation notes are printed on stderr.

## Quick start

TypeScript with JSON-shaped graph data: render the flowchart above.

```ts
import { renderGlyphDiagram } from "@glyphcss/diagrams";

const result = await renderGlyphDiagram({
  direction: "LR",
  nodes: [{ id: "input", label: "Input" }, { id: "parse", label: "Parse" }, { id: "render", label: "Render" }],
  edges: [{ from: "input", to: "parse" }, { from: "parse", to: "render" }],
}, { target: "chat", width: 48, height: 7 });
console.log(result.text);
```

```text
                                                
                                                
        ┌───────┐  ┌───────┐  ┌────────┐        
        │ Input │──▶ Parse │──▶ Render │        
        └───────┘  └───────┘  └────────┘        
                                                
                                                
```

Mermaid: render the sequence above using the sequence subpath.

```ts
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";

const result = await renderGlyphSequence(`sequenceDiagram
  Client->>API: GET /data
  API-->>Client: 200 OK`, { target: "chat", width: 40, height: 8 });
console.log(result.text);
```

```text
    Client                       API    
       │                          │     
       │ GET /data                │     
       ├─────────────────────────▶│     
       │                          │     
       │ 200 OK                   │     
       │◀╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌ ╌┤     
       │                          │     
```

## What it draws

| Input | Vocabulary / entry |
| --- | --- |
| Mermaid graphs | `flowchart` / `graph`, `stateDiagram`, `classDiagram`, `erDiagram`, `mindmap`, `gitGraph`, `block`, `architecture`, `requirementDiagram` → root renderer |
| Mermaid C4 | `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment` → root renderer |
| Mermaid sequences | `sequenceDiagram` → `./sequence` |
| JSON graph | Nodes, edges, groups, direction → root renderer |
| JSON sequence | Participants, messages, frames, notes → `./sequence` |
| JSON lane DAG / git log | Newest-first nodes with older parents, or git-log text → `./lanes` |

Node shapes include rectangles, rounded boxes, diamonds, circles, cylinders, clouds, bangs and hexagons, plus 38 Mermaid catalogue shapes such as `doc`, `tri`, `datastore` and `person`. Set them with JSON `shape` or Mermaid `A@{shape: doc}`.

## Targets and sizes

| Target | Default cells (columns × rows) | Charset | Color |
| --- | --- | --- | --- |
| `chat` | 72 × 24 | `box` | `none` |
| `terminal` | 80 × 24 | `braille` | `truecolor` |
| `web` (default) | 96 × 32 | `braille` | `css` |

Set `width` and `height` to positive integer cell budgets; choose `ascii`, `box`, `blocks`, or `braille` (diagram borders remain whole-cell).
`overflow: "paginate"` (default) splits into panels; `"expand"` allows a larger canvas. All panels are in `pages`; `text` joins their output.
`color: "none"` gives plain text; ANSI modes encode `text`, while `css` supplies `html`.
Render results include `report.ledger` describing any adaptation.

## API at a glance

| Entry point | Use |
| --- | --- |
| `renderGlyphDiagram(input, options?)` | Mermaid graph source or `GlyphGraph` → Promise of text, optional HTML, metadata, report, pages. |
| `renderGlyphDiagramJson(json, options?)` | JSON string → Promise of JSON output or a tagged error. |
| `glyphGraphFromMermaid` / `glyphGraphFromJson` | Adapt source or a graph object into `GlyphGraph`. |
| `renderGlyphSequence` / `renderGlyphSequenceJson` | `./sequence`: Mermaid or sequence data; JSON-string wrapper. Both asynchronous. |
| `renderGlyphLaneDag` / `renderGlyphLaneDagJson` | `./lanes`: lane data or git-log text; JSON-string wrapper. Both asynchronous. |
| `glyphSequenceFromMermaid` / `glyphLaneDagFromGitLog` | Source adapters on their respective subpaths. |
| `validateGlyphGraph` / `glyphDiagramJsonSchema` | Validate a graph or generate its JSON Schema. |
| Shared render options | `target`, `charset`, `color`, `width`, `height`, `title`, `overflow`. |
| Graph options | `direction` (`TB`, `LR`, `BT`, `RL`), `autoDirection`, `detail`, `labelWidth`. |
| Lane options | `order` (`newest-first` / `oldest-first`), `ids`. |

Full options: [graph types](https://github.com/apresmoi/glyphcss/blob/main/packages/diagrams/src/renderTypes.ts), [layout types](https://github.com/apresmoi/glyphcss/blob/main/packages/diagrams/src/pipeline.ts).
[Sequence options](https://github.com/apresmoi/glyphcss/blob/main/packages/diagrams/src/sequence/render.ts) · [Lane options](https://github.com/apresmoi/glyphcss/blob/main/packages/diagrams/src/lanes/render.ts).
Other helpers and exported types: [root exports](https://github.com/apresmoi/glyphcss/blob/main/packages/diagrams/src/index.ts).

## Links

- [Diagrams workbench](https://glyphcss.com/diagrams)
- [Agent skill](https://github.com/apresmoi/glyphcss-diagrams)
- [Main glyphcss package](https://www.npmjs.com/package/glyphcss)
- [Contributor contracts: AGENTS.md](https://github.com/apresmoi/glyphcss/blob/main/packages/diagrams/AGENTS.md)
