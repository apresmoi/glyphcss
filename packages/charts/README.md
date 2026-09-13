# @glyphcss/charts

A declarative, [Observable Plot](https://observablehq.com/plot/)-flavoured chart spec rendered as ASCII/box/braille output for chat, terminal, and web — built on [`glyphcss`](https://www.npmjs.com/package/glyphcss)'s cell canvas. No camera, no mesh, no DOM required to render: `renderGlyphChart` is a pure function from a spec to a string.

See `AGENTS.md`'s "Charts" section (contract) and `docs/design/charts.md` (rationale, measurements) in the [glyphcss repo](https://github.com/apresmoi/glyphcss) for the full design record.

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
2 └┴───────────┴──────────\//──────────┴
   0           1           2           3
```

A bare `number[]` infers `x = index, y = identity` — the same shorthand `Plot.lineY([3,5,2,8])` uses. `renderGlyphChart` also accepts a lone mark, an array of marks, or a full `glyphChartPlot({ marks, title?, description? })` spec.

## Marks

Every constructor returns a plain `GlyphChartMark` value: `glyphChartLine(data, channels?, options?)`, `glyphChartArea`, `glyphChartBar`, `glyphChartDot`, `glyphChartArc`, `glyphChartRect`, `glyphChartCell`, `glyphChartText`, `glyphChartRule(values, { axis? })`. `channels` maps `x`/`y`/`fill`/`stroke`/`label` to a field name, an accessor `(datum, index) => value`, or a literal array running parallel to `data`. Channel type inference copies Plot: a `Date` value infers `time`, a `string` infers `band` (ordinal), a `number` infers `linear`. Every constructor also accepts `options.name?: string` — a series name shown in the legend, independent of any categorical `fill`/`stroke` split (see "Legends").

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
2 └┴──────────\/───────────┴───────────┴
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
0 └┴───────────┴───────────┴───────────┴
   0           2           4           6
```

### `glyphChartBar`

Bar cell heights are proportional to values within one cell, measured from the axis LINE — which sits on the y=0 row itself (an interior row for a mixed-sign domain, the plot's own bottom row otherwise), so a bar always touches it, never floating a row above a separately-drawn line. Zero paints nothing; both signs exclude the baseline. Bar, rect and area inferred y-domains include zero; an explicit domain excluding zero rejects with `bar-domain-excludes-zero`. Stacked bars/areas paint the transform’s `y0`→`y1` bounds.

```ts
renderGlyphChart(glyphChartBar([3, -5, 2, 8]), { target: "chat", width: 40, height: 14 });
```
```
   │                                ████
   │                                ████
   │                                ████
 5 ┤                                ████
   │                                ████
   │███                             ████
   │███                 ██████      ████
 0 ├┴───────────┴──────────┴───────────┴
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
2 └┴───────────●───────────┴───────────┴
   0           2           4           6
```

### `glyphChartArc` (pie/donut)

An arc/text-only spec draws no cartesian axis. Record arcs require the value channel `y`; categories use `fill`, falling back to `label`, then the row index. Missing `y` rejects with `arc-missing-value`. Numeric arrays use each element as the value and its index as the category. Positive categories become `meta.series` and legend entries; repeated categories sum into one slice. Nonpositive values occupy no angle, and an all-zero pie is empty with an `empty-total` ledger entry. Pass `options.innerRadius` (`0 <= radius < 1`) for a donut hole.

```ts
const data = [
  { browser: "Chrome", share: 65 },
  { browser: "Safari", share: 20 },
  { browser: "Firefox", share: 15 },
];
renderGlyphChart(glyphChartArc(data, { fill: "browser", y: "share" }), { target: "chat", width: 40, height: 14 });
```
```
                                        
         ▒▒▒▒▒▒▒▒▒▒▒███████████         
     ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒███████████████     
   ▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒█████████████████   
  ▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒██████████████████  
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒███████████████████ 
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓████████████████████
 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓███████████████████████ 
  ▓▓▓▓▓▓▓▓▓███████████████████████████  
   ▓▓▓▓██████████████████████████████   
     ██████████████████████████████     
         ██████████████████████         
                                        
█  Chrome    ▓  Safari    ▒  Firefox    
```

Slices cycle `█ ▓ ▒ ░` in box/blocks/braille and `# % + .` in ASCII. The closing shade advances if it would match the first, so adjacent slices differ. The legend shows each slice's glyph swatch; colour adds matching palette colours to slices and swatches. Shades still cycle with colour enabled, preserving slice proportions when colour is removed downstream.

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
  └────┴────────┴────────┴────────┴─────
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
0 └┴──────────────┴───────────────┴──────────────┴
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
0 └┴───────────\/─────────────┴────────────┴
   0            2             4            6
     ───Revenue            ── Visits        
```

Distinct swatches: a solid rule for the first series, a dashed one for the second — the same `SERIES_STYLES` cycle a categorical `fill`/`stroke` split already uses. Colour-enabled renders use distinct palette colours instead. `legend: false` hides the row without changing `meta.series`.

## Axes

`spec.axes?.{x,y}: { ticks?, tickMarks?, title?, grid? }`. Tick marks are on by default — `┤`/`┴` where a tick actually lands, `│`/`─` elsewhere, `└` at the corner (`+` on every stem under `charset: "ascii"`, since its own junction table already collapses every multi-stem glyph to that):

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
2 └──────┴───────────┴──────────\/───────────┴───────────┴──────
        Jan         Feb         Mar         Apr         May     
                               month                            
                          ───Revenue                            
```

`y`'s title (`value`, defaulted from the channel field name) sits top-left above the axis — a rotated column of glyphs has no character-grid analogue — while `x`'s title (`month`) is centred under its own tick-label row. An auto title like these only shows with genuine room for it (`rows >= 20` for the x title, `cols >= 60` for the y title, hence the larger canvas above) and a field name longer than two characters; an EXPLICIT `axes.x.title`/`axes.y.title` (including `""` to suppress the default) always shows regardless of size. `tickMarks: false` on either axis reverts to a plain, undecorated rule. Index/integer data never shows a fractional tick (`0.5`, `1.5`, …), even where d3's own "nice" ladder for a small domain would otherwise reach for one.

## Scales, series and labels

`scales.x/y.type` supports `linear`, `log`, `sqrt`, `time`, `band`, and `ordinal` (band). Log and square-root scales use d3's actual transforms. Log domains containing zero or crossing sign reject with `log-domain`; zero-anchored bars/rects therefore need a zero-capable scale. Time domains accept calendar-valid ISO strings, parsed once; invalid ones reject with `bad-time-domain`. Intraday ticks use d3's multi-scale time format. `nice: true` enables d3 domain nicening.

Categorical `fill` or `stroke` splits line, area, dot, bar, rect and cell rows into separate series. Each appears in `meta.series` and the legend, alongside any named marks (see "Legends"). Colour uses distinct series colours. A LINE/area-boundary series monochrome-cycles solid/dashed/dotted/double strokes; a REGION mark's fill (bar/rect/area) instead carries series identity through its own glyph (`█ ▓ ▒ ░`/`# % + .`), unconditionally — with colour on or off — so a stacked/dodged chart stays readable in Copy ASCII; its legend swatch is that same glyph, never a line style. A `dot` mark's glyph is a distinct whole-cell shape (`● × + ◆`/ASCII `o x + *`) on `ascii`/`box`; under `braille`/`blocks` every point instead paints a full 2×2 sub-cell dot cluster (4 dots, positioned at the exact sub-cell coordinate) regardless of series or colour, since a single dot there measures under 2px — colour carries series identity for dots at that resolution. The frozen canvas logs its existing solid fallback for double diagonals. Categorical dot y-values paint on band centres. `size`, `shape`, and `curve` are unsupported and removed from the public types/schema; supplied values reject instead of being ignored.

All strings pass through the canvas's text fold. ASCII output is 7-bit, including `-`, a three-cell `...`, accented titles and text marks. Axis labels use the same slot-aware abbreviation policy as other labels: SI first, then elision, with ledger entries. Crowded category labels thin every kth tick; numeric/time collisions also thin. Labels never rely on canvas clipping.

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
2 └┴───────\/────────┴────────┴────────┴────
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
2 └┴────────⠻────────┴────────┴────────┴────
   0        2        4        6        8    
```
Real, unedited output from both calls. `box` uses 12 distinct glyphs: the two slope glyphs `/`/`\`, five tick digits (`0`/`2`/`4`/`6`/`8`), and five whole-cell axis/junction glyphs `│`/`─`/`┤`/`┴`/`└`. `braille` uses 40 distinct glyphs total — the same five tick digits and five axis/junction glyphs, unchanged from `box`'s own, plus 30 distinct actual braille dot patterns for the data line, never `/`/`\`.

The `/charts` page applies target defaults to untouched controls and preserves explicit overrides per control. **Reset to target defaults** clears them. Terminal previews show plain text with a note that escapes are in **Copy ANSI**; CSS/web output shows HTML. **Copy as text** always copies plain text. ANSI escapes are never inserted into the browser preview.

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

React/Vue bindings, a website URL codec/orbit, Mermaid-style diagrams (`@glyphcss/diagrams`, a later phase), and a Vega-Lite adapter — see `CHARTS-RESEARCH/PLAN.md` for the phased roadmap.
