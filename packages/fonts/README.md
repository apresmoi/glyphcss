# @glyphcss/fonts

Turn **fonts + text into extruded 3D polygon meshes** for [glyphcss](https://github.com/apresmoi/glyphcss). Framework-agnostic: it returns plain `Polygon[]`, so the same call works in the vanilla, React, and Vue renderers — no per-framework wrappers.

```bash
pnpm add @glyphcss/fonts glyphcss
```

```ts
import { loadGoogleFont, textPolygons } from "@glyphcss/fonts";
import { createGlyphScene, createGlyphOrthographicCamera } from "glyphcss";

const font = await loadGoogleFont({ /* FontEntry from listGoogleFonts() */ }, 700);
const polygons = textPolygons(font, "Hello", { depth: 24, profile: "bevel" });

const scene = createGlyphScene(host, { camera: createGlyphOrthographicCamera({ rotX: 28, zoom: 0.06 }) });
scene.add(polygons);
```

## Two layers

**Pure** (no browser globals — runs in Node too):

- `parseFont(bytes)` → `ParsedFont` — a small, dependency-free TrueType (`glyf`) reader: sfnt tables → glyph outlines + advance widths.
- `textPolygons(font, text, options)` → `Polygon[]` — triangulates caps (holes included), builds the depth profile, extrudes, and lays glyphs out by advance width.
- `composeText(font, text, options)` → `Polygon[]` — the full WordArt composer on top of `textPolygons`: multi-line text, alignment, line height, glyph scale, underline / strike bars, envelope warps, and a layered two-color look.

**Browser** (uses `fetch`):

- `listGoogleFonts()` → every Google font (via the Fontsource API).
- `googleFontUrl(entry, weight)` / `loadFont(url)` / `loadGoogleFont(entry, weight)`.

## `textPolygons` options

| Option | Default | Notes |
|---|---|---|
| `size` | `100` | Cap-em size in world units. |
| `depth` | `size * 0.2` | Extrusion depth along world X (the mesh is Z-up: world Z = letter height, world Y = letter width). |
| `profile` | `"flat"` | `"flat"` slab · `"round"` bullnose · `"bevel"` chamfered edge. |
| `curveSteps` | `6` | Bézier flattening — higher is smoother, more polygons. |
| `letterSpacing` | `0` | Extra space between glyphs. |
| `color` / `sideColor` | gold | Cap and wall colors (sideColor defaults to a darker shade). |
| `profileSegments` | `6` | Ring count for round/bevel edges. |

## `composeText` — WordArt composer

`composeText(font, text, options)` is the full composer (`\n` starts a new line). The options group into five concerns instead of one flat bag:

```ts
import { composeText, resolveFace } from "@glyphcss/fonts";

const polygons = composeText(font, "Glyph\nCSS", {
  // 1 · type & layout
  size: 100, depth: 24, align: "center", scale: [1, 1],
  letterSpacing: 0, lineHeight: 1.25, underline: false, strike: false,
  warp: { shape: "arch", amount: 0.6 }, simplify: 0,

  // 2 · cross-section / edge profile (one union)
  profile: { edge: "bevel", coverage: "front" },

  // 3 · per-face material — one `Face` shape for all three
  faces: {
    front: resolveFace({ kind: "gradient", from: "#ffe14d", to: "#ff7a1a" }),
    sides: { color: "#7c4a12" },
    back:  { color: "#3a86ff" },
  },

  // 4 · outline
  outline: { color: "#1a1a2e", width: 3 },
});
```

| Group | Options |
|---|---|
| **Layout** | `size` · `depth` (0 = flat slab, no edges) · `curveSteps` · `letterSpacing` · `lineHeight` · `align` · `scale: [x,y]` · `underline` · `strike` · `warp` · `simplify` |
| **`profile`** | `"flat"` · `{ edge: "bevel"\|"round", raised?, segments? }` · `{ curve: CubicBezier, segments? }` |
| **`faces`** | `{ front?, sides?, back? }` · a single `Face` · `FaceStop[]` |
| **`outline`** | `{ color, width }` — a colored halo around the front face |

- **`profile` (shape)** and **`faces` (color)** are independent functions of the same depth axis `t ∈ [0,1]` (0 = front, 1 = back). `edge` bevels/rounds the edges (`raised` flips a round to a convex dome); `curve` is a custom edge from a CSS `cubic-bezier` easing.
- **`Face`** = `{ color?, texture?, tile? }`. `texture` is an already-rendered URL/data-URL UV-mapped across the whole word; `tile` repeats it every N units (blocks) vs stretching (gradients/photos).
- **`faces` resolves to material stops down the axis** — each polygon takes the nearest stop to its depth:
  - `{ front, sides, back }` → 3 stops at `{0, .5, 1}` (omit `sides` → the front rounds straight into the back, **no side band**).
  - a single `Face` → one material for the whole solid.
  - `FaceStop[]` (`Face & { at }`) → **N** materials distributed down the axis.
- **Flat drop shadow** — `depth: 0` + `faces.back.offset: [x, y]` with a distinct `back.color`.

### Fills — `resolveFace` & `makeFillTexture` (browser)

`composeText` is pure and takes already-rendered textures. The browser helpers turn a high-level fill into a `Face`:

```ts
resolveFace({ kind: "gradient", from: "#ffe14d", to: "#ff7a1a", angle: 270 })
// → { color?, texture: "data:image/png;…" }
```

`FaceFillSpec` (the `kind`): `"solid"` · `"gradient"` (`from`, `to`, `angle?`) · `"rainbow"` (`angle?`) · `"texture"` (`url`, `tile?`) · `"image"` (`src`). `makeFillTexture(FillSpec)` is the lower-level canvas painter if you want the data URL directly.

## Scope / limitations

This is a focused reader, not a full font library:

- **TrueType (`.ttf`, `glyf`) only.** CFF/OpenType (`.otf`, "OTTO") is rejected with a clear error. Google Fonts ship TrueType, so this covers the common case.
- **Uncompressed sfnt only** — woff/woff2 are not unpacked (the Google Fonts loader fetches raw `.ttf`).
- No shaping, kerning, ligatures, or variable-font axes — each character maps to one glyph plus its advance width.
- Script fonts with heavily self-overlapping contours can leave minor triangulation artifacts.
