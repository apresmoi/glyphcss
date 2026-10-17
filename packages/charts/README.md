# @glyphcss/charts

Charts as pure text for people and agents working in chat, terminals, and web apps, from data or Mermaid source.

## Real output

Braille trend · 40 × 8 cells

```text
  │                              ⡠⡀     
  │                  ⡠⣀        ⡠⠊ ⠘⢄    
  │                 ⡰⠁ ⠑⠢⣀   ⡠⠊     ⠣⡀  
5 ┤     ⢀⡠⡀        ⡜      ⠑⠢⠊        ⠘⢄ 
  │  ⢀⡠⠒⠁ ⠈⠢⡀    ⢀⠎                    ⠣
  │⠠⠒⠁      ⠈⠢⡀ ⢠⠊                      
  └┬──────────⠈⠢⠃──────────┬───────────┬
   0           2           4           6
```

Bars · 40 × 8 cells

```text
 Ship ┤ ████████                        
      │                                 
 Test ┤ ████████████████████            
      │                                 
Build ┤ ████████████████████████████████
      └┬───────┬───────┬───────┬───────┬
       0       2       4       6       8
                                        
```

Donut · 48 × 10 cells

```text
                                                
    Tests · 15%─────▚▚▚▚████                    
                  ▚▚▚▚▚▚██████                  
                 ░░░▚      ████                 
                ░░░░        ████                
 Docs · 25%─────░░░░        ████                
                 ░░░░      ████─────Code · 60%  
                  ░░██████████                  
                    ████████                    
                                                
```

Sankey · 50 × 16 cells

```text
        █─╮          ╭─█─╮         ╭─█            
        █─┤          ├─█─┤         ├─█            
Coal 40 █─┼━━━ 40 ━━━┼─█─┤         ├─█            
        █─┤          ├─█─┤         ├─█            
        █─┤          ╰─█─┼━━ 70 ━━━┼─█ Homes 70   
        █─╯            █─┤         ├─█            
                     ╭─█─┤         ├─█            
                     ├─█─┤         ├─█            
        █─╮          ├─█─╯         ├─█            
        █─┤        ┏━┼─█           ╰─█            
        █─┤        ┃ ├─█─╮                        
 Gas 60 █─┼━━ 60 ━━┛ ├─█─┼─ 30 ──╮                
        █─┤          ├─█─┤       │ ╭─█            
        █─┤          ╰─█─╯       ╰─┼─█ Industry 30
        █─┤        Power 100       ├─█            
        █─╯                        ╰─█            
```

## Install

```sh
npm install @glyphcss/charts
```

## Quick start

TypeScript: render the braille trend above.

```ts
import { glyphChartLine, renderGlyphChart } from "@glyphcss/charts";

const result = renderGlyphChart(glyphChartLine([3, 5, 2, 8, 6, 9, 4]), {
  target: "chat", charset: "braille", width: 40, height: 8,
});
console.log(result.text);
```

```text
  │                              ⡠⡀     
  │                  ⡠⣀        ⡠⠊ ⠘⢄    
  │                 ⡰⠁ ⠑⠢⣀   ⡠⠊     ⠣⡀  
5 ┤     ⢀⡠⡀        ⡜      ⠑⠢⠊        ⠘⢄ 
  │  ⢀⡠⠒⠁ ⠈⠢⡀    ⢀⠎                    ⠣
  │⠠⠒⠁      ⠈⠢⡀ ⢠⠊                      
  └┬──────────⠈⠢⠃──────────┬───────────┬
   0           2           4           6
```

Mermaid: render the bars above.

```ts
import { renderGlyphChartMermaid } from "@glyphcss/charts";

const result = renderGlyphChartMermaid(`xychart horizontal
  x-axis [Build, Test, Ship]
  y-axis 0 --> 8
  bar [8, 5, 2]`, { target: "chat", width: 40, height: 8 });
console.log(result.text);
```

```text
 Ship ┤ ████████                        
      │                                 
 Test ┤ ████████████████████            
      │                                 
Build ┤ ████████████████████████████████
      └┬───────┬───────┬───────┬───────┬
       0       2       4       6       8
                                        
```

## What it draws

| Input | Vocabulary |
| --- | --- |
| Marks | `line`, `area`, `bar`, `dot`, `arc` (pie/donut), `cell` (heatmap), `text`, `rule`, `sankey`, `funnel`, `treemap` |
| Mermaid | `pie`, `xychart`, `sankey`, `quadrantChart`, `gantt`, `radar`, `treemap`, `journey`, `timeline`, `packet`, `kanban` |
| `@glyphcss/charts/3d` | Surface, scatter, parametric surface, bars, and line marks; scene objects and static renders. |

## Targets and sizes

| Target | Default cells (columns × rows) | Charset | Color |
| --- | --- | --- | --- |
| `chat` | 72 × 24 | `box` | `none` |
| `terminal` | 80 × 24 | `braille` | `truecolor` |
| `web` (default) | 96 × 32 | `braille` | `css` |

Override `width` and `height` with positive integer cell budgets; some Mermaid layouts fit content height when `height` is omitted.
Choose `ascii`, `box`, `blocks`, or `braille`; chat fonts may need `box` or `ascii`.
`color: "none"` gives plain text; ANSI modes encode `text`, while `css` supplies `html`.
Render results include `report.ledger` describing any adaptation.

## API at a glance

| Entry point | Use |
| --- | --- |
| `renderGlyphChart(input, options?)` | Mark, mark array, number array, or spec → text, optional HTML, build, metadata, report. |
| `renderGlyphChartJson(json, options?)` | JSON string → JSON string containing output or a tagged error. |
| `renderGlyphChartMermaid(source, options?)` | Mermaid → render result with source-adaptation notes. |
| `glyphChartFromMermaid(source)` | Mermaid → chart spec with source ledger. |
| `glyphChartPlot(options)` | Compose marks with shared `scales`, `axes`, `title`, and `legend`. |
| `glyphChartLine`, `glyphChartBar`, etc. | Construct native marks from data and options. |
| `buildGlyphChart` / `encodeGlyphChart` | Build the cell canvas, then encode `"text"` or `"html"`. |
| `validateGlyphChartSpec` / `glyphChartJsonSchema` | Validate a spec or generate its JSON Schema. |
| Common render options | `target`, `charset`, `color`, `width`, `height`, `detail`, `legend`. |
| Common spec options | `title`, `axes.x/y` (titles, ticks, format, grid), `scales.x/y` (type, domain). |

Full options: [TypeScript types](https://github.com/apresmoi/glyphcss/blob/main/packages/charts/src/types.ts).
Other helpers and exported types: [root exports](https://github.com/apresmoi/glyphcss/blob/main/packages/charts/src/index.ts), [3D exports](https://github.com/apresmoi/glyphcss/blob/main/packages/charts/src/3d/index.ts).

## Links

- [Charts workbench](https://glyphcss.com/charts)
- [Agent skill](https://github.com/apresmoi/glyphcss-diagrams)
- [Main glyphcss package](https://www.npmjs.com/package/glyphcss)
- [Contributor contracts: AGENTS.md](https://github.com/apresmoi/glyphcss/blob/main/packages/charts/AGENTS.md)
