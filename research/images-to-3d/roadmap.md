# Roadmap — video/images → navigable 3D scene → glyphcss + polycss

**Last updated:** 2026-07-01. This is the "big picture" doc: the north-star vision, the
core insight, everything we've explored (with verdicts), the tool/library inventory, the
**oracle** for measuring progress, and what's next. For the object-only pipeline that's
already validated, see [`README.md`](./README.md) + [`subpaths/`](./subpaths/). For the
dated blow-by-blow, see [`ideas/log.md`](./ideas/log.md).

> **Privacy:** this direction is exploratory and git-excluded by intent. Keep it that way.

---

## 1. The north star

**Turn a video (or photos) into a navigable 3D scene of *recognizable objects*, rendered
as glyphcss ASCII (and polycss CSS), maximizing fidelity to the original.**

Refined through the exploration into a concrete thesis:

> **A scene is a composition of objects.** Extract the objects from the footage →
> generate each as a clean 3D model → place each at its true position/scale/orientation
> in 3D space → render + navigate (first-person).

The user's articulated end-state pipeline (correct, and what SOTA systems do):

```
video ─▶ multi-frame segmentation (track each object across frames → many views)
      ─▶ per-object generation (multi-view → a complete, clean 3D mesh)
      ─▶ placement (the object's 3D track → real position, scale, orientation)
      ─▶ render (glyphcss ASCII + polycss CSS) + navigate (FPV)
```

---

## 2. The core insight (do not lose this)

**Generation ≠ reconstruction. This is *the* reason the car looks great and everything
else looked like mush.**

| | **Generation** (TripoSG) | **Reconstruction** (MoGe/VGGT depth) |
|---|---|---|
| What it is | a model trained on millions of 3D objects | raw 3D points measured from frames |
| From 1 image it… | **hallucinates a complete, clean, watertight mesh** (fills unseen sides) | gives a **sparse, partial shell** (only the visible front) |
| Result in ASCII | recognizable object ✅ | dot-cloud blob 💩 |
| Needs | a learned *prior* | parallax / many views |

The car was good **because it went through a generative model**. The cemetery/road/etc.
were mush **because we used raw reconstruction for them**. Same footage — different method.

**Corollary that bounds everything:** **TripoSG is an *object* model, not a *scene*
model.** It knows cars, furniture, characters, products. It has never learned
buildings, roads, or vegetation. So in a *street* scene, only the car (+ maybe a
statue/person) becomes a clean mesh. A **room** (chairs, lamps, a desk of objects) would
decompose into many clean objects beautifully; a street is **object-poor** for clean
generation. To get a *whole scene* at object-quality you need a **scene-generative
model** (Marble / GEN3C class) — 40 GB / cloud.

---

## 3. What we've explored (with verdicts)

### 3a. Object generation — **VALIDATED** ✅
- **TripoSG** (`VAST-AI/TripoSG`, MIT): single image → watertight SDF mesh. The engine.
  Gotchas locked in: **bf16** (fp16 → cuBLAS segfault), skimage `hierarchical_extract`
  (`use_flash_decoder=False`, avoids `diso`/nvcc), **decimate before glyphcss** (Node OOM
  >1 M faces), wrap the flaky shared-4090 torch import in a retry loop.
- **SAM2** (`sam2.1-hiera-tiny`): box/point prompt → tight mask to pull an object out of a
  busy frame. Clean background + a big, side-on source view are the two quality levers.
- Proven on: a clean product photo (dino), and a **car SAM2-masked from a real street
  clip** (frame f013, side-on) → recognizable ASCII car. See `experiments/generative/`.

### 3b. In-browser (no-server) path — **VALIDATED (as 2.5D relief)** ✅🟡
- **Depth Anything V2-small** (~50 MB fp16, ~18 MB q8) via **transformers.js** (WebGPU,
  WASM fallback) → foreground-masked heightfield → glyphcss. Runs with zero server, sub-
  second. Honest limit: single-view relief reads as a colored *block*, not a full mesh.
  `experiments/generative/inbrowser.html`. True in-browser single-image→full-mesh
  (TripoSR ONNX) = **NO-GO** (~1.7 GB, no web port).

### 3c. Scene reconstruction — **partial / weak link** 🟡
- **VGGT** (`facebook/VGGT-1B`): feed-forward multi-view → world points + poses. Great on
  orbit, **fails on forward motion** (the salamone clip). Built a real dense reconstruction
  (`scene-real.html`, ~22k surfels) — but it's a point-cloud *soup*, no distinct object
  models. User rejected: "where are the freaking 3d objects."
- **MoGe-2** (`Ruicheng/moge-2-vitl`): monocular metric depth + pointmaps. Used for
  per-frame depth fusion (forward chamfer 19.6% → 4.86% ceiling) and for depth-based
  object placement. Fixes the *depth* half; **poses stay weak** on forward motion.
- **Verdict:** reconstruction alone gives coarse geometry, not clean objects. Use it for
  *placement* (where does the object sit) not for the object *mesh*.

### 3d. Multi-object decomposition — **explored, hit the object-poor wall** 🟡
- Fine **SAM2 auto-mask** on one frame → 16–21 segments; split the cemetery into parts by
  spatial clustering → a 21-object "studio" switcher. But each object was a **point-cloud
  surfel** (single-view shell, coarse) and **polycss won't render surfel GLBs well**.
- **SAM2 *video* tracking** (`SAM2VideoPredictor`, `vos_optimized=False` +
  `TORCHDYNAMO_DISABLE=1` to dodge a torch-compile bug): tracked 10 objects across 25
  frames → multi-view per object + a per-frame track (for placement). This is stage 1 of
  the proper pipeline and **works** — but most tracked "objects" in a street are
  road/sky/facade chunks, not clean objects (the object-poor wall again).

### 3e. Rendering — glyphcss **and** polycss, side by side — **built** ✅
- **polycss** = **`@layoutit/polycss`** (scoped — that's why the bare name 404'd). The
  CSS-`matrix3d` predecessor glyphcss forked from. Full mirror API: `createPolyScene`,
  `createPolyPerspectiveCamera`, `createPolyFirstPersonControls`, `poly-mesh`
  (`position/scale/rotation`), custom elements. Renders full-detail solid CSS polygons,
  GPU-smooth. Loads GLB directly.
- Built: `car-polycss.html` (smooth car), `studio.html` (object switcher, glyph+poly),
  `northstar.html` (ground-truth scene, both renderers, waypoint flythrough),
  `debug-parity.html` (the parity test harness).

### 3f. SOTA scene-generation research (Marble / GEN3C / Lyra) — **synthesized, not built**
- The recipe: **render point cloud from novel poses → video-diffusion fills holes
  consistently → reconstruct 3DGS.** 16 GB-fit pieces: ViewCrafter@512 (13.8 GB),
  AnySplat/NoPoSplat/Flash3D (feed-forward scene-3DGS), gsplat (~6 GB). GEN3C-7B ≈ 43 GB
  → cloud. This is the real answer for *whole-scene* fidelity; not attempted locally.

---

## 4. The oracle — how we KNOW we're getting closer 🎯

**The key methodology decision of the session.** We can't tell if the pipeline is
improving by eyeballing mush. So build a **synthetic ground truth**:

```
compose a scene we FULLY KNOW  (gallery objects at fixed, recorded poses)   ← northstar.html
        │
        ▼  fly a waypoint camera path → render to a VIDEO  (synthetic source; truth known)
        │
        ▼  run OUR pipeline on that video: segment → generate → place
        │
        ▼  score reconstructed poses  ⟷  the known poses
        │
        ▼  error metric: position / scale / orientation per object; detection rate
              ↓ shrinks as the pipeline improves = we're getting closer ✅
```

`northstar.html` is stage 1 (the known scene + flythrough). **Important:** the oracle
scores *object positions* (numbers), **not** glyph-vs-poly pixels — so exact two-renderer
parity is a nice-to-have for viewing, **not** required for the oracle to function.

Status: the ground-truth scene + play/stop waypoint flythrough is **built**. The
render-to-frames + scoring harness is **the immediate next build**.

---

## 5. glyphcss ↔ polycss parity findings (from deep Playwright debugging)

Goal: same scene, same camera, in both renderers. They're **sibling libraries** so config
*should* be identical. Debugged to pixel-measurements with Playwright:

- **Correct shared camera recipe:** same `zoom` + same `perspective` in both; glyphcss
  uses `distance:0` + `autoSize`; both driven by
  `target = eye + forward·(perspective/zoom)`,
  `forward=[-sin(rx)cos(ry),-sin(rx)sin(ry),-cos(rx)]`.
- **Library parity fix:** glyphcss now treats public `zoom` as CSS px/world-unit like
  polycss and measures live glyph cell CSS pixels before converting screen pixels into
  output cells. The old fitted `fovScale`/`stretch` demo constants are no longer needed.
  **Build/use the local source** (both pages import `glyphcss.local.mjs` +
  `polycss.local.mjs`) when checking parity.
- **Remaining renderer differences:** polycss paints CSS polygons while glyphcss rasterizes
  to text; polycss also back-face-culls by default and can drop faces if source winding is
  inconsistent. Use simple, clearly wound models when evaluating camera/framing parity.

---

## 6. Tool / library inventory

| Tool | Role | Notes |
|---|---|---|
| **TripoSG** `VAST-AI/TripoSG` | image → watertight mesh (generation) | MIT; bf16; the object engine |
| **SAM2** `sam2.1-hiera-tiny` | segmentation + **video tracking** | box/auto/video; `vos_optimized=False` |
| **MoGe-2** `Ruicheng/moge-2-vitl` | monocular metric depth + pointmaps | placement + depth fusion |
| **VGGT** `facebook/VGGT-1B` | feed-forward multi-view → points + poses | fails on forward motion |
| **Depth Anything V2-small** | in-browser depth (transformers.js) | ~50 MB fp16, no-server 2.5D |
| **glyphcss** (this repo) | ASCII renderer | use **local build** (unpublished fovScale fix) |
| **polycss** `@layoutit/polycss` | CSS `matrix3d` renderer (sibling) | full mirror API; loads GLB |
| **cssQuake** `~/Documents/cssQuake` | reference: glyphcss+polycss render identically | the parity recipe source |
| fast-simplification | mesh decimation | run in a **non-inference** container (numpy ABI) |
| Marble / GEN3C / Lyra (research) | scene-generative | cloud / ≥40 GB; not built |

**Infra:** remote 4090 (16 GB) via `docker --context gpu-4090`; **flaky** (intermittent
torch-import segfaults → retry loops). Local `http.server` on **:5050** serves the repo.
Headless verification via Playwright (`chromium channel:'chrome'`) → screenshots + pixel
measurement.

---

## 7. Roadmap / next steps

**Now (unblocks measurement):**
1. **Scoring harness** — render `northstar.html`'s flythrough to frames → run the pipeline
   → diff reconstructed object poses vs the known ground truth. This is the oracle; build it.
2. Publish **glyphcss 0.0.10** (or keep using the local bundle) so the FOV fix is live.

**Then (the proper pipeline, on object-rich input):**
3. Feed the pipeline an **object-rich video** (a room / desk of objects) where clean
   generation actually pays off — same code, right subject.
4. Wire stages end-to-end: **SAM2 video track → best-view (or multi-view) → TripoSG →
   place from the 3D track → render**. Stage 1 (tracking) already works.
5. **Multi-view generation** upgrade: feed tracked multi-views to a multi-view→mesh model
   (TRELLIS multi-image / a multi-view LRM) instead of best-view single-image TripoSG.

**Bigger (whole-scene fidelity):**
6. **Scene-generative** route (Marble / GEN3C) on cloud for streets/rooms as coherent
   worlds — the only path to a whole scene at object-quality.

**Library polish (glyphcss/polycss author):**
7. Off-axis FOV residual; polycss double-sided/no-cull for `add()`-fed polygons; polycss
   GLB rendering. Needed only if two-renderer pixel-parity matters beyond eyeballing.

---

## 8. Live prototypes (served on http://localhost:5050)

- `…/experiments/generative/northstar.html` — ground-truth scene + waypoint flythrough, polycss + glyphcss (the oracle's stage 1).
- `…/experiments/generative/debug-parity.html` — grid-of-cubes parity harness (yaw/eyeX sliders).
- `…/experiments/generative/studio.html` — object switcher, glyph + poly side by side.
- `…/experiments/generative/car-polycss.html` — the clean generated car, smooth polycss.
- `…/experiments/generative/scene-real.html` — VGGT point-cloud reconstruction, FPV.
- `…/experiments/generative/example.html` / `inbrowser.html` — validated object pipeline / no-server 2.5D.
