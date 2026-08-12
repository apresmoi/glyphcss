# Decisions — images → 3D

Newest first. ADR-lite: context → decision → why. Big picture: [`roadmap.md`](./roadmap.md).

## 2026-07-01 — Measure progress with a synthetic-ground-truth ORACLE, not eyeballing
- **Context:** We kept shipping scene renders and couldn't objectively tell if the
  pipeline was improving — "is this mush closer than the last mush?" has no answer by eye.
- **Decision:** Build a **north-star oracle**: compose a scene we fully KNOW (gallery
  objects at fixed, recorded poses) → fly a waypoint camera path → render to a video →
  run our extract→generate→place pipeline on it → **score reconstructed poses vs the known
  poses** (position/scale/orientation error, detection rate). Built stage 1
  (`northstar.html`: known scene + play/stop flythrough); scoring harness is next.
- **Why:** Turns "getting closer?" into a number that shrinks. **Key:** the oracle scores
  object *positions* (numbers), not glyph-vs-poly pixels — so two-renderer pixel-parity is
  a viewing nicety, not a requirement.

## 2026-07-01 — Render in BOTH glyphcss + polycss; use LOCAL builds for parity checks
- **Context:** User wanted the scene in glyphcss AND polycss side by side, identical config
  ("they're sibling libraries"). polycss = `@layoutit/polycss` (scoped). Deep Playwright
  parity debugging.
- **Decision:** Shared camera recipe: same `zoom` + `perspective` in both; glyphcss
  `distance:0` + `autoSize`; both driven by
  `target = eye + forward·(perspective/zoom)`. **Load glyphcss AND polycss from LOCAL
  source** (`glyphcss.local.mjs` / `polycss.local.mjs` via esbuild) when measuring parity.
- **Why / open:** glyphcss now matches polycss's public `zoom` semantics (CSS px/world-unit)
  and measures live glyph cells before projection. The old fitted `fovScale`/`stretch`
  constants are obsolete. Remaining visible differences are renderer/source-model behavior:
  CSS polygons vs text rasterization, and polycss's default back-face culling.

## 2026-07-01 — Generation (prior) vs reconstruction (measurement) is THE fidelity axis
- **Context:** "The car is great but the cemetery/road/objects are mush — why?" Traced it.
- **Decision:** Frame every object as **generation** (TripoSG hallucinates a complete clean
  mesh from a learned prior) vs **reconstruction** (MoGe/VGGT measure sparse partial points).
  Use generation for object *meshes*, reconstruction only for *placement*. The proper
  pipeline is **multi-frame SAM2 tracking → per-object (multi-view) generation → place from
  the 3D track** (user's articulation; SAM2-video stage-1 works).
- **Why / hard bound:** **TripoSG is an *object* model, not a scene model** — it knows cars/
  furniture/products, never buildings/roads/vegetation. So a *street* is object-poor (≈ just
  the car); a *room* of discrete objects would shine. Whole-scene fidelity needs a **scene-
  generative** model (Marble/GEN3C, ~40 GB/cloud) — researched, not built. Ruled out grinding
  the object-poor street further.

## 2026-06-29 — In-browser path: depth→2.5D is GO (built + verified); TripoSR-in-browser is NO-GO
- **Context:** Tested the "drop image → ASCII 3D, no server" dream. Feasibility research +
  a working build. True in-browser single-image→full-mesh (TripoSR) = **NO-GO**: the only ONNX
  export is ~1.7 GB (Unity Sentis), no web port, no precedent, transformers.js has no
  image-to-3D task. In-browser **depth→heightfield = GO**: Depth Anything V2-small (~50 MB fp16,
  q8 ~18 MB) via transformers.js v3 (WebGPU, WASM fallback) → downsampled grid mesh → glyphcss.
- **Decision:** The in-browser path is **depth→2.5D relief**, not generative mesh. Built + verified
  end-to-end (headless Chrome, WASM): `experiments/generative/inbrowser.html` — image → client-side
  depth → foreground-masked heightfield → glyphcss colored ASCII, ~7k polys, sub-second, zero server.
- **Why / honest limit:** It RUNS with no server, but a single-view relief rasterised to ~80×40
  reads as a colored relief *block*, less clean than the full TripoSG mesh silhouette (which needs a
  server). So: **server TripoSG = faithful object mesh; in-browser depth = no-server 2.5D relief.**
  Two ends of the design space, both demoed (`example.html` vs `inbrowser.html`). Keep TripoSR
  server-side only. transformers.js + `onnx-community/depth-anything-v2-small` is the in-browser stack.

## 2026-06-29 — Tier 2 validated: TripoSG is the object→mesh engine; SAM2 for scene objects
- **Context:** Ran the full search ("better way to get 3D from images"). Reconstruction
  (VGGT) is great on orbit but fails on forward motion; MoGe-2 per-frame depth fusion
  fixes the *depth* half (forward chamfer 19.6%→4.86% ceiling) but poses stay weak.
  Generative single-image→3D, by contrast, needs no parallax and emits clean watertight
  meshes — and our coarse ASCII target makes its hallucination free while reconstruction's
  holes/topology hurt. Proven end-to-end on a 16 GB GPU.
- **Decision:** For **objects**, use **TripoSG** (MIT, watertight SDF mesh, ~8 GB) as the
  bake engine: image → TripoSG → `decimatePolygons` → glyphcss. To pull an object out of a
  busy frame, **SAM2** (box/point prompt) for a clean mask first — background removal and a
  big, side-on source view are the two quality levers. For **scenes**, stay on reconstruction
  (VGGT + MoGe-2 fusion); treat a scene as a composition of objects.
- **Why:** Directly satisfies the goal (photo of an object → coarse faithful mesh) with the
  cleanest topology for hard decimation, sidesteps the forward-motion parallax problem, and
  is permissively licensed. Evidence + live example: `experiments/generative/`. Ruled out
  Hunyuan3D on license.
- **Gotchas locked in:** bf16 (fp16 cuBLAS segfault), skimage extract (no `diso`/nvcc),
  decimate-before-glyphcss (Node OOM), retry-loop the flaky torch import on the shared box.
- **Open:** composing generated objects into a real *scene* needs a decent scene
  reconstruction; forward-motion scenes are still the weak link.

## 2026-06-26 — Build Tier 1 (in-browser depth) first
- **Context:** Three viable tiers (depth-in-browser / single-image-mesh-bake /
  multi-view). We want a flashy, on-brand, achievable demo before investing in heavy
  reconstruction.
- **Decision:** Prototype **Tier 1** first — image → (optional SAM mask) → Depth
  Anything V2-small → heightfield/point-cloud mesh → glyphcss, all client-side.
- **Why:** It's the only genuinely *tiny + in-browser-today* path (~50 MB depth
  model on WebGPU), and glyphcss's coarse ASCII output hides the 2.5D limitation.
  Validates the end-to-end "drop image → ASCII 3D, no server" story cheaply.

## 2026-06-26 — Heavy reconstruction is an offline bake, not in-browser
- **Decision:** TRELLIS / Hunyuan3D / TripoSR (Tier 2) and photogrammetry / Gaussian
  splatting (Tier 3) run **offline/server**, shipping only a decimated mesh to the
  browser — they are not "tiny web models."
- **Why:** These are hundreds of MB to multiple GB and GPU-bound; int8 quantization
  won't shrink a 4B-param model to web scale. The browser doesn't need the model if
  the mesh is pre-baked.

## Open / not yet decided
- Whether to fake an orbitable "shell" from a single depth map (Tier 1) vs. accept
  2.5D relief for the MVP.
- Which Tier-2 model wins on *silhouette-per-MB after hard decimation* (fidelity we
  keep is low, so cheapest viable model likely wins) — needs a bake-off.
