# images-to-3d — agent guide

Research context for this direction. Follow the parent [`research/CLAUDE.md`](../CLAUDE.md)
conventions; this file adds the specifics.

## Goal

Turn one or more **photos of an object** into a **3D mesh** that glyphcss can render
as ASCII — optimizing for two things at once:

1. **Tiny** — ideally small enough to run *in the browser* via `transformers.js` /
   `onnxruntime-web` (WASM/WebGPU), with no server.
2. **Faithful** — recognizable silhouette + rough geometry.

## The key insight (don't lose this)

**glyphcss only needs a coarse mesh.** It rasterizes to an ~80×40 character grid, so
almost all geometric detail is discarded at render time, and `decimatePolygons`
already simplifies hard. So we do **not** need photorealistic reconstruction — a
blobby low-poly mesh is enough. This relaxes every requirement and is what makes the
in-browser dream plausible. Optimize for *silhouette + rough form*, not surface
detail or PBR materials.

## Constraints / preferences

- Prefer **open-source** (GitHub / HuggingFace), permissive licenses.
- Prefer **in-browser** where feasible; fall back to **offline/server bake** when the
  model is too big (then only a tiny decimated mesh ships to the browser).
- Output target: a mesh glyphcss loads (OBJ/GLB) after `decimatePolygons`.

## Tiers (current framing)

- **Tier 1** — in-browser, tiny, 2.5D: monocular depth (+ optional segmentation) →
  heightfield/point-cloud → coarse mesh. Achievable today.
- **Tier 2** — single-image → full mesh (TripoSR/TRELLIS/Hunyuan3D class), run
  offline/server as a one-time bake; ship the decimated mesh.
- **Tier 3** — multi-image / "any direction" (photogrammetry, Gaussian splatting,
  Depth Anything 3); offline, highest fidelity, heaviest.

See `subpaths/` for each, `decisions.md` for what we've chosen, `references.md` for
sources.
