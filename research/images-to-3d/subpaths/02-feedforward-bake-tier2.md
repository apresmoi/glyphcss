# Subpath 02 — Single image → full mesh, offline bake (Tier 2)

**Idea:** One image → a full 360° mesh via a feed-forward model, run offline; ship
only the decimated mesh to the browser.

## How it works
1. Run a single-image-to-3D model (see options) on a machine/server: image → mesh.
2. Hard-decimate (`decimatePolygons`) to a coarse mesh.
3. Ship the small OBJ/GLB; glyphcss renders it. (Or bake straight to ASCII with
   `@glyphcss/compile`.)

The dominant pattern in 2026 is **multi-view diffusion → feed-forward reconstruction**:
generate a few consistent views, then reconstruct — cleanest topology.

## Options (open source)
- **TripoSG** (`VAST-AI/TripoSG`) — **the one we validated.** MIT, SDF→marching-cubes so
  the mesh is **watertight and decimates cleanly**, ~8 GB VRAM. Winner for us.
- **TripoSR / Stable Fast 3D** — speed end, mesh in <1s; smallest/cheapest; only real
  in-browser candidate (ONNX). Coarser mesh, fine for ASCII.
- **Hunyuan3D 2.1** — high-fidelity + PBR; ~10 GB shape. **Avoid** — restrictive license.
- **TRELLIS (.2-4B)** — top quality, heavier (16–24 GB VRAM); MIT.
- **InstantMesh / Hi3DGen** — alternatives in the same family.

## ✅ Validated (2026-06-29)
End-to-end proven on a 16 GB GPU: **image → TripoSG → decimate → glyphcss ASCII.**
- **Clean object:** a single product photo (toy dino) → recognizable ASCII turntable.
- **Object from a real video frame:** SAM2 (box prompt) to mask the car out of a busy
  street frame → clean cutout → TripoSG → recognizable ASCII car. **Background removal
  matters** (BriaRMBG leaves connected ground on a scene-crop → baked slab; a tight
  SAM2 mask fixes it), and **source view matters** (a bigger, side-on frame → far crisper).
- Pipeline + artifacts + a live example page (dino + car turntables):
  `experiments/generative/` · `http://localhost:5050/research/images-to-3d/experiments/generative/example.html`
- Gotchas: **bf16 required** (fp16 segfaults in cuBLAS on the 4090); TripoSG's `diso`
  needs nvcc — use the skimage `hierarchical_extract` path (`use_flash_decoder=False`);
  decimate before glyphcss (Node OOMs on >1M faces); torch import is intermittently
  flaky on the shared box → wrap inference in a retry loop.
- **Scenes are NOT this** — per-frame generative-to-3D has no shared frame / metric
  scale; for scenes use reconstruction (VGGT + MoGe-2 depth fusion, see `ideas/log.md`).
  A scene = composed objects, but placing generated objects into a real scene needs a
  decent scene reconstruction (open; forward-motion clips are still weak).

## Fit for our constraints
- **Tiny?** ❌ as a model (hundreds of MB–GB, GPU). ✅ as *output* — the shipped mesh
  is tiny after decimation; the browser loads no model.
- **Faithful?** ✅ full 360° object.
- **Where?** Offline / server bake.

## Pros
- True orbitable object from a single photo.
- Browser cost is just a small mesh (already glyphcss's wheelhouse).

## Cons / risks
- Not in-browser; needs a GPU step (local script or hosted endpoint).
- Licenses vary per model — check before redistributing meshes.

## Open question
- **Silhouette-per-MB bake-off:** since we decimate hard, the cheapest model whose
  *silhouette* survives wins. Likely TripoSR/SF3D over TRELLIS for our use.

## Verdict
**validated.** The route for faithful 360° objects, proven end-to-end with **TripoSG**
(image → mesh → glyphcss) on both a clean photo and an object segmented from a real
video frame. For a scene, decompose into objects and run this per hero object; pair with
SAM2 for clean masks. Remaining open work: placing generated objects into a real
reconstructed scene (needs a decent scene reconstruction).
