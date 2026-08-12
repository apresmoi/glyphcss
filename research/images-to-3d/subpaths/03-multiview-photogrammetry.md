# Subpath 03 — Multi-image / "any direction" reconstruction (Tier 3)

**Idea:** Many photos of the object from different angles → reconstruct true geometry
(the original "track it from any direction" pitch). Highest fidelity, heaviest, offline.

## How it works
- **Classical photogrammetry:** COLMAP / Meshroom (AliceVision) — Structure-from-Motion
  for camera poses + sparse points, then Multi-View Stereo → dense mesh. Robust but slow,
  brittle on textureless surfaces.
- **NeRF / Gaussian splatting:** nerfstudio (`splatfacto`) + gsplat, or OpenSplat
  (CPU/GPU). COLMAP poses → train splats → convert to mesh (SuGaR / 2DGS).
- **★ Pose-free feed-forward (the 2025–26 way — supersedes COLMAP):** one network takes a
  *set of frames* and predicts camera poses + depth + a dense 3D point cloud in a single
  forward pass — no feature matching, no bundle adjustment, no COLMAP.
  - **VGGT** (Visual Geometry Grounded Transformer, CVPR 2025) — 1→hundreds of views →
    cameras + depth + point maps + tracks in one pass. **VGGT-Omega** (CVPR 2026) improves it.
  - **Fast3R** — 1000+ images in one pass. **PreF3R** — sequential *video* → Gaussian
    splatting via spatial memory (ideal for ordered frames). **DUSt3R/MASt3R** — the originals.
  - **Depth Anything 3** — multi-view → point cloud ("visual space from any views").
- **Video → 3D, packaged:** `ptrckfrnk/humanoid-video-to-3D` = **VGGT + SAM 2.1 + CLIP**,
  one command, no COLMAP (Apple Silicon + CUDA). This is essentially the "video → segment
  each frame → 3D scene" pipeline ready-made.
- Then decimate → glyphcss (or `@glyphcss/compile` to ASCII).

## Video → 3D pipeline (the "10s of a place" idea)
1. Extract frames from the clip (yt-dlp for YouTube — mind ToS/copyright).
2. **SAM 2** tracks/segments the object across frames from one click (temporal masks).
3. **VGGT/Fast3R/PreF3R** → camera poses + dense point cloud across all frames in one pass
   (this *is* "find the projection details" + "soften movement" + "compose polygons in 3D").
4. Point cloud → mesh → decimate → glyphcss.
   Needs real camera **parallax** (camera moving through/around the scene) — a static shot
   where only the subject moves won't triangulate.

## Fit for our constraints
- **Tiny?** ❌ heavy pipelines; SfM in-browser is impractical.
- **Faithful?** ✅✅ highest — real geometry, true back side.
- **Where?** Offline only.

## Pros
- Genuine, complete object; not faked from one view.

## Cons / risks
- Needs many well-posed photos + a capture step; slowest.
- Splatting → mesh conversion is lossy/fiddly; COLMAP can fail on textureless/shiny
  objects.
- **Likely overkill for glyphcss** — we throw away most of this fidelity at ASCII res.

## Key repos & references
- COLMAP / Meshroom · nerfstudio · gsplat · OpenSplat · Depth Anything 3
  (see `../references.md`).

## Verdict
**Strongest path for complex scenes / "a place" — and no longer overkill thanks to
pose-free feed-forward models.** For a real object/scene with camera parallax, VGGT (or
PreF3R for video) + SAM 2 gives geometry-grounded 3D (real parallax, not generative
guessing) without COLMAP. Offline/GPU (large transformers), so it's a bake → ship the
decimated mesh to glyphcss; the browser never loads the model. Supersedes single-image
TripoSR (subpath 02) whenever multiple real views exist. Best next experiment for
"video → 3D".
