# @glyphcss/compile

Compile 3D meshes to **static glyphcss ASCII at build time** — a Vite plugin, a
CLI, and a Node API. Because glyphcss renders to a single `<pre>` of text, a
scene can be rendered ahead of time and inlined into HTML with **zero runtime
JS**. Defaults match the glyphcss library exactly, so a compiled scene is
byte-identical to what the runtime would render for the same inputs.

Full documentation: **https://glyphcss.com**

## Vite plugin

```ts
// vite.config.ts
import { glyphcssCompile } from "@glyphcss/compile/vite";
export default { plugins: [glyphcssCompile()] };
```

```ts
// import a mesh with `?glyph` → the build-time-rendered <pre> string
import dog from "./dog.glb?glyph&autoCenter=1&rotX=60&rotY=45&zoom=25&cols=80&rows=30";
document.querySelector("#app").innerHTML = dog; // no runtime, no WebGL
```

Works in any Vite pipeline — Astro, vanilla Vite, Vite-React (import the string
and inject it). Query params map to the options below.

## Install

```sh
npm i -g @glyphcss/compile     # global `glyphcss` command
# or run ad hoc:
npx @glyphcss/compile cube --auto-center
# or as a build dep (Vite plugin / Node API):
npm i -D @glyphcss/compile
```

It pulls in `glyphcss` + `@glyphcss/core` automatically. Ships a
[**skill**](./SKILL.md) (`SKILL.md`) so coding agents know how to drive the CLI.

## CLI

```sh
glyphcss cube --auto-center               # a primitive shape → color ASCII
glyphcss dog.glb --auto-center            # a mesh file → ANSI color in the terminal
glyphcss --polygons-json '[{"vertices":[[0,0,0],[2,0,0],[1,2,0]],"color":"#f00"}]'
glyphcss dog.glb -f text                  # plain ASCII
glyphcss dog.glb -f full -o dog.html      # full HTML document
glyphcss dog.glb --fit 60 -f text         # fit width to 60 columns
glyphcss model.obj --mtl other.mtl        # explicit OBJ material override
```

Input is a **mesh file** (`.obj/.glb/.gltf/.vox/.stl`), a **primitive shape** name
(`cube`, `sphere`, `icosahedron`, `torus`, `cone`, … — 44 shapes), or **custom
polygons** (`--polygons FILE.json` / `--polygons-json '…'`, an array of
`{ vertices, color? }`).

Output **`-f, --format`**: `ansi` (truecolor terminal), `text` (plain), `html`
(a `<pre>`), or `full` (HTML doc). The default picks by destination — **terminal →
ansi**, `-o` file → html, piped → text. Omit `--cols`/`--rows` and it auto-fits
the grid + zoom to the model, cropped tight (give just one and the other adapts).
The universal escape hatch — works in any pipeline (Hugo, Eleventy, CI, a Makefile).

### Diagrams

`glyphcss diagram <file.mmd|graph.json>` is the single Mermaid entry. It dispatches
flowchart/graph, stateDiagram, sequenceDiagram, classDiagram, erDiagram, mindmap,
gitGraph, block, architecture, requirementDiagram and all five C4 headers to
`@glyphcss/diagrams` (sequence uses `./sequence`; Git source uses the root's lane
adapter). Pie, xychart, sankey, quadrantChart, gantt, radar, treemap, journey,
timeline, packet and kanban use `@glyphcss/charts`. Beta/version aliases follow
the packages' readers. JSON remains `{ nodes, edges, direction?, groups? }`,
with direction defaulting to `TB`.

Source configuration and interactions remain inert. Reader errors retain their
named codes: charts signal `GLYPH_MERMAID_NOT_CHART_TYPE` only to dispatch;
unknown kinds preserve `GLYPH_MERMAID_UNSUPPORTED_<HEADER>`. Malformed chart
bodies never fall through to a different reader. Graph direction/spacing/engine
flags are ignored with `mermaid-option-ignored` for charts, sequences and Git
history; `--detail` applies to graphs/charts. `--title` applies to diagrams;
charts retain their source title and log that override as ignored. Sequence
preamble metadata/init are inert and logged; `--title` still overrides its title.
The separate `chart` command continues to accept chart JSON and 3D options.

```sh
npm install -D @glyphcss/compile
printf 'flowchart LR; input[Input] --> render[Render]\n' > graph.mmd
npx glyphcss diagram graph.mmd --width 60 --height 20
npx glyphcss diagram graph.mmd --charset ascii --color none -o graph.txt
npx glyphcss diagram graph.mmd --direction TB --engine dagre --nodesep 3 --ranksep 3 --title Pipeline --detail balanced
```

The default target is `terminal`: stdout TTY selects ANSI, a pipe selects plain
text, and `--color` overrides either. `NO_COLOR` and `FORCE_COLOR` follow the
renderer’s environment rules. `--color css` emits escaped HTML. Fidelity ledger
entries go to stderr, so redirected stdout contains only the diagram.
`--target chat|terminal|web`, `--charset ascii|box|blocks|braille`, `--width`,
`--height`, and `--detail auto|faithful|balanced|simplified` match the diagram API.
Read and validation failures preserve their rule ids and exit with status 1.

## Node API

```ts
import { compileFile, compileScene, loadMeshFromFile } from "@glyphcss/compile";

const { html, inner, cols, rows } = await compileFile("dog.glb", { autoCenter: true });
// or, with polygons you already have:
const { html } = compileScene({ polygons, cols: 80, rows: 24 }); // pure, no DOM
```

## Options (query params / CLI flags / `CompileFileOptions`)

| Option | Query / flag | Default (library) |
|---|---|---|
| Camera angle | `rotX` `rotY` / `--rot-x` `--rot-y` | 65 / 45 |
| Zoom | `zoom` / `--zoom` | 0.65 |
| Projection | `projection=orthographic` / `--ortho` | perspective |
| Grid | `cols` `rows` `cellAspect` / `--cols` … | 80 / 24 / 2.0 |
| Render mode | `mode` / `--mode` | solid |
| Palette | `palette` / `--palette` | default |
| Colors | `colors=0` / `--no-colors` | on |
| Recenter mesh | `autoCenter=1` / `--auto-center` | off |
| Mesh optimize | `meshResolution` / `--mesh-resolution` | lossy |

> Defaults are the **library** defaults (`createGlyphScene`). A loaded mesh is
> not recentered or auto-fit unless you ask — pass `autoCenter` + a camera/zoom
> to frame a model, the same as `<glyph-mesh>` in the runtime.

## Interactive export

Declare the interactions you want; only those ship. The manifest drives both the
wired control (the snippet imports just that one) and the decimation budget
(coarser for orbit, finer when `zoom`/`fpv` let the camera get close):

```sh
glyphcss dog.glb --interactions orbit,zoom --auto-center --full -o dog.html
```

```ts
import { compileInteractive, toCodepenPrefill } from "@glyphcss/compile";

const r = await compileInteractive("dog.glb", { interactions: ["orbit", "zoom"], autoCenter: true });
r.html;            // self-contained: <div> + <script type=module> (glyphcss from CDN, mesh inlined)
r.polygonCount;    // triangles shipped after decimation (vs r.sourcePolygonCount)
toCodepenPrefill(r); // → { action, data } to POST a new CodePen
```

The pure, browser-safe builder is `buildGlyphInteractiveExport(polygons, opts)` in
`glyphcss` — the gallery's "CodePen" button calls it directly on the loaded mesh.

| `interactions` | Ships |
|---|---|
| `[]` | static scene, no control |
| `["orbit"]` | orbit control, coarse decimation |
| `["orbit","zoom"]` | + wheel zoom, finer decimation |
| `["pan","zoom"]` | map controls |
| `["fpv"]` | first-person controls, finest decimation |

## Notes

- **Textures**: the CLI / Node API decode PNG/JPG and bake each face to its
  sampled color, so external (OBJ + `.mtl`) textures render in **true color** in
  the terminal. GLB-embedded textures fall back to material/vertex colors. The
  pure `compileScene` stays DOM-free — decoding lives in `loadMeshFromFile`.
