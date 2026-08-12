# images-to-3d

**Status:** prototyping (object pipeline validated; scene + oracle in progress)
**Goal:** photos/**video** → a 3D scene of recognizable objects → glyphcss ASCII (+ polycss CSS)
**Current best approach:** **Tier 2 — single-image → mesh via TripoSG → decimate → glyphcss — VALIDATED** for *objects* (clean object *and* an object SAM2-masked from a real video frame; see [`experiments/generative/`](./experiments/generative/) + `example.html`). Tier 1 (in-browser depth) = the tiny no-server 2.5D path. For **scenes**: a scene is a *composition of objects* — extract (SAM2 video track) → generate each (TripoSG) → place (MoGe/VGGT) → render. Core insight: **generation beats reconstruction**, but TripoSG is an *object* model (streets are object-poor). Progress is measured with a **synthetic-ground-truth oracle** (`northstar.html`).

**➡️ Big picture — vision, everything explored, library inventory, the oracle, next steps: [`roadmap.md`](./roadmap.md).**

The differentiator vs. general image→3D: **glyphcss needs only a coarse mesh** (it renders to an ~80×40 char grid), so we can decimate brutally and skip high-fidelity reconstruction. See [`CLAUDE.md`](./CLAUDE.md) and [`overview.md`](./overview.md).

## Subpaths

| # | Approach | Tiny? | Faithful? | Where | Verdict |
|---|---|---|---|---|---|
| [01](./subpaths/01-depth-browser-tier1.md) | Monocular depth (Depth Anything V2-small) + SAM → heightfield mesh | ✅ ~50–100 MB | 🟡 2.5D, single view | in-browser | **promising** (build first) |
| [02](./subpaths/02-feedforward-bake-tier2.md) | Single-image → full mesh (**TripoSG** / TripoSR / TRELLIS) | ❌ big model | ✅ full 360° | offline bake | **validated** (TripoSG; +SAM2 for scene objects) |
| [03](./subpaths/03-multiview-photogrammetry.md) | Multi-image: COLMAP / Gaussian splatting / Depth Anything 3 | ❌ heavy | ✅✅ highest | offline | viable (overkill?) |
| [04](./subpaths/04-revolution-symmetry.md) | Solid of revolution from one image (structure from symmetry) | ✅✅ no model | ✅ symmetric objects | in-browser | **validated** (best value/effort) |

## Files
- [`roadmap.md`](./roadmap.md) — **the big picture**: north-star vision, everything explored, libraries, the oracle, next steps
- [`overview.md`](./overview.md) — problem, success criteria, key insight, open questions
- [`decisions.md`](./decisions.md) — what we've chosen / ruled out (dated ADRs)
- [`references.md`](./references.md) — papers, repos, links
- [`ideas/log.md`](./ideas/log.md) — running idea log
