# @glyphcss/compile

Compile 3D meshes to **static glyphcss ASCII at build time** — a Vite plugin, a
CLI, and a Node API. Because glyphcss renders to a single `<pre>` of text, a
scene can be rendered ahead of time and inlined into HTML with **zero runtime
JS**. Defaults match the glyphcss library exactly, so a compiled scene is
byte-identical to what the runtime would render for the same inputs.

## Vite plugin

```ts
// vite.config.ts
import { glyphcssCompile } from "@glyphcss/compile/vite";
export default { plugins: [glyphcssCompile()] };
```

```ts
// import a mesh with `?glyph` → the build-time-rendered <pre> string
import dog from "./dog.glb?glyph&autoCenter=1&rotX=60&rotY=45&zoom=0.5&cols=80&rows=30";
document.querySelector("#app").innerHTML = dog; // no runtime, no WebGL
```

Works in any Vite pipeline — Astro, vanilla Vite, Vite-React (import the string
and inject it). Query params map to the options below.

## CLI

```sh
# Raw ASCII to the terminal — auto-fits the grid to the content (no cols/rows needed)
glyphcss-compile dog.glb --auto-center --no-colors

glyphcss-compile dog.glb --fit 60 --no-colors    # fit width to 60 columns
glyphcss-compile dog.glb --pre > dog.html         # wrap in <pre>
glyphcss-compile dog.glb --full -o dog.html       # full HTML document
```

Prints **raw text** by default (terminal-friendly, no `<pre>`); omit `--cols`/`--rows`
and it auto-fits the grid + zoom to the model, cropped tight. The universal escape
hatch — works in any pipeline (Hugo, Eleventy, CI, a Makefile).

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
| Zoom | `zoom` / `--zoom` | 0.3 |
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
glyphcss-compile dog.glb --interactions orbit,zoom --auto-center --full -o dog.html
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

- **Textures**: per-cell texture sampling needs browser image decoding, so the
  static compile renders from material / vertex colors (the same fallback the
  runtime uses before its async samplers resolve).
