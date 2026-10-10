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

Every constructor returns a plain `GlyphChartMark` value: `glyphChartLine(data, channels?, options?)`, `glyphChartArea`, `glyphChartBar`, `glyphChartDot`, `glyphChartArc`, `glyphChartRect`, `glyphChartCell`, `glyphChartText`, `glyphChartRule(values, { axis? })`. `channels` maps `x`/`y`/`fill`/`stroke`/`label` to a field name, an accessor `(datum, index) => value`, or a literal array running parallel to `data`. Channel type inference copies Plot: a `Date` value infers `time`, a `string` infers `band` (ordinal) — unless every string in the channel is itself a calendar-valid ISO date, which infers `time` instead — a `number` infers `linear`. Every constructor also accepts `options.name?: string` — a series name shown in the legend, independent of any categorical `fill`/`stroke` split (see "Legends"). `line`, `rule`, and an `area`'s own boundary line accept `options.strokeWidth?: 1 | 2 | 3` (default `1`) — `ascii`/`box` widen by substituting a heavier glyph on the same cells; `blocks`/`braille` widen with real sub-cell dot ink. Two more constructors are non-cartesian, like `arc`: `glyphChartSankey(data, { source, target, value, name?, color? })` and `glyphChartFunnel(data, { stage?, value?, name?, color? })`.

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

Bar heights are proportional to values, measured from the axis LINE — which sits on the y=0 row itself (an interior row for a mixed-sign domain, the plot's own bottom row otherwise), so a bar always touches it, never floating a row above a separately-drawn line. Zero paints nothing; both signs exclude the baseline. A positive, unstacked `█` bar ends in a lower eighth block (`▁`–`▇`) for its last fraction of a row, so values whole cells would round together stay distinct; shaded series, `ascii`, negative bars and stack segments keep whole cells. Bar, rect and area inferred y-domains include zero; an explicit domain excluding zero rejects with `bar-domain-excludes-zero`. Stacked bars/areas paint the transform’s `y0`→`y1` bounds.

```ts
renderGlyphChart(glyphChartBar([3, -5, 2, 8]), { target: "chat", width: 40, height: 14 });
```
```
   │                                ████
   │                                ████
   │                                ████
 5 ┤                                ████
   │▃▃▃                             ████
   │███                 ▄▄▄▄▄▄      ████
   │███                 ██████      ████
 0 ├┬───────────┬──────────┬───────────┬
   │         ██████                     
   │         ██████                     
   │         ██████                     
   │         ██████                     
-5 ┤         ██████                     
    0           1          2           3
```

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

The disc is a genuine circle on screen (its radius is split by the canvas's own `cellAspect`, never fit independently per axis) and never touches the plot rect edge (`GLYPH_CHART_ARC_FILL = 0.8`). `options.labels: "callout" | "legend-only"` (default `"callout"`) draws a leader line from each slice whose own angular span is at least 8° out to a `name · NN%` label beside the disc — left half left, right half right, same-side labels stacked one row apart and dropped (`label-dropped`) when a side runs out of room; `"legend-only"` paints just the disc, leaving identification to the legend row.

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

Both axes band-scale string categories. Numeric `fill` uses one shared monotone shade ramp: sequential for same-sign data, diverging around zero for mixed signs. `[-10, 0, 10]` yields full ink, blank, full ink — blank means "no signal" (reserved for exactly zero on the diverging ramp), never the domain's most extreme value; each side ramps independently from zero out to its own extreme.

```ts
const data = [];
for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) data.push({ x: String(x), y: String(y), v: x * y });
renderGlyphChart(glyphChartCell(data, { x: "x", y: "y", fill: "v" }), { target: "chat", width: 40, height: 14 });
```
```
  │          ▒▒▒▒▒▒▒  ▓▓▓▓▓▓▓  ███████  
  │          ▒▒▒▒▒▒▒  ▓▓▓▓▓▓▓  ███████  
2 ┤          ▒▒▒▒▒▒▒  ▓▓▓▓▓▓▓  ███████  
  │          ▒▒▒▒▒▒▒  ▓▓▓▓▓▓▓  ███████  
  │          ▒▒▒▒▒▒▒  ▓▓▓▓▓▓▓  ███████  
  │          ░░░░░░░  ▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒  
  │          ░░░░░░░  ▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒  
1 ┤          ░░░░░░░  ▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒  
  │          ░░░░░░░  ▒▒▒▒▒▒▒  ▒▒▒▒▒▒▒  
  │                                     
  │                                     
0 ┤                                     
  └────┬────────┬────────┬────────┬─────
       0        1        2        3     
```

### `glyphChartText`

```ts
renderGlyphChart(glyphChartText([{ x: 1, y: 1, label: "hi" }], { x: "x", y: "y", label: "label" }), { target: "chat", width: 20, height: 10 });
```
```
                    
                    
                    
                    
         hi         
                    
                    
                    
                    
                    
```

### `glyphChartRect`

Like `bar`, but drawn as a plain 1-cell-wide column at each `x`/`y` pair rather than a band-scaled bar — the primitive a `bin`-transformed histogram paints into.

### `glyphChartSankey`

Non-cartesian, like `arc`. `{ source, target, value }` name channels the way every other mark does. Node columns are laid out by depth (`d3-sankey`); row height is ∝ throughput under ONE global rows-per-unit scale (never independently normalised per column, which could draw a larger value thinner than a smaller one elsewhere), and a flow's band is ∝ value at BOTH ends — every row split uses the same cumulative-rounding technique `bar`/`rect` dodging uses, so a node's own row height and the sum of its outgoing/incoming band rows always conserve exactly, and folding a too-small flow into a single `(other)` band iterates to a fixed point (`sankey-folded-flows`). A gap row (`GLYPH_CHART_SANKEY_NODE_PADDING_ROWS`, `GLYPH_CHART_SANKEY_LINK_GAP_ROWS`) is reserved BEFORE that split — between stacked node boxes in one column, and between consecutive bands leaving or entering one node — so a box is visibly shorter than its column and bands don't stack edge to edge; the gap is a planned absence baked into the row math itself, degrading toward 0 (never below 1 row for a band) when the plot is too tight to afford it. Each band of k rows is painted as k parallel single-cell-wide routes through the cell canvas's own edge/route contract on `ascii`/`box` (a rounded corner at each turn, its own series glyph one step lighter on a straight run) or as a genuine per-dot-column smooth ribbon on `braille`/`blocks`, each reserving a column within an interval-coloured ribbon — two bands share a ribbon slot only when their vertical extents never overlap, so two overlapping crossing bands land on different columns and a crossing reads as two bands passing rather than one erasing the other (`sankey-crossings-merged` when a gap is too narrow for every ribbon). A row's own first and last cell (touching its source/target border) are claimed with absolute priority ahead of any other band's transit, so every band reaches both its own borders regardless of any crossing through it; `report.routeConflicts` is not fully empty in practice (two ribbons sharing one border column can still coincide at a single cell along their own axis), but a conflict cell always paints a real contending band's own colour, never a blank or foreign one. A non-terminal node whose inflow and outflow disagree gets `sankey-imbalance`; a nonpositive value or a missing channel rejects with `sankey-bad-value` (a non-finite value in the data itself rejects earlier and generically with `non-finite-data`); a typo'd channel name rejects with `sankey-missing-channel` rather than a misleading cycle error; a genuine cycle rejects with `sankey-cycle`. Legend: one entry per source node.

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
┌────────┐█▓▓▓▓▓▓▓▓█┌────────┐▚▚▚▚▚▚▚▚▚▚┌────────┐
│        │█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│        │
│  Coal  │█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│        │
│        │█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│        │
└────────┘█▓▓▓▓▓▓▓▓█│        │▚▚▚▚▚▚▚▚▚▚│ Homes  │
                    │        │▚▚▚▚▚▚▚▚▚▚│        │
          ╭░░░░░░░░░│ Power  │▚▚▚▚▚▚▚▚▚▚│        │
┌────────┐░╭░░░░░░░░│        │▚▚▚▚▚▚▚▚▚▚│        │
│        │░╯╭░░░░░░░│        │        ╰▚└────────┘
│        │░░╯╭░░░░░░│        │▚                   
│  Gas   │░░░╯╭░░░░░│        │▚╮                  
│        │░░░░╯╭░░░░│        │▚▚▚▚▚▚▚▚▚▚┌────────┐
│        │░░░░░╯╭░░░└────────┘▚╰▚▚▚▚▚▚▚▚│Industry│
│        │░░░░░░╯░              ╰▚▚▚▚▚▚▚│        │
└────────┘░░░░░░░╯               ╰▚▚▚▚▚▚└────────┘
   █  Coal          ░  Gas         ▚  Power       
```

### `glyphChartFunnel`

Non-cartesian, like `arc`/`sankey`. `data` is ordered `{ stage, value }` records (or a bare `number[]`, stage = index) — every row is its own stage even when two share a label. Every stage gets an EQUAL row band; only the bar's WIDTH is proportional to value/max, centred between a label column (stage name, right-aligned) and a `value · NN%` readout on the right — never an equal-step trapezoid. More stages than the plot has rows folds the tail into one "other (k more)" stage rather than dropping it silently (`funnel-folded-stages`). A negative value rejects with `funnel-bad-value`; an all-zero funnel draws nothing (`empty-total`); a nonpositive first-stage value omits every percentage rather than printing a fabricated `0%` (`funnel-bad-reference`). A stage exceeding the one above it renders in place and logs `funnel-not-monotone`; a proportional width under one cell draws a one-cell stub and logs `funnel-thin-stage`. Legend defaults OFF (the stage labels already carry identity); pass `legend: true` to list the stages anyway.

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
             ████████████████████████████████████               
       Visits████████████████████████████████████  10,000 · 100%
             ████████████████████████████████████               
                                                                
                        ░░░░░░░░░░░░░░                          
Product Views           ░░░░░░░░░░░░░░             4,000 · 40%  
                        ░░░░░░░░░░░░░░                          
                                                                
                             ▚▚▚▚                               
  Add to Cart                ▚▚▚▚                  1,000 · 10%  
                             ▚▚▚▚                               
                                                                
                               ╱                                
     Checkout                  ╱                   400 · 4%     
                               ╱                                
                                                                
                               ▌                                
     Purchase                  ▌                   260 · 3%     
                               ▌                                
                                                                
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

`spec.axes?.{x,y}: { ticks?, tickMarks?, title?, grid? }`. Tick marks are on by default — `┤`/`┬` where a tick actually lands, `│`/`─` elsewhere, `└` at the corner (`+` on every stem under `charset: "ascii"`, since its own junction table already collapses every multi-stem glyph to that):

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

A bare string is sugar for `{ preset: "<name>" }`; `"auto"` (and an absent `format`) is a no-op, so a default chart is byte-identical to one built before `format` existed. A formatted numeric label that overflows its cell budget still follows the existing abbreviate-or-drop policy: a preset's own SI fallback runs first where it has one (`number`, `integer`, `currency`); otherwise the label drops, never truncates into a shorter-but-wrong number (`"1,234.00"` never becomes `"1,2"`). A callback's return value is opaque text the library can't parse back into a number, so it's always treated as a category label — elided with `…` rather than dropped. Applies to axis ticks only, never an arc's own callout percentage or a funnel's value·percent label.

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

Categorical `fill` or `stroke` splits line, area, dot, bar, rect and cell rows into separate series. Each appears in `meta.series` and the legend, alongside any named marks (see "Legends"). Colour uses distinct series colours. A LINE/area-boundary series monochrome-cycles solid/dashed/dotted/double strokes; a REGION mark's fill (bar/rect/area) instead carries series identity through its own glyph — a SHAPE-FAMILY set (`█ ░ ▚ ╱ ▌ ═ ▓ ▒` in box/blocks/braille, `# . @ -`/`# . = / @ : | -` in ASCII below/above 4 series — see the pie section above) wherever colour cannot tell series apart, so a stacked/dodged chart stays readable in Copy ASCII; its legend swatch is that same glyph, never a line style. `regionFill: "auto" | "solid" | "texture"` (default `"auto"`) swaps that glyph for a solid `█` (`#` on ascii) in the colour-carrying exits only — `html` under `css`, `text` under an ANSI mode — when colour is on, the target is not `terminal`/`chat`, and no two region series (sankey sources and funnel stages included) share a colour at the render's own depth (ansi16 maps the default blue and green to one colour). `build.canvas` and plain `text` always keep the textures. `glyphChartRegionFill(input, options)` returns the decision and a one-sentence reason; an explicit `"solid"` that would make two series identical is refused with a `region-fill-solid-refused` ledger entry. Past 8 series in one shade family the cycle wraps and `report.ledger` gets a `series-shade-repeat` entry per repeated pair. A `dot` mark's glyph is a distinct whole-cell shape (`● × + ◆`/ASCII `o x + *`) on `ascii`/`box`; under `braille`/`blocks` every point instead paints a full 2×2 sub-cell dot cluster (4 dots, positioned at the exact sub-cell coordinate) regardless of series or colour, since a single dot there measures under 2px — colour carries series identity for dots at that resolution. The frozen canvas logs its existing solid fallback for double diagonals. Categorical dot y-values paint on band centres. `size`, `shape`, and `curve` are unsupported and removed from the public types/schema; supplied values reject instead of being ignored.

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
