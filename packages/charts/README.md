# @glyphcss/charts

A declarative, [Observable Plot](https://observablehq.com/plot/)-flavoured chart spec rendered as ASCII/box/braille output for chat, terminal, and web — built on [`glyphcss`](https://www.npmjs.com/package/glyphcss)'s cell canvas. No camera, no mesh, no DOM required to render: `renderGlyphChart` is a pure function from a spec to a string.

Contributor contracts live in `packages/charts/AGENTS.md` in the [glyphcss repo](https://github.com/apresmoi/glyphcss).

## Install

```sh
npm install @glyphcss/charts
```

## Quick start

```ts
import { renderGlyphChart, glyphChartLine } from "@glyphcss/charts";

const { text } = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", width: 40, height: 12 });
console.log(text);
```

```
8 ┤                                   //
  │                                  // 
  │                                 //  
6 ┤                                //   
  │                               //    
  │          -▔\\               ///     
  │      -▔‾_-  \\\\           //       
4 ┤  -▔‾_-         \\\        //        
  │__-               \\\     //         
  │                    \\\\ //          
2 └┬───────────┬──────────\//──────────┬
   0           1           2           3
```

A bare `number[]` infers `x = index, y = identity` — the same shorthand `Plot.lineY([3,5,2,8])` uses. `renderGlyphChart` also accepts a lone mark, an array of marks, or a full `glyphChartPlot({ marks, title?, description? })` spec.

## Marks

Every constructor returns a plain `GlyphChartMark` value: `glyphChartLine(data, channels?, options?)`, `glyphChartArea`, `glyphChartBar`, `glyphChartDot`, `glyphChartArc`, `glyphChartCell`, `glyphChartText`, `glyphChartTreemap`, `glyphChartRule(values, { axis? })`. `channels` maps `x`/`y`/`fill`/`stroke`/`label` to a field name, an accessor `(datum, index) => value`, or a literal array running parallel to `data`. Channel type inference copies Plot: a `Date` value infers `time`, a `string` infers `band` (ordinal) — unless every string in the channel is itself a calendar-valid ISO date, which infers `time` instead — a `number` infers `linear`. Every constructor also accepts `options.name?: string` — a series name shown in the legend, independent of any categorical `fill`/`stroke` split (see "Legends"). `line`, `rule`, and an `area`'s own boundary line accept `options.strokeWidth?: 1 | 2 | 3` (default `1`) — `ascii`/`box` widen by substituting a heavier glyph on the same cells; `blocks`/`braille` widen with real sub-cell dot ink. Two more constructors are non-cartesian, like `arc`: `glyphChartSankey(data, { source, target, value, name?, color? })` and `glyphChartFunnel(data, { stage?, value?, name?, color? })`.

### `glyphChartLine`

```ts
renderGlyphChart(glyphChartLine([3, 5, 2, 8, 6, 9, 4]), { target: "chat", width: 40, height: 12 });
```
```
  │                             /\      
8 ┤                  \\        //\\     
  │                 //\\\    ///  \\    
  │                //   \\\ //     \\   
6 ┤                /      \//       \\  
  │               //                 \\ 
  │     /\\      //                   \\
4 ┤   /// \\     /                     \
  │ ///    \\\  //                      
  │//        \\//                       
2 └┬──────────\/───────────┬───────────┬
   0           2           4           6
```

### `glyphChartArea`

```ts
renderGlyphChart(glyphChartArea([3, 5, 2, 8, 6, 9, 4]), { target: "chat", width: 40, height: 12 });
```
```
  │                              █      
8 ┤                  ██        ████     
  │                 ██████   ███████    
6 ┤                ██████████████████   
  │      █         ███████████████████  
  │    █████      █████████████████████ 
4 ┤  ████████    ███████████████████████
  │████████████ ████████████████████████
2 ┤█████████████████████████████████████
  │█████████████████████████████████████
0 └┬───────────┬───────────┬───────────┬
   0           2           4           6
```

### `glyphChartBar`

Bar heights are proportional to values, measured from the axis LINE — which sits on the y=0 row itself (an interior row for a mixed-sign domain, the plot's own bottom row otherwise), so a bar always touches it, never floating a row above a separately-drawn line. Zero paints nothing; both signs exclude the baseline. A positive, unstacked `█` bar ends in a lower eighth block (`▁`–`▇`) for its last fraction of a row, so values whole cells would round together stay distinct; shaded series, `ascii`, negative bars and stack segments keep whole cells. Each bar series is at most 3 cells wide (times `textScale`), centred on its tick; dodged series sit side by side, 3 cells each. Bar and area inferred y-domains include zero; an explicit domain excluding zero rejects with `bar-domain-excludes-zero`. Stacked bars/areas paint the transform’s `y0`→`y1` bounds.

```ts
renderGlyphChart(glyphChartBar([3, -5, 2, 8]), { target: "chat", width: 40, height: 14 });
```
```
   │                                  ██
   │                                  ██
   │                                  ██
 5 ┤                                  ██
   │▃▃                                ██
   │██                    ▄▄▄         ██
   │██                    ███         ██
 0 ├┬───────────┬──────────┬───────────┬
   │           ███                      
   │           ███                      
   │           ███                      
   │           ███                      
-5 ┤           ███                      
    0           1          2           3
```

`options.orientation: "horizontal"` reads `x` as the value and `y` as the category; omitted/`"vertical"` keeps the original vertical geometry. Numeric shorthand swaps to `x = value, y = index`. The value axis includes zero. Horizontal bars occupy one row per series (times `textScale`). Each category label sits on its first bar row; series rows are contiguous, with one blank row (times `textScale`) between categories when the plot has room. Bars, labels and categorical overlays use the same integer row layout; cramped plots fall back to the available category bands. Supply `channels.x0` for floating intervals, with `x` as the end; interval endpoints may be `Date`s on a time scale and need no zero baseline. A nonzero interval smaller than a cell becomes a one-cell event with `bar-interval-collapsed`. Horizontal bars require materialized rows; transforms still operate on vertical values and reject with `bad-options` on horizontal bars.

```ts
glyphChartBar([{ region: "East", units: 10 }], { x: "units", y: "region" }, { orientation: "horizontal" });
glyphChartBar([{ start: new Date("2025-01-01"), end: new Date("2025-01-03"), task: "Build" }],
  { x0: "start", x: "end", y: "task" }, { orientation: "horizontal" });
```

### `glyphChartTreemap`

`glyphChartTreemap(data, channels?, options?)` accepts flat hierarchy records. Default channels are `{ id: "id", parent: "parent", value: "value", label: "label" }`; field names, arrays and accessors work as usual. Omit a root's parent or use `""`. Ids must be unique; parents must exist and be acyclic. Leaf values must be finite and nonnegative; branches sum their descendants. Invalid resolved hierarchies reject with the runtime code `treemap-hierarchy` and a repair hint. No Cartesian axes or transforms are involved.

The mark squarifies by value using the target's cell aspect, rounds shared partition coordinates to cells, and draws rectangles with single shared sibling borders and T/cross junctions from the canvas's existing rectangular border family. Branch labels reserve one text row; descendants share the parent sides and bottom, so nesting never accumulates horizontal border insets. Labels keep one blank cell (times `textScale`) inside each side border. Leaf labels include their value, wrap at whole words when necessary, and paint only when the complete text fits; tiny tiles, zero-area nodes and labels that do not fit produce `treemap-omitted`. Cell rounding and header/border space necessarily approximate area. `textScale` scales labels and header reservations; it does not scale proportional geometry. `options.color` colors the hierarchy's outlines and text; a named mark can have a legend, while Mermaid treemaps disable it.

### `glyphChartDot`

```ts
renderGlyphChart(glyphChartDot([3, 5, 2, 8, 6, 9, 4]), { target: "chat", width: 40, height: 12 });
```
```
  │                              ●      
8 ┤                  ●                  
  │                                     
  │                                     
6 ┤                        ●            
  │                                     
  │      ●                              
4 ┤                                    ●
  │                                     
  │●                                    
2 └┬───────────●───────────┬───────────┬
   0           2           4           6
```

### `glyphChartArc` (pie/donut)

An arc/text-only spec draws no cartesian axis. Record arcs require the value channel `y`; categories use `fill`, falling back to `label`, then the row index. Missing `y` rejects with `arc-missing-value`. Numeric arrays use each element as the value and its index as the category. Positive categories become `meta.series` and legend entries; repeated categories sum into one slice. Nonpositive values occupy no angle, and an all-zero pie is empty with an `empty-total` ledger entry. Pass `options.innerRadius` (`0 <= radius < 1`) for a donut hole.

The disc is a genuine circle on screen (its radius is split by the canvas's own `cellAspect`, never fit independently per axis) and never touches the plot rect edge (`GLYPH_CHART_ARC_FILL = 0.8`). `options.labels: "callout" | "legend-only"` (default `"callout"`) draws a leader line from each slice whose own angular span is at least 8° out to a `name · NN%` label beside the disc — left half left, right half right, same-side labels stacked one row apart and dropped (`label-dropped`) when a side runs out of room; a thinner slice gets no callout and its own `label-dropped` entry, since with `legend: false` nothing else names it; `"legend-only"` paints just the disc, leaving identification to the legend row.

```ts
const data = [
  { browser: "Chrome", share: 65 },
  { browser: "Safari", share: 20 },
  { browser: "Firefox", share: 15 },
];
renderGlyphChart(glyphChartArc(data, { fill: "browser", y: "share" }), { target: "chat", width: 40, height: 14 });
```
```
  Firefox · 15%─────                    
               ▚▚▚▚▚█████               
             ░▚▚▚▚▚▚███████             
            ░░░░░▚▚▚████████            
 Safari─────░░░░░░░░████████            
            ░░░░░███████████            
             ░█████████████─────Chrome  
               ██████████               
                                        
                                        
                                        
█  Chrome    ░  Safari    ▚  Firefox   
```

Slices cycle a SHAPE-FAMILY glyph set, not a density ramp — `█ ░ ▚ ╱ ▌ ═ ▓ ▒` in box/blocks/braille (prefix-consistent, so an n-slice pie uses the first n), `# . @ -` in ASCII for up to 4 slices and `# . = / @ : | -` beyond (ASCII cannot sustain a 0.15 ink-coverage gap between adjacent glyphs past 4 in any measured monospace font). Past 8 slices the cycle wraps and `report.ledger` carries one `series-shade-repeat` entry per repeated pair, naming both slices. The legend shows each slice's glyph swatch; colour adds matching palette colours to slices and swatches. On the web with colour, and every slice its own colour, the coloured `html`/ANSI exit paints slices solid instead (see `regionFill` under "Series"); `build.canvas` (`result.build.canvas`) and plain `text` keep the shade cycle, preserving slice proportions when colour is removed downstream.

### `glyphChartCell` (heatmap)

Both axes band-scale string categories. A chart made only of `cell` marks on two band scales is a heatmap: its cells tile flush, each `2k` columns by `k` rows (about square on screen) for the largest `k` that fits, and the chart shrinks to that grid rather than stretching cells across the canvas. Every row and column keeps its label when they fit.

Numeric `fill` uses one shared ramp across every cell mark. Same-sign data splits its own min..max into equal bins over `░ ▒ ▓ █` (ASCII `. : + * % # @`, ordered by measured ink), with no blank level, and a one-line range key under the grid reads `min ░░▒▒▓▓██ max`. The `cellRamp` render option replaces that ramp (lightest first, one visible character each, 7-bit on `ascii`), key included. Mixed-sign data keeps a diverging ramp around zero and no key: `[-10, 0, 10]` yields full ink, blank, full ink — blank means "no signal", reserved for exactly zero, and each side ramps independently out to its own extreme. A cell with no `fill` paints solid.

```ts
const data = [];
for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) data.push({ x: String(x), y: String(y), v: x * y });
renderGlyphChart(glyphChartCell(data, { x: "x", y: "y", fill: "v" }), { target: "chat", width: 40, height: 14 });
```
```
  │░░░░░░▒▒▒▒▒▒▓▓▓▓▓▓██████
2 ┤░░░░░░▒▒▒▒▒▒▓▓▓▓▓▓██████
  │░░░░░░▒▒▒▒▒▒▓▓▓▓▓▓██████
  │░░░░░░░░░░░░▒▒▒▒▒▒▓▓▓▓▓▓
1 ┤░░░░░░░░░░░░▒▒▒▒▒▒▓▓▓▓▓▓
  │░░░░░░░░░░░░▒▒▒▒▒▒▓▓▓▓▓▓
  │░░░░░░░░░░░░░░░░░░░░░░░░
0 ┤░░░░░░░░░░░░░░░░░░░░░░░░
  │░░░░░░░░░░░░░░░░░░░░░░░░
  └───┬─────┬─────┬─────┬──
      0     1     2     3  
   0 ░░▒▒▓▓██ 6            
```

### `glyphChartText`

Labels at data coordinates, meant as an annotation over another mark in the same plot. There, a label never overwrites the data it names: it takes the first spot with no data ink under it (centred above its point, centred below, then to its left or right with a one-cell gap), and stays above the point only when none is clear. A text-only chart centres each label on its point.

```ts
renderGlyphChart(glyphChartText([{ x: 1, y: 1, label: "hi" }], { x: "x", y: "y", label: "label" }), { target: "chat", width: 20, height: 10 });
```
```
                    
                    
                    
                    
         hi         
                    
                    
                    
                    
                    
```

### `glyphChartSankey`

Non-cartesian, like `arc`. `{ source, target, value }` name channels the way every other mark does. Node columns are laid out by depth (`d3-sankey`), and each node is a one-column bar (`█`, ascii `#`) whose height is its throughput under ONE global rows-per-unit scale, so a larger value is never drawn shorter than a smaller one elsewhere. Every flow gets a share of rows on both of its bars, split by cumulative rounding so a node's shares always add up to its own height, with a blank row between shares and between stacked bars when there is room (`GLYPH_CHART_SANKEY_LINK_GAP_ROWS`, `GLYPH_CHART_SANKEY_NODE_PADDING_ROWS`).

A flow is drawn as a line, not a ribbon: one stub per row of its source share, gathered into a single line, and fanned back out over its target share. With room in the gap, the gathering is a tree that folds the outer rows inward one stage at a time (`┴─╮` above the middle row, `┬─╯` below), never wider than a quarter of the gap, so a tall share folds several rows per stage; a tight gap gets a single bracket (`╮ ┤ ┼ ┤ ╯`). The line carries the flow's value on its longest clear run, and its weight hints at size: `━` for a flow at least 55% of the largest, `─` from 25%, `┄` below (ascii `=`, `-`, `.`). Bends take one column of their own per gap, so lines only meet at right angles, and a vertical crossing another flow's line passes over it. A flow skipping a column threads through a free row between that column's bars (`sankey-band-unroutable` when there is none). Outer columns label their bars in a gutter beside them, `name value`; a middle column's label goes under (else over) its bar. A flow too small for its own row folds into `(other)` (`sankey-folded-flows`).

A non-terminal node whose inflow and outflow disagree gets `sankey-imbalance`; a nonpositive value or a missing channel rejects with `sankey-bad-value` (a non-finite value in the data itself rejects earlier and generically with `non-finite-data`); a typo'd channel name rejects with `sankey-missing-channel` rather than a misleading cycle error; a genuine cycle rejects with `sankey-cycle`. The legend defaults off, since every node is labelled; `legend: true` lists the sources with line swatches.

```ts
const data = [
  { from: "Coal", to: "Power", amount: 40 },
  { from: "Gas", to: "Power", amount: 60 },
  { from: "Power", to: "Homes", amount: 70 },
  { from: "Power", to: "Industry", amount: 30 },
];
renderGlyphChart(glyphChartSankey(data, { source: "from", target: "to", value: "amount" }), { target: "chat", width: 50, height: 16 });
```
```
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

### `glyphChartFunnel`

Non-cartesian, like `arc`/`sankey`. `data` is ordered `{ stage, value }` records (or a bare `number[]`, stage = index) — every row is its own stage even when two share a label. The funnel is one solid shape (`█`, `#` on ascii) whose stages settle at widths proportional to the SQUARE ROOT of value/max, so a late, small stage stays visible; each tapers in from the previous stage's width with quadrant half-steps, a blank row parts the stages, and the shape fills the plot with a blank row above and below. Each stage gets one label line on its waist: name, value, share of the first stage, and from the third stage on the share of the previous stage that made it (`↓ 31%`; `v` on ascii). The step and share columns give way before the shape gets too narrow; a value too wide for the gutter takes its SI form, then drops (`label-dropped`), never truncates. Stages are told apart by colour and label, so the fill ignores `regionFill` and `shades`. More stages than the plot has rows folds the tail into one "other (k more)" stage rather than dropping it silently (`funnel-folded-stages`). A negative value rejects with `funnel-bad-value`; an all-zero funnel draws nothing (`empty-total`); a nonpositive first-stage value omits every percentage rather than printing a fabricated `0%` (`funnel-bad-reference`). A stage exceeding the one above it renders in place and logs `funnel-not-monotone`; a width under one cell draws a one-cell stub and logs `funnel-thin-stage`. Legend defaults OFF (the stage labels already carry identity); pass `legend: true` to list the stages anyway.

```ts
const data = [
  { stage: "Visits", count: 10000 },
  { stage: "Product Views", count: 4000 },
  { stage: "Add to Cart", count: 1000 },
  { stage: "Checkout", count: 400 },
  { stage: "Purchase", count: 260 },
];
renderGlyphChart(glyphChartFunnel(data, { stage: "stage", value: "count" }), { target: "chat", width: 64, height: 20 });
```
```
                                                                
███████████████████████████  Visits         10,000  100%        
                                                                
 ▜███████████████████████▛                                      
  ▝▜███████████████████▛▘                                       
    ▀█████████████████▀                                         
     █████████████████       Product Views   4,000   40%        
                                                                
      ▀█████████████▀                                           
        ▀█████████▀                                             
         █████████           Add to Cart     1,000   10%   ↓ 25%
                                                                
         ▝███████▘                                              
          ▝█████▘                                               
           █████             Checkout          400    4%   ↓ 40%
                                                                
           █████                                                
           ▜███▛                                                
           ▐███▌             Purchase          260    3%   ↓ 65%
                                                                
```

### Composing marks

```ts
import { glyphChartPlot, glyphChartLine, glyphChartDot, glyphChartRule, renderGlyphChart } from "@glyphcss/charts";

const data = [{ t: 0, v: 3 }, { t: 1, v: 5 }, { t: 2, v: 2 }, { t: 3, v: 8 }];
const spec = glyphChartPlot({
  marks: [
    glyphChartLine(data, { x: "t", y: "v" }),
    glyphChartDot(data, { x: "t", y: "v" }),
    glyphChartRule([0]),
  ],
  title: "line + dot + rule",
});
renderGlyphChart(spec, { target: "chat", width: 50, height: 16 });
```
```
                 line + dot + rule                
8 ┤                                             /●
  │                                            // 
  │                                          ///  
6 ┤                                         //    
  │                                       ///     
  │             -▔●▔-                    //       
4 ┤        -▔‾_-    -_▔-               ///        
  │   -▔‾_-            -_▔-           //          
  │●_-                    -_‾-      ///           
  │                          -_‾-  //             
2 ┤                             -_●/              
  │                                               
  │                                               
0 └┬──────────────┬───────────────┬──────────────┬
   0              1               2              3
```

## Legends

A named mark contributes its own legend entry, with its own swatch, exactly like a categorical series does — one is enough (an unnamed mark shows none):

```ts
const data = [3, 5, 2, 8, 6, 9, 4];
const spec = glyphChartPlot({
  marks: [
    glyphChartLine(data, undefined, { name: "Revenue" }),
    glyphChartLine(data.map((v) => v - 2), undefined, { name: "Visits" }),
  ],
});
renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 44, height: 14 }).text;
```
```
  │                                /\\      
8 ┤                    \\         // \\     
  │                   //\\\     ////\ \\    
  │                  //    \\\ // /  \ \\   
6 ┤                 // ‾▔    \/// /     \\  
  │     -▔\\       // /  -_ -   /      \ \\ 
4 ┤  -‾_-  \\     //        - //        \ \\
  │__-    \\\\\  // /                       
  │     //  \ \\// /                      \ 
2 ┤  //     \ \\/                          \
  │//         \  /                          
0 └┬───────────\/─────────────┬────────────┬
   0            2             4            6
     ───Revenue            ── Visits        
```

Distinct swatches: a solid rule for the first series, a dashed one for the second — the same `SERIES_STYLES` cycle a categorical `fill`/`stroke` split already uses. Colour-enabled renders use distinct palette colours instead. `legend: false` hides the row without changing `meta.series`.

### Legend and title placement

`legend: boolean | { placement }` — `"bottom"` (default, same as `true`), a plot corner (`"top-left"`/`"top-right"`/`"bottom-left"`/`"bottom-right"`, painted inside the plot with no row reserved), or `"title"` (shares the title's own row):

```ts
const spec = glyphChartPlot({
  marks: [glyphChartLine([3, 5, 2, 8, 6, 9, 4], undefined, { name: "Revenue" })],
  legend: { placement: "top-left" },
});
renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 44, height: 14 }).text;
```
```
  │─ Revenue                       /\       
  │                               //\\      
8 ┤                    \\        //  \\     
  │                   //\\\     //    \\    
  │                  //    \\\ //      \    
6 ┤                  /       \//        \   
  │                 //                  \\  
  │      /\\       //                    \\ 
  │    /// \\     //                      \\
4 ┤ ///     \\    /                        \
  │//        \\  //                         
  │           \\//                          
2 └┬───────────\/─────────────┬────────────┬
   0            2             4            6
```

An overlap with painted data at a corner logs `legend-overlaps-marks` with the covered cell count, rather than covering it silently. `title: string | { text, align?, position? }` — a bare string is `{ align: "center", position: "top" }`; `align: "left"`/`"right"` moves the title's own row, `position: "bottom"` moves it to the chart's LAST row (below the legend and axis rows, which claim their space first):

```ts
const spec = glyphChartPlot({
  marks: [glyphChartLine([3, 5, 2, 8, 6, 9, 4], undefined, { name: "Revenue" })],
  title: { text: "Weekly revenue", align: "left", position: "bottom" },
});
renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 44, height: 14 }).text;
```
```
  │                                /\       
8 ┤                    \\         // \      
  │                   //\\\     ///   \     
  │                  //    \\\ //      \    
6 ┤                 //       \//        \   
  │                 /                    \  
  │      /\\       /                      \ 
4 ┤    /// \\     //                       \
  │ ///     \\\  //                         
  │//         \\//                          
2 └┬───────────\/─────────────┬────────────┬
   0            2             4            6
                ───Revenue                  
Weekly revenue
```

## Axes

`spec.axes?.{x,y}: { ticks?, tickMarks?, line?, title?, grid? }`. `line: false` hides that axis's line and tick marks and keeps its labels. Tick marks are on by default — `┤`/`┬` where a tick actually lands, `│`/`─` elsewhere, `└` at the corner (`+` on every stem under `charset: "ascii"`, since its own junction table already collapses every multi-stem glyph to that):

```ts
renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", charset: "ascii", color: "none", width: 30, height: 10 }).text;
```
```
8 +                         //
  |                        // 
  |                       //  
6 +                      //   
  |        -\\          //    
4 +     ---  \\\       //     
  |  --_       \\\    //      
  |__            \\\ //       
2 ++--------+------\//-------+
   0        1       2        3
```

`ticks` requests a count (fed to d3's own `scale.ticks(n)`, still thinned to whatever fits without collisions); `title` defaults to the axis channel's own field name (suppressed by an explicit `title: ""`); `grid` adds faint `┈`/`┊` gridlines (`.` on ascii) at tick positions:

```ts
const data = [{ month: "Jan", value: 3 }, { month: "Feb", value: 5 }, { month: "Mar", value: 2 }, { month: "Apr", value: 8 }, { month: "May", value: 6 }];
const spec = glyphChartPlot({
  marks: [glyphChartLine(data, { x: "month", y: "value" }, { name: "Revenue" })],
  axes: { y: { ticks: 4, grid: true } },
});
renderGlyphChart(spec, { target: "chat", charset: "box", color: "none", width: 64, height: 22 }).text;
```
```
value                                                           
8 ┤┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\\┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
  │                                         //\\\               
  │                                        //   \\\             
  │                                        /      \\\           
  │                                       //        \\\         
  │                                      //           \\\       
6 ┤┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈//┈┈┈┈┈┈┈┈┈┈┈┈┈┈\\┈┈┈┈┈┈
  │                                     /                       
  │                 /\\                //                       
  │               /// \\              //                        
  │             ///    \\             /                         
4 ┤┈┈┈┈┈┈┈┈┈┈┈///┈┈┈┈┈┈┈\\\┈┈┈┈┈┈┈┈┈┈//┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
  │         ///           \\        //                          
  │       ///              \\      //                           
  │      //                 \\\    /                            
  │                           \\  //                            
  │                            \\//                             
2 └──────┬───────────┬──────────\/───────────┬───────────┬──────
        Jan         Feb         Mar         Apr         May     
                               month                            
                          ───Revenue                            
```

`y`'s title (`value`, defaulted from the channel field name) sits top-left above the axis — a rotated column of glyphs has no character-grid analogue — while `x`'s title (`month`) is centred under its own tick-label row. An auto title like these only shows with genuine room for it (`rows >= 20` for the x title, `cols >= 60` for the y title, hence the larger canvas above) and a field name longer than two characters; an EXPLICIT `axes.x.title`/`axes.y.title` (including `""` to suppress the default) always shows regardless of size. `tickMarks: false` on either axis reverts to a plain, undecorated rule. Index/integer data never shows a fractional tick (`0.5`, `1.5`, …), even where d3's own "nice" ladder for a small domain would otherwise reach for one.

`axes.x.titleAt: "start" | "center" | "end"` (default `"center"`) moves the x title off its centred default to the plot's own left or right edge; `axes.y.titleAt: "top" | "bottom"` (default `"top"`) moves the y title from its top-left default to below the plot, at column 0, on its own row exactly like the x title's:

```ts
renderGlyphChart(spec, {
  target: "chat", charset: "box", color: "none", width: 64, height: 22,
}).text; // spec.axes: { x: { titleAt: "end" }, y: { titleAt: "bottom" } }
```

When both titles land at the bottom, the y title shares the x title's row if it fits to the LEFT of it; otherwise it claims a second row and `report.ledger` gets an `axis-title-stacked` entry. Applies to an explicit title and the automatic field-name default alike — the room-gating rules above are unchanged. Each axis has its own vocabulary (`axes.x.titleAt` never accepts `"top"`/`"bottom"`, and vice versa); an out-of-vocabulary value rejects with `bad-axis-title-at`.

### Tick formatters

`axes.x.format`/`axes.y.format` overrides a tick's own label — a named PRESET (the only shape `renderGlyphChartJson`/the CLI/the JSON schema accept), or, TS/JS callers only, a callback `(value, index, ticks) => string` called per tick with its raw scale value, its own index, and the full tick array:

```ts
const spec = glyphChartPlot({
  marks: [glyphChartBar([12000, 45000, 98000])],
  axes: { y: { format: { preset: "currency", symbol: "$" } } },
});
renderGlyphChart(spec, { target: "chat", color: "none" }).text;
```

Every preset lives in one exported table, `GLYPH_CHART_TICK_FORMAT_PRESETS`:

| Preset | Example | Params |
|---|---|---|
| `"auto"` (default, or omit `format`) | today's ladder | — |
| `"number"` | `1,234,567` | — |
| `"si"` | `1.2k`, `3.4M` | — |
| `"compact"` | `1.2K`, `3.4M`, `1.2B` | — |
| `"integer"` | `1235` | — |
| `"percent"` | `42%` (value `0..1`) | `of?: number` — `{ of: 100 }` for a `0..100` axis |
| `"currency"` | `$1,234.00` | `symbol?: string` (default `"$"`), `decimals?: number` (default `2`) |
| `"decimals"` | `3.1416` | `places: number` (required) |
| `"scientific"` | `1.23e+4` | — |
| `"date"` | `2024-01-05` | — |
| `"year"` | `2024` | — |
| `"month"` | `Jan 2024` | — |
| `"day"` | `12 Jan` | — |
| `"time"` | `14:05` | — |
| `"template"` | `42 °C` | `pattern: string` (required) — `{value}` is the auto-formatted value |

A bare string is sugar for `{ preset: "<name>" }`; `"auto"` (and an absent `format`) is a no-op, so a default chart is byte-identical to one built before `format` existed. A formatted numeric label that overflows its cell budget still follows the existing abbreviate-or-drop policy: a preset's own SI fallback runs first where it has one (`number`, `integer`, `currency`); otherwise the label drops, never truncates into a shorter-but-wrong number (`"1,234.00"` never becomes `"1,2"`). A callback's return value is opaque text the library can't parse back into a number, so it's always treated as a category label — elided with `…` rather than dropped. Applies to axis ticks only, never an arc's own callout percentage or a funnel's value and share labels.

## Colours

`spec.axes.color?: string` (a canonical `#rrggbb`) sets both axes' line, tick marks, tick labels, title, and grid; `spec.axes.{x,y}.color` overrides it per axis. With colour on and no colour set, axes default to a muted mid grey (`GLYPH_CHART_AXIS_DEFAULT_COLOR`, `"#7a7f8a"`) rather than the reader's own foreground colour, so a chart's data marks read brighter than its frame:

```ts
const spec = glyphChartPlot({ marks: [glyphChartLine([3, 5, 2, 8])], axes: { color: "#7a7f8a", x: { color: "#2563eb" } } });
renderGlyphChart(spec, { target: "web" }).html;
```

Every mark's own `options.color?: string | string[]` overrides its palette colour, and its legend swatch follows: a single hex applies to every one of that mark's own series, or an array is assigned per series in series order (cycling if shorter — a longer array logs a `mark-color-unused` ledger entry naming how many went unused):

```ts
glyphChartLine(categoricalSeriesData, { x: "x", y: "y", stroke: "s" }, { color: ["#e11d48", "#0ea5e9"] });
```

`arc` colours per slice; `cell` takes a single ink colour, or `[losses, gains]` for a diverging (mixed-sign) domain; `sankey` colours per source node; `funnel` colours per stage. `renderGlyphChart(..., { color: "none" })` drops every one of these exactly as it always dropped the palette — under `color: "none"`, a spec with no colour options at all renders byte-identically whether or not this feature exists. With colour ON, a spec with no colour options is exactly the case whose axes now default to `GLYPH_CHART_AXIS_DEFAULT_COLOR` above, so that render is NOT byte-identical to before this feature existed.

## Scales, series and labels

`scales.x/y.type` supports `linear`, `log`, `sqrt`, `time`, `band`, and `ordinal` (band). Log and square-root scales use d3's actual transforms. Log domains containing zero or crossing sign reject with `log-domain`; zero-anchored bars/rects therefore need a zero-capable scale. Time domains accept calendar-valid ISO strings, parsed once; invalid ones reject with `bad-time-domain`. Intraday ticks use d3's multi-scale time format. `nice: true` enables d3 domain nicening.

Categorical `fill` or `stroke` splits line, area, dot, bar and cell rows into separate series. Each appears in `meta.series` and the legend, alongside any named marks (see "Legends"). Colour uses distinct series colours. A LINE/area-boundary series monochrome-cycles solid/dashed/dotted/double strokes; a REGION mark's fill (bar/area) instead carries series identity through its own glyph — a SHAPE-FAMILY set (`█ ░ ▚ ╱ ▌ ═ ▓ ▒` in box/blocks/braille, `# . @ -`/`# . = / @ : | -` in ASCII below/above 4 series — see the pie section above) wherever colour cannot tell series apart, so a stacked/dodged chart stays readable in Copy ASCII; its legend swatch is that same glyph, never a line style. `regionFill: "auto" | "solid" | "texture"` (default `"auto"`) swaps that glyph for a solid `█` (`#` on ascii) in the colour-carrying exits only — `html` under `css`, `text` under an ANSI mode — when colour is on, the target is not `terminal`/`chat`, and no two region series share a colour at the render's own depth (ansi16 maps the default blue and green to one colour). `build.canvas` and plain `text` always keep the textures. `glyphChartRegionFill(input, options)` returns the decision and a one-sentence reason; an explicit `"solid"` that would make two series identical is refused with a `region-fill-solid-refused` ledger entry. Past 8 series in one shade family the cycle wraps and `report.ledger` gets a `series-shade-repeat` entry per repeated pair. The `shades` render option (e.g. `shades: ["#", "=", "+", ":", "."]`) replaces that glyph set, legend swatches included, with your own palette: one visible character per series, 7-bit on `ascii`; it wraps and reports on its own length, and solid fills and `cell` ramps ignore it. A `dot` mark's glyph is a distinct whole-cell shape (`● × + ◆`/ASCII `o x + *`) on `ascii`/`box`; under `braille`/`blocks` every point instead paints a full 2×2 sub-cell dot cluster (4 dots, positioned at the exact sub-cell coordinate) regardless of series or colour, since a single dot there measures under 2px — colour carries series identity for dots at that resolution. The frozen canvas logs its existing solid fallback for double diagonals. Categorical dot y-values paint on band centres, or on their horizontal-bar group's first row when composed. `size`, `shape`, and `curve` are unsupported and removed from the public types/schema; supplied values reject instead of being ignored.

All strings pass through the canvas's text fold. ASCII output is 7-bit, including `-`, a three-cell `...`, accented titles and text marks. Axis labels use the same slot-aware abbreviation policy as other labels: SI first, then elision, with ledger entries. Crowded category labels thin every kth tick; numeric/time collisions also thin. Labels never rely on canvas clipping.

`glyphChartSeriesPreview(input, options?)` computes a chart's own series list and resolved colours WITHOUT painting — one `{ name, markIndex, styleIndex, color }` entry per series, in the same order and count `meta.series` reports for every named series (an unnamed single-series mark still gets exactly one entry, named `Mark <n>`). It runs the identical `chartSeries`/`resolveSeriesColor` pipeline the real render uses, so a caller building its own colour-swatch UI (the `/charts` Dock's mark cards) never re-derives series grouping and risks diverging from the real render on a numeric `fill` channel, a `group`/`normalize` transform, or a funnel's duplicate stage names (disambiguated as `"Retry"`, `"Retry (2)"`, … so every series identity is unique within its own mark). `options.color` mirrors `renderGlyphChart`'s own `color` — pass `"none"` to get `color: null` back for every series, matching a render that paints no colour at all; omitted, colour is on. Throws only a tagged error (a `bad-chart-input` for a malformed shape, or the matching `GLYPH_CHART_VALIDATION_RULES` id), never a raw `TypeError`.

## Transforms

`{ transform: { kind: "bin" | "stack" | "group" | "normalize" | "window", n?, by?, reduce? } }` on any mark. Minimal on purpose (not Plot's full transform vocabulary): `bin` is an equal-width histogram over `x`; `stack` accumulates `y0`/`y1` per shared `x`, in input order; `group` aggregates `y` per distinct `x` (`sum` by default, or `mean`/`min`/`max`); stack/group compare Date values by timestamp and retain the original Date for time-scale inference; `normalize` divides by the largest `|y|` within a `by`-defined group (the whole series by default); `window` is a rolling `reduce` over `n` consecutive rows.

## Targets, charsets, colour

```ts
renderGlyphChart(spec, {
  target: "chat" | "terminal" | "web",             // picks the defaults below
  charset: "ascii" | "box" | "blocks" | "braille",  // overrides the target's default
  color: "none" | "ansi16" | "ansi256" | "truecolor" | "css",
  width, height,                                     // positive integers; fractions reject with bad-size
  detail: "auto" | "faithful" | "balanced" | "simplified",
  legend: true,                                      // default; false hides the series legend without changing meta.series
  env,                                                // { NO_COLOR?, FORCE_COLOR? } — read only from here, never process.env implicitly
});
```

| `target` | Default size | Default charset | Default colour |
|---|---|---|---|
| `chat` | 72×24 | `box` | `none` — reverted from braille: a chat client's fenced code block renders in whatever monospace stack its own CSS picks, never one this package controls, and none of those stacks (SF Mono, Menlo, Consolas, ...) carries the braille block, so a braille chart pasted into chat misaligns; ANSI also never survives a paste |
| `terminal` | 80×24 | `braille` | `truecolor`, downgraded by `NO_COLOR`/`FORCE_COLOR` — a real terminal's font is a one-time user choice and terminal fonts overwhelmingly do carry braille |
| `web` | 96×32 | `braille` | `css` — populates `result.html`; the website ships its own braille/box-complete font, so nothing here depends on the visitor's system font |

The bare `renderGlyphChart(x)` (no `options`) defaults to `target: "web"`.

`braille` reuses `box`'s own junction/arrow glyphs (Phase 0's tier tables) for routes and rule marks, but `line`/`dot`/an area's boundary rasterise at genuinely finer, SUB-CELL (dot) resolution under `braille`/`blocks` than under `box` — a line-only chart does NOT render byte-identically across the two. **Axes stay whole-cell** (`│`/`─`) under every charset, even `braille`/`blocks` — only DATA marks (line, an area's boundary, dot) go sub-cell; a chart's axis frame and `glyphChartRule` reference lines are structure, not data, and `canvas.line`'s explicit `subcell: false` option is what keeps them legible box-drawing instead of a wobbly dot approximation. `result.text` is the ENCODED string for the call's own `color` — raw for `"none"`, ANSI SGR for the three ANSI depths — so a `terminal` render's `text` already contains escape codes unless you override `color: "none"`.

```ts
const data = [3, 5, 2, 8, 6, 9, 4, 7, 3, 5];
renderGlyphChart(glyphChartLine(data), { target: "chat", charset: "box", width: 44, height: 12 }).text;
```
```
  │                      \                  
8 ┤             \\      /\\                 
  │            //\\    /  \\                
  │            /   \\ /    \      \         
6 ┤           //    \/      \    /\\        
  │           /             \\  /  \\       
  │   /\\     /              \\/    \\    //
4 ┤  // \\   //               /      \\  // 
  │ //   \\  /                        \\//  
  │//     \\//                         //   
2 └┬───────\/────────┬────────┬────────┬────
   0        2        4        6        8    
```
```ts
renderGlyphChart(glyphChartLine(data), { target: "chat", charset: "braille", width: 44, height: 12 }).text;
```
```
  │                      ⢠                  
8 ┤             ⢠⡀      ⢠⠃⢇                 
  │             ⡎⠈⢆    ⢠⠃ ⠈⡆                
  │            ⢰⠁  ⠑⢄ ⢠⠃   ⠸⡀     ⢠         
6 ┤            ⡜    ⠈⠢⠃     ⢣    ⢠⠃⢣        
  │           ⢠⠃            ⠈⢆  ⢠⠃  ⢇       
  │    ⡠⡀     ⡸              ⠘⡄⢠⠃   ⠈⡆     ⡠
4 ┤   ⡔⠁⠑⡄   ⢀⠇               ⠱⠃     ⠘⡄   ⡔⠁
  │ ⢀⠎   ⠘⢄  ⢸                        ⠸⡀⢀⠎  
  │⠠⠃     ⠈⢢ ⡇                         ⠱⠃   
2 └┬────────⠻────────┬────────┬────────┬────
   0        2        4        6        8    
```
Real, unedited output from both calls. `box` uses 12 distinct glyphs: the two slope glyphs `/`/`\`, five tick digits (`0`/`2`/`4`/`6`/`8`), and five whole-cell axis/junction glyphs `│`/`─`/`┤`/`┬`/`└`. `braille` uses 40 distinct glyphs total — the same five tick digits and five axis/junction glyphs, unchanged from `box`'s own, plus 30 distinct actual braille dot patterns for the data line, never `/`/`\`.

The `/charts` page applies target defaults to untouched controls and preserves explicit overrides per control. **Reset to target defaults** clears them. Terminal previews decode ANSI into coloured spans; CSS output shows HTML on every target; the chat frame never shows colour and hides **Copy ANSI**. **Copy as text** always copies plain text. ANSI escapes are never inserted into the browser preview.

## Validation and schema

```ts
import { validateGlyphChartSpec, glyphChartJsonSchema, glyphChartRepairHint } from "@glyphcss/charts";

validateGlyphChartSpec(spec); // validates and returns a spec with parsed time domains; throws with error.code
const schema = glyphChartJsonSchema(); // JSON Schema; vocabulary shared with runtime, checked with Ajv
glyphChartRepairHint("empty-marks"); // "Add at least one mark to spec.marks, e.g. glyphChartLine([...])."
```

Empty data, missing x/y on cartesian records, missing y on arc records (`arc-missing-value`), unknown transforms and null marks reject with rule IDs. Non-finite values reject with `non-finite-data`; categorical y on dots is valid. Ajv runs every shared JSON fixture and designed-bad spec against the schema and compares runtime verdicts. Runtime additionally checks accessor results and inferred domains. `width`/`height` are render options, validated as positive integers with `bad-size` before layout.

## Mermaid charts

`glyphChartFromMermaid(source)` returns a normal `GlyphChartMermaidSpec` with an additional `ledger` of source-adaptation notes. `renderGlyphChartMermaid(source, options)` uses the existing mark pipeline and merges those notes into both `report.ledger` and `build.report.ledger`. Passing the spec directly to `renderGlyphChart` works; retain its source `ledger` separately in that case.

All chart readers report unsupported-character substitutions as `label-folded` with the label role and original/folded text (`before`/`after`), including text folded before wrapping. Folding follows the target charset; unsupported wide characters still become `?`. Existing `label-abbreviated` notes remain; rendering is unchanged.

```ts
import { glyphChartFromMermaid, renderGlyphChartMermaid } from "@glyphcss/charts";

const source = `pie showData title Pets
"Dogs" : 45.5
"Cats" : 32.25
"Birds" : 22.25`;
const spec = glyphChartFromMermaid(source);
const { text, report } = renderGlyphChartMermaid(source, { target: "chat", width: 72 });
```

- **`pie` → arc:** optional title and `showData`, quoted labels, decimal values, ordered slices. `showData` appends the raw value in brackets to the slice name. Zero values remain empty slices.
- **`xychart` / `xychart-beta` → bar and line:** optional title and axes; categorical or numeric x-axis; numeric y-axis; signed decimal values; multiple named or unnamed series; optional per-point quoted line labels. Quoted categories stay categorical even when they resemble dates. Each numeric series independently spans the entire x range; without a range the first nonempty series establishes `1..length`, and later series span that same range. Horizontal charts swap coordinates, scales, titles and point labels; bars use native horizontal orientation. Labels on bar values are accepted and ignored, as in Mermaid.
- **`sankey` / `sankey-beta` → sankey:** three-column CSV, quoted commas, doubled quotes, multiline fields and blank lines. Native flow layout, weighting and folding apply.
- **`quadrantChart` → dots, rules and text:** title, one-sided or paired axes, all four quadrant captions, normalized points, direct point styles and forward `classDef` references. Direct styles override classes. Hex fill colors survive color-capable output; short hex expands to canonical six-digit hex. Numeric 0/1 ticks are hidden; low/high labels occupy the corresponding axis endpoints.

- **`journey` → horizontal score bars:** title, sections, tasks (`Task: score: actor1, actor2`), scores 1–5 and multiple actors. A compact table layout preserves authored order and repeated names: left-aligned section headers, one blank row between sections, and contiguous task rows with a numeric score and actors beside each bar. Bars share a fixed 0–5 scale (whole cells in the native horizontal painter). Long task names wrap within their column; actor lists that do not fit beside the bar wrap below it, aligned under its start. Whole words never split. No faces or emoji are introduced; the timeline/face replacement receives `mermaid-degraded`. Words wider than their entire column are omitted whole with notes; wide titles retain the longest fitting whole-word prefix. Out-of-range scores clamp with notes. Empty scores parse as zero and use the same logged clamp to a displayed score of one. Empty actors/sections/declarations are accepted; empty declarations show “No tasks”. Both `renderGlyphChartMermaid` and `renderGlyphChart(glyphChartFromMermaid(source))` fit height to content when omitted. Explicit height omits complete task groups that cannot fit, with notes. Configuration stays inert. The reader attaches an internal layout annotation to its native bar spec; preserve the spec object (or its shallow copy) to retain the journey layout. JSON serialization of that annotation is unsupported.
- **`timeline` → compact text/rule rows:** title, optional `LR`/`TD`, sections, arbitrary text periods (including repeated or eventless periods), multiple events separated by a colon followed by whitespace (`period : e1 : e2`) and `: event` continuation lines. Event times (`10:30`) and URLs (`https://example.com`) stay whole. Authored order runs down the page; section headers start at column zero, periods indent two cells, and events sit beside them. One blank row separates sections, with none inside a section. Text wraps at whole words; `<br>` forces a new line. If a word cannot fit its side-by-side column, that period stacks above its events in the indented content width, with a note. Titles and section names also wrap. Horizontal direction, event boxes and theme backgrounds become the logged compact vertical layout.
- **`packet` / `packet-beta` → sharp rectangular bit grids:** title, absolute `start-end: "Label"`, single-bit `start: "Label"` and relative `+N: "Label"` fields, including mixed forms. Relative counts start immediately after the preceding field. Defaults to 32 bits per row, with ascending absolute decimal bit ticks (digits stacked vertically to avoid collisions). Fields crossing row boundaries repeat their labels in each segment; unassigned bits remain blank. Whole words wrap inside cells. Labels wider than a cell use numbered keys below the grid with `mermaid-degraded`; multi-digit keys stack vertically in one-cell fields. Narrow viewports reduce the bits per displayed row with a note. Source `bitsPerRow`, `bitOrder`, `showBits` and pixel geometry settings stay inert with individual notes; the native layout always uses ascending absolute ticks. Overlaps retain the first declared field in each overlapping row, logged. Nonrepresentable/reversed ranges are omitted with notes; fields spanning more than 256 rows retain their first 256 rows, logged.

- **`kanban` → boxed lanes and rectangular cards:** named columns/items (`id[Text]`), bare names and anonymous `[Text]` nodes from the official full example, indentation by spaces/tabs, quoted labels, multiline labels/metadata and `<br>` breaks. Columns and cards retain authored order; repeated ids remain separate occurrences. Cards show ticket, assignee and priority after their text, in that order, separated by ` · `; all four documented priorities remain literal text. Either quote form and unquoted metadata values work, including quoted commas. Empty columns retain an empty boxed lane. Lane widths reserve whole words plus border/padding space; lanes wrap to further rows when they cannot fit, with `mermaid-degraded`. Whole words never split. Words wider than the full card viewport are omitted whole with a note. Explicit height omits complete cards or lanes with notes; automatic height fits content. Unknown metadata is omitted with notes; deeper item indentation becomes a card in the current lane, logged. `config.kanban.ticketBaseUrl` and init configuration remain inert with individual `mermaid-degraded` notes: tickets are plain text, with no outgoing links. Outside nodes/metadata, `%%` starts a comment; inside labels/quoted metadata it remains literal. Hashes remain data. These boundaries follow the [kanban grammar](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/kanban/parser/kanban.jison). Undocumented alternative shapes, icons and class decorations are outside this reader's supported grammar.

At an explicit height, Gantt and horizontal bar summaries (including chat radar and bar-based horizontal XY charts) keep axes, axis titles, bottom legends and bottom chart titles directly after their content. Spare rows become trailing canvas padding. Journey, timeline, packet and kanban already follow this content-first layout. Line-only charts, vertical bars, areas, radar polygons and treemaps use height for proportional geometry and retain their existing layout.

Timeline/packet/kanban use the same internal layout-annotation convention as journey: keep the spec or a shallow copy; JSON serialization does not preserve that annotation. Height fits content when omitted. Explicit height omits complete groups with notes. Words wider than the available content width (after timeline indentation) are omitted whole with notes; they are never split. Text and borders use the existing canvas text and rectangular junction glyphs on both targets, so web's default braille tier deliberately retains whole-cell structural borders.

- **`gantt` → horizontal interval bars, dots and rules:** title, all documented `dateFormat` tokens (English month names), D3 `axisFormat`, `tickInterval`, repeated `excludes` lines (weekends, named weekdays and dates), Friday/Saturday weekend starts, `includes` date overrides, sections, explicit/implicit starts and ends, ids, multiple `after`/`until` references, all duration units (`ms s m h d w M y`), milestones, `crit`/`active`/`done`, and vertical markers. `after` selects the latest end; `until` selects the earliest start, including forward references. Day/week/month/year arithmetic preserves the local calendar across DST and clamps month ends. `inclusiveEndDates` extends explicit ends by a day. Marker tasks retain scheduling/dependency semantics without taking a row. Section headers start at column zero; task labels are indented two cells and right-aligned beneath them. Tasks occupy contiguous rows, with one blank row before every section after the first. Time tick candidates use the coarser of `dateFormat` and `axisFormat` precision before formatting: date-only formats produce whole local calendar days, with DST preserved. Interval widths and milestone positions retain native geometry. Explicit height omits complete rows with notes; overwide row labels keep their longest fitting whole-word prefix with a note. Statuses remain literal label text. Gantt row structure uses the same shallow-copy annotation convention as journey; JSON serialization does not preserve it. Milestones use native dots at start plus half duration. Time-only/partial dates use a stable 1970 calendar; an implicit first start uses the Unix epoch, with a note, rather than reading the current clock.
- **`radar` / `radar-beta` → line/text or horizontal bars:** multiple axis declarations with optional labels; multiple curves per line with optional labels; positional or keyed values; `min`, explicit/inferred `max`, circle/polygon graticules, `ticks`, and `showLegend`. Missing values use the minimum; out-of-range values clamp with a note. `renderGlyphChartMermaid` selects the target look; `glyphChartFromMermaid` returns the polygon spec. Box/ASCII renders use grouped horizontal interval bars per axis, from `min` to the clamped value, with a `mermaid-degraded` note. Repeated display labels in bar summaries include the axis id, with a note. Braille/blocks retain polygons, label vertices with series letters matched in the legend, and omit interior tick values with a note to prevent line collisions. Coincident vertices combine their series letters. Curves are closed straight polygons without fill or smoothing; circular grids are sampled line paths. Radial scales account for the target cell aspect, keeping circles round and polygon grids regular. Circular rings use 256 precise line segments, and every axis has a spoke. Curves and legend swatches use solid native lines consistently; series letters retain identity without color. The radial annotation survives shallow copies, not JSON serialization. More than ten rings becomes ten, with a note.
- **`treemap` / `treemap-beta` → treemap:** quoted sections/leaves, indentation by spaces or tabs, arbitrary nested hierarchy, numeric values, duplicate display labels, title/accessibility metadata, `:::class` and `classDef`. Styles stay inert and are logged. `showValues` and `valueFormat` configuration stay inert with individual notes: native leaf values remain visible and use SI formatting. Negative values become zero area with a source note; zero nodes and sub-cell tiles are omitted with render notes. Complete labels paint only where they fit.

Degradations use `mermaid-degraded` with structured details. Gantt tick intervals request an approximate native tick count, thinned for collisions; `weekday`, `topAxis`, compact layout, today markers, source configuration and browser interactions stay inert with `mermaid-degraded`. Gantt excluded-day backgrounds are unshaded; bars use the computed schedule continuously. Cyclic/missing dependencies use the epoch anchor with a note; unrecognized dates/formats/durations become anchored zero-duration events rather than renderer errors. Source configuration never changes native geometry or executes callbacks. Treemap geometry uses cell-rounded areas and header/border reservations. All new examples render through the ordinary chart pipeline.

Other degradations: explicit bar domains expand to include zero; short category lists gain numbered categories; point radius/border styling becomes a native dot; unsupported CSS colors use the default; multiline CSV names become single-line labels. Nonpositive Sankey flows are omitted with a count; cycles, empty node names and ambiguous normalized names become a text flow list, preserving connectivity and values.

Every chart reader accepts standalone `%%` comments. Only journey and timeline accept `#` comments: journey strips them from tasks, actors, titles and sections; timeline strips them before its declaration and after period text, while event, title and section tokens retain literal hashes (including URL fragments). The other readers treat hashes as data, including quadrant hex colors; a standalone hash-comment statement is invalid except in kanban, where it is a bare node name. Sankey retains `%%` inside CSV data fields; whole-line `%%` comments are a shared-reader extension to its CSV grammar. These boundaries follow the official [timeline](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/timeline/parser/timeline.jison), [journey](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/user-journey/parser/journey.jison), [common chart](https://github.com/mermaid-js/mermaid/blob/develop/packages/parser/src/language/common/common.langium) and [Sankey](https://github.com/mermaid-js/mermaid/blob/develop/packages/mermaid/src/diagrams/sankey/parser/sankey.jison) grammars.

Titles are free text to the end of the line, including unmatched brackets/quotes and semicolons. Journey section/task/actor text also preserves free punctuation. Task names beginning with Click, Style, Class, ClassDef or LinkStyle remain data, including names containing colons. Comments and initialization directives are skipped before label protection in every reader, including Sankey CSV; quoted CSV fields and free-text titles preserve literal `%%`. Trailing `%%` comments are stripped before directive recognition, including after a terminating semicolon; quoted directive values retain literal `%%`. Frontmatter title is retained; configuration and initialization directives remain inert and produce `mermaid-degraded`. Type-specific directives require their complete grammar: Gantt `click id href "url"` / `click id call callback(args)` (either or both, either order) and treemap `classDef` stay inert with notes; quadrant `classDef` resolves point styles. Other chart types do not accept these statements as directives. Directive-like words in labels are preserved, and malformed statements use the named syntax error rather than silently disappearing. Configuration-driven themes, dimensions, donut holes, pie highlighting, data-label switches and browser interactions are not applied. Explicit documented options also receive an individual `mermaid-degraded` note naming the replacement:

| Source option | Replacement and limitation |
| --- | --- |
| `pie.textPosition` | Outside callouts; arc labels have no radial-position option. |
| `pie.legendPosition` | Bottom legend. Native `spec.legend` supports bottom/inside corners, but source configuration stays inert. |
| `pie.donutHole` | Solid pie. Native `arc.options.innerRadius` supports holes, but source configuration stays inert. |
| `pie.highlightSlice` | Unhighlighted slices; static arcs have no highlight/hover state. |
| `sankey.nodeAlignment` | Native depth columns; no alignment option. |
| `sankey.nodeColors` | Default per-source palette. Native `mark.options.color` supports per-source hex colors, but independent target-node colors are unavailable. |
| `sankey.linkColor` | Source-colored links. Native colors support source/constant hex colors; target/gradient links are unavailable. |
| `sankey.labelStyle` | Plain node labels; no text outlines. |
| `sankey.nodeWidth`, `sankey.nodePadding` | One-cell bars and native cell padding; no pixel-size options. |
| `sankey.showValues`, `prefix`, `suffix` | Native node totals/flow values with no prefix/suffix; no value-label switch/formatter. |
| `width`, `height` | Caller-supplied columns/rows; source pixel dimensions are inert. |

Accessibility title/description statements become description metadata. Quadrant points retain the native visible 2×2 sub-cell dot cluster in braille; endpoint formatters hide intermediate ticks without thinning notes. Native renderer notes still report space-driven label dropping, visible tick thinning and flow folding; arbitrary label density cannot guarantee a lossless 72-column rendering.

Malformed source throws an error with `code: "GLYPH_MERMAID_SYNTAX"`. Every other Mermaid header throws `code: "GLYPH_MERMAID_NOT_CHART_TYPE"` before parsing its body, so a dispatcher can route it. These source-reader errors are separate from chart-spec validation rules. Rendering options retain the ordinary renderer's validation errors.

Kanban skips whitespace-only lines. Its title/accessibility directives must be unindented; indented names beginning with `title` remain columns or cards. Single-quoted metadata follows YAML quoting: backslashes are literal, doubled apostrophes represent one apostrophe. Lane widths minimize wrapped card/metadata rows before balancing spare space; lanes in each row share a bottom border. Only empty lanes reserve an empty-body row. The shared chart scanner also keeps title-like text inside nested lists and quoted labels as data.

Kanban examples and feature regressions live in `src/mermaidKanban.test.ts`, including the [official full example](https://mermaid.js.org/syntax/kanban.html). Write every example verbatim as chat/box and web/braille output at 72 columns, plus a local HTML preview, with `GLYPH_KANBAN_ARTIFACT=/absolute/local/directory/t6c.txt pnpm --filter @glyphcss/charts exec vitest run src/mermaidKanban.test.ts` from the repository root. Web uses the existing whole-cell rectangular junction family within its default braille tier.

Timeline/packet examples and feature regressions live in `src/mermaidTimelinePacket.test.ts`. Write every example verbatim as chat/box and web/braille output at 72 columns, plus a local HTML preview, with `GLYPH_TIMELINE_PACKET_ARTIFACT=/absolute/local/directory/t6b.txt pnpm --filter @glyphcss/charts exec vitest run src/mermaidTimelinePacket.test.ts` from the repository root. Syntax coverage follows the official [timeline](https://mermaid.js.org/syntax/timeline.html) and [packet](https://mermaid.js.org/syntax/packet.html) documentation; configuration remains inert.

Journey examples and feature regressions live in `src/mermaidJourney.test.ts`. To write every journey example as verbatim chat/box and web/braille renders at 72 columns, plus a local HTML preview, run `GLYPH_JOURNEY_ARTIFACT=/absolute/local/directory/t6a.txt pnpm --filter @glyphcss/charts exec vitest run src/mermaidJourney.test.ts` from the repository root.

The source fixtures in `src/fixtures/mermaidExamples.json` cover the other initial chart examples. To write their verbatim 72-column renders, run `GLYPH_MERMAID_ARTIFACT_DIR=/absolute/local/directory pnpm --filter @glyphcss/charts exec vitest run src/mermaid.test.ts` from the repository root.

## Agent / CLI entry

```ts
import { renderGlyphChartJson } from "@glyphcss/charts";

renderGlyphChartJson(JSON.stringify([3, 5, 2, 8]), { target: "chat" });
// '{"text":"...","meta":{...},"report":{...}}' on success,
// '{"error":"...","code":"empty-marks","hint":"..."}' on a validation failure.
```

```sh
glyphcss chart spec.json --target terminal --width 80 --height 24
```
(part of `@glyphcss/compile`'s CLI — ANSI on a TTY, plain text on a pipe, `--color` always overrides.)

## What's not here yet

React/Vue bindings and a Vega-Lite adapter — see `CHARTS-RESEARCH/PLAN.md` for the phased roadmap.

Mermaid source preprocessing shares `@glyphcss/core/mermaid` with diagrams: BOM/CRLF, frontmatter, comment/directive spans and the full HTML/Mermaid entity table (including `&copy;`, `#copy;`, decimal and hexadecimal references). Decoding happens once; grammar-specific label and CSV parsing stay in charts.

The band-layout regression catalogue covers every Mermaid chart type and the remaining native marks. Generate verbatim chat renders at 72×24, web renders at 72 columns, and full web defaults (braille), plus a local HTML preview, with `GLYPH_BAND_ARTIFACT=/absolute/local/directory/g1.txt pnpm --filter @glyphcss/charts exec vitest run src/bandLayout.test.ts` from the repository root.

Web-target regressions live in `src/mermaidWeb.test.ts`. Set `GLYPH_C_WEB_ARTIFACT=/absolute/local/directory/c-web.txt` when running that test to write verbatim chat 72×24, web 96×32 and web 72×24 renders, a local HTML preview and native fixture hashes.
