# References — images → 3D

Gathered 2026-06-26. Relative claims (sizes, VRAM) are from the linked sources;
verify before relying on them.

## In-browser ML runtime
- [transformers.js](https://github.com/huggingface/transformers.js/) — run HF models in the browser via onnxruntime-web (WASM/WebGPU). 155+ architectures, WebGPU/WebNN.
- [transformers.js WebGPU video depth example](https://github.com/huggingface/transformers.js/tree/v3/examples/webgpu-video-depth-estimation) — working real-time depth in-browser.

## Segmentation (isolate the object)
- [SAM in transformers.js (since v2.14)](https://huggingface.co/posts/Xenova/240458016943176) — Segment Anything runs in the browser.
- [SAM2 in WebGPU (onnxruntime-web)](https://lucasgelfond.online/software/webgpu-sam2/) — SAM2 demo; not in transformers.js yet (as of 2025-06).

## Monocular / multi-view depth (Tier 1, Tier 3)
- [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) — NeurIPS 2024; sizes small (24.8M) → giant (1.3B).
- [Xenova: Depth Anything V2 ~50 MB (fp16) real-time in-browser](https://x.com/xenovacom/status/1801672335830798654) — the tiny in-browser path.
- [Depth Anything 3 — "recovering visual space from any views"](https://depth-anything-3.github.io/) — multi-view → point cloud; closest to "track from any direction."

## Single-image → mesh, feed-forward (Tier 2)
- [Best image-to-3D models on HuggingFace (2026)](https://trellis2.app/blog/best-image-to-3d-models-huggingface) — survey: TRELLIS, Hunyuan3D, Hi3DGen, Stable Fast 3D.
- [Hunyuan3D 2.1 (arXiv 2506.15442)](https://arxiv.org/pdf/2506.15442) — image → mesh + PBR; shape gen on ~6 GB VRAM.
- [TRELLIS overview](https://medium.com/@furkangozukara/trellis-is-still-the-lead-open-source-ai-model-to-generate-high-quality-3d-assets-from-static-d7ddf7f76433) — leading quality; heavier (~24 GB for TRELLIS.2-4B).
- TripoSR / Stable Fast 3D — single image → mesh in <1s (speed end). (find canonical repos)

## Multi-image: photogrammetry / Gaussian splatting (Tier 3)
- [nerfstudio](https://www.thefuture3d.com/software/nerfstudio/) — NeRF + Gaussian splatting framework; COLMAP pose estimation built in.
- [gsplat](https://github.com/nerfstudio-project/gsplat) — CUDA Gaussian splatting rasterization.
- [OpenSplat](https://github.com/pierotofy/OpenSplat) — production 3DGS with CPU/GPU support.
- COLMAP / Meshroom (AliceVision) — classical SfM + MVS → mesh. (add canonical links)

## Object generation (Tier 2 — validated engine)
- [TripoSG (`VAST-AI/TripoSG`)](https://github.com/VAST-AI-Research/TripoSG) — MIT; single image → watertight SDF mesh. **The** object engine. bf16; skimage extract (no `diso`/nvcc).

## Segmentation + tracking (multi-frame pipeline)
- [SAM2](https://github.com/facebookresearch/sam2) — `sam2.1-hiera-tiny`; box/point/auto masks **and** video object tracking (`SAM2VideoPredictor`). Use `vos_optimized=False` + `TORCHDYNAMO_DISABLE=1` to dodge a torch-compile bug on the shared box.

## Scene reconstruction (placement; weak for object meshes)
- [VGGT (`facebook/VGGT-1B`)](https://github.com/facebookresearch/vggt) — feed-forward multi-view → world points + poses. Great on orbit, **fails on forward motion**.
- [MoGe-2 (`Ruicheng/moge-2-vitl`)](https://github.com/microsoft/MoGe) — monocular metric depth + pointmaps; per-frame depth fusion + object placement.

## Scene-generative (whole-scene fidelity — cloud, researched not built)
- World Labs **Marble**, NVIDIA **GEN3C**, **Lyra** — recipe: render point cloud from novel poses → video-diffusion fills holes → reconstruct 3DGS. 16 GB-fit pieces: ViewCrafter@512, AnySplat/NoPoSplat/Flash3D, gsplat (~6 GB). GEN3C-7B ≈ 43 GB → cloud. Spark = World Labs' MIT 3DGS browser renderer.

## Rendering — sibling renderer + parity reference
- **polycss** = [`@layoutit/polycss`](https://www.npmjs.com/package/@layoutit/polycss) — CSS `matrix3d` mesh engine glyphcss forked from. Mirror API (`createPolyScene`, `createPolyPerspectiveCamera`, `createPolyFirstPersonControls`, `poly-mesh`, custom elements). Loads OBJ/GLB. Local: `~/Documents/voxcss/packages/polycss`.
- **cssQuake** (`~/Documents/cssQuake`) — reference app rendering identically in glyphcss + polycss; source of the parity camera recipe. `link:`s the **local** glyphcss (has the unpublished `fovScale` fix, commit `b1e2bb6`).

## glyphcss-side
- `decimatePolygons` (in `@glyphcss/core`) — the simplifier that makes any of the above small enough to render.
- `@glyphcss/compile` — could bake the reconstructed mesh straight to ASCII (CLI / Node).
- **Camera parity recipe:** same `zoom`+`perspective` in glyph+poly; glyph adds only `distance:0` + `autoSize`; drive `target = eye + forward·(perspective/zoom)`. glyphcss now measures live cell CSS pixels, so no manual `fovScale`/`stretch` compensation is needed.
