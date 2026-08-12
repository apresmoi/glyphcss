# Overview — images → 3D for glyphcss

## Problem

Given photos of an object (one, a few, or many from different angles), produce a 3D
mesh we can render as ASCII in glyphcss. Optimize jointly for **size** (ideally
in-browser, tiny model) and **faithfulness** (recognizable shape).

## Why this is tractable for *us* specifically

General image→3D aims for clean topology, UV textures, PBR materials — expensive.
**glyphcss throws almost all of that away**: it rasterizes to an ~80×40 character
grid and `decimatePolygons` simplifies further. So our target is a *coarse,
silhouette-correct* mesh, not a production asset. That moves a lot of "too heavy for
the browser" tech into "good enough, and small."

## Success criteria

- **MVP (Tier 1):** drop an image in a web page → get a recognizable ASCII render of
  the object, fully client-side, models totaling ≤ ~100 MB, runs on WebGPU (graceful
  WASM fallback). 2.5D (single viewpoint) is acceptable for the MVP.
- **Faithful (Tier 2/3):** a full 360° object you can orbit in ASCII, produced by an
  offline bake; only a small decimated mesh ships to the browser.

## The pipeline, abstractly

```
image(s) → [segment object] → [reconstruct geometry] → [decimate] → glyphcss
              SAM / SAM2          depth | feed-forward     core's
              (optional)          | photogrammetry         decimatePolygons
```

## Three tiers (see subpaths)

1. **Tier 1 — in-browser depth → heightfield.** Monocular depth (Depth Anything
   V2-small, ~50 MB fp16, real-time in transformers.js + WebGPU) → displace a grid /
   lift a point cloud → coarse mesh. Optional SAM mask to isolate the object.
   *Tiny + today, but 2.5D (one viewpoint).*
2. **Tier 2 — single image → full mesh, offline.** TripoSR / Stable Fast 3D / TRELLIS
   / Hunyuan3D / InstantMesh. Big models (GPU), so run as a one-time bake and ship
   the decimated mesh. *Faithful 360°, not tiny in-browser.*
3. **Tier 3 — multi-image / any direction.** Classical photogrammetry (COLMAP,
   Meshroom) or NeRF / Gaussian splatting (nerfstudio, gsplat, OpenSplat), or Depth
   Anything 3 (multi-view → point cloud). *Highest fidelity, heaviest, offline.*

## Open questions

- How good does a Tier-1 2.5D depth mesh actually look once rasterized to ASCII +
  rotated a little? (Needs an experiment — the ASCII grid may hide the missing back.)
- Can we fake a "shell" from a single depth map (mirror/extrude the back) so a Tier-1
  object is orbitable, not just a relief?
- For Tier 2, which model gives the best *silhouette-per-megabyte* after hard
  decimation? (Fidelity we'd keep is low, so the cheapest viable model wins.)
- SAM2 (video tracking across frames) isn't in transformers.js yet (as of 2025-06) —
  is SAM(1) enough for single-image masking? (Likely yes for Tier 1.)
- Quantization (int8) headroom for any feed-forward model small enough for WebGPU?
  (Probably not for TRELLIS-class; revisit for smaller distilled variants.)
