# Subpath 01 — In-browser monocular depth → heightfield mesh (Tier 1)

**Idea:** Single image → depth map (tiny model, in-browser) → lift to a coarse mesh →
glyphcss. The smallest, ship-today path.

## How it works
1. (Optional) **SAM** mask the object so we reconstruct it, not the background — runs
   in transformers.js.
2. **Depth Anything V2-small** (~50 MB fp16) estimates a per-pixel depth map, real-time
   in transformers.js on WebGPU (WASM fallback).
3. Lift depth → geometry: displace a 2D grid by depth (heightfield), or unproject to a
   point cloud and triangulate. Downsample to a coarse grid.
4. `decimatePolygons` → glyphcss `<pre>`.

## Fit for our constraints
- **Tiny?** ✅ ~50 MB depth model (+ optional SAM ~tens of MB). Fully client-side.
- **Faithful?** 🟡 **2.5D** — a relief from one viewpoint; no true back side. But the
  coarse ASCII grid hides a lot, and a small rotation still reads as 3D.
- **Where?** In-browser (WebGPU; WASM fallback).

## Pros
- Only genuinely tiny + in-browser-today option.
- No server; great "drop image → ASCII 3D" demo and on-brand.
- Reuses existing transformers.js depth + SAM support (low integration risk).

## Cons / risks
- 2.5D, not orbitable 360° (mitigation: mirror/extrude a fake back shell).
- Depth scale is relative, not metric — fine for ASCII, needs normalization.
- WebGPU availability varies; WASM fallback is slower.

## Key repos & references
- Depth Anything V2 · transformers.js webgpu depth example · SAM in transformers.js
  (see `../references.md`).

## Update — segmentation added (`experiments/segment-3d/`)
Added **SlimSAM** (`Xenova/slimsam-77-uniform`, transformers.js) for click-to-select
segmentation BEFORE depth: the mask isolates the object so the heightfield is built only
over object pixels — background relief gone. Verified e2e (corgi → mask → depth → isolated
2.5D in glyphcss). This is the "select object → build 3D" flow. Both models in-browser
(~100 MB total). Next: cache SAM embeddings, complete the back via symmetry.

## Verdict
**validated (prototype works).** `experiments/tier1-depth/index.html` runs the full
chain in-browser (transformers.js + glyphcss via esm.sh) and renders a correct 3D
ASCII relief — no server, ~50 MB model. 2.5D *does* read as 3D once rasterized +
tilted. Open follow-ups: SAM masking, fake back-shell for orbitability, real object
photos, and a `@glyphcss/compile` static-turntable bake.
