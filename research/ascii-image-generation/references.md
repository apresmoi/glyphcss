# References — Stateful ASCII-conditioned image generation

Accessed 2026-07-23. Sources below are model authors/hosts, runtime maintainers,
or browser vendor documentation. A source demonstrates only the fact stated; it
does not prove this project's proposed custom adapter, refiner, export, latency,
or VRAM outcome.

| Source | Verified fact used here |
| --- | --- |
| [nota-ai/bk-sdm-small model card](https://huggingface.co/nota-ai/bk-sdm-small) | BK-SDM-Small reports 0.49B U-Net / 0.66B whole model, derives from removed SD-v1.4 blocks, and shows `StableDiffusionPipeline` loading. Its own card also says its usage section is taken from the SD-v1 card. |
| [CompVis Stable Diffusion license](https://github.com/CompVis/stable-diffusion/blob/main/LICENSE) | Primary SD-v1 lineage license text. BK-SDM's inherited restriction/provenance must be copied and hashed with each local artifact. |
| [TencentARC T2I-Adapter repository](https://github.com/TencentARC/T2I-Adapter) | The authors describe adapters for SD 1.4/1.5 and report a 77M-parameter original recipe; this motivates the adapter shape only. |
| [T2I-Adapter model card](https://huggingface.co/TencentARC/T2I-Adapter) | The model card declares Apache-2.0 for that project. It does not make a new BK-SDM adapter Apache-2.0 or compatible by itself. |
| [Segmind SSD-1B model card](https://huggingface.co/segmind/SSD-1B) | Declares Apache-2.0, 1.3B parameters, SDXL pipeline usage, 1024-or-larger listed resolutions, and reported 4×A100 training. This is the documented fallback, not the selected first slice. |
| [ONNX Runtime WebGPU EP](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) | Documents the browser WebGPU EP, static-shape graph capture, GPU-buffer I/O binding, and explicit GPU buffer disposal responsibilities. |
| [ONNX Runtime WebGPU operator table](https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md) | The authoritative operator coverage listing used by B18 to validate exported graphs rather than assuming ONNX equals WebGPU support. |
| [Chrome WebGPU troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) | Chrome requires a secure context and hardware acceleration; on Windows laptops Chrome may select the integrated GPU unless configured otherwise. |

The reference browser is Chrome for Testing Chromium 140.0.7339.80 (revision
1496484), fetched from Chrome for Testing's known-good-version registry and
verified against archive SHA-256
`7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546`.
`playwright@1.58.2` is the launcher only and does not supply the browser binary.
The resolved OS, GPU adapter, and driver are runtime evidence, not facts inferred
from package metadata.

## License disposition

The selected local base is not described here as “permissive.” It is a
redistributable SD-v1-lineage research choice subject to its inherited OpenRAIL
terms. Every actual download must have a revision, SHA-256, license text/hash,
and attribution in the run manifest. Any attempt to publish, host, or bundle
weights stops for a dedicated license review. `SSD-1B` is the documented
Apache-2.0 alternative, but it is rejected for this initial 512/16 GB/browser
slice on resource and resolution evidence, not because its license is weaker.

## Measured versus proposed

Verified: published parameter counts, documented pipeline/runtime APIs, licenses
as declared by the cited sources, and Chromium's stated WebGPU constraints.

Proposed and unverified until their named gates: 17/23 channel packing,
`GlyphKeyframeAdapter`, 30M-cap `GlyphTemporalRefiner`, rank-8 style insertion,
512 inference quality, fp16/bf16 training memory, ONNX conversion/operator
coverage, browser download/memory, WebGPU-only execution, 30 fps presentation,
and all quality/temporal claims. B3/B12/B13/B17/B18/B20 are the proof sequence.

## 2026-07-25 — How to actually drive a depth/structure ControlNet

Prompted by measuring our own control images: over half the views were sending SDXL a
near-constant image (frog view 0 uniformly black), so the model was free-running on the prompt.

### Conditioning hygiene
- Normalize depth **per image**: `(d - min) / (max - min)`. This is the standard everyone uses;
  our fixed global near/far clamps most views to a constant. `stock_controlnet_baseline.py`
  already implements this as `--depth-source frame-minmax`.
  <https://huggingface.co/diffusers/controlnet-depth-sdxl-1.0>
- Control weight ~0.7 is the usual starting point, not a low value chosen by feel.
  <https://creatixai.com/controlnet-depth-tutorial-stable-diffusion-a1111/>
- SDXL needs SDXL-specific ControlNets; SD1.5 checkpoints do not transfer. (We already pin
  `diffusers/controlnet-depth-sdxl-1.0`, but `stock_controlnet_baseline.py` still defaults to an
  SD1.5 depth model, which is a trap for anyone reusing it.)

### Conditioning types we could produce EXACTLY rather than estimate
Everyone else runs an estimator (MiDaS/Zoe for depth, BAE/DSINE for normals, HED/PiDiNet for
edges) over a photo. We render the geometry, so we have the ground truth for several of these
already in the control frame — depth, geometric normals, coverage silhouette, Lambert shade.
Full catalogue of what these models accept:
<https://github.com/Fannovel16/comfyui_controlnet_aux>
- **Normal maps** are called out as the best fit for 3D-render/texture work, and we have exact
  per-cell normals (`normal-f32`), no estimation error.
- **Recolor / luminance** ControlNets (`sai_xl_recolor_256lora`,
  `bdsqlsz_controlllite_xl_recolor_luminance`, preprocessor `recolor_luminance`) take a
  brightness map and colorize it. This is conceptually the closest thing to what glyphcss is:
  our `shade-f32` IS a luminance field, and the ASCII ramp is a luminance quantization.
- Also available: canny / lineart / softedge (our silhouette + face boundaries are exact),
  segmentation (our class/instance IDs are exact region labels), MLSD for architectural lines.

### The multi-view texturing problem is solved literature; we reinvented a naive version
- **Text2Tex** — depth-aware inpainting across a view sequence, plus an automatic **next-best-view**
  scheme instead of a fixed orbit. <https://github.com/daveredrum/Text2Tex>
- **TEXTure / Text2Tex trimap**: partition each rendered view into `new` / `keep` /
  `refine`, where "refine" is previously-seen geometry whose **view cosine was poor**, and
  regenerate exactly those. We compute the same view cosine (C-item incidence weighting) but only
  use it as a blend weight; the literature uses it to decide what to *regenerate*.
  <https://ar5iv.labs.arxiv.org/html/2311.12891>
- **SyncMVD** — synchronized multi-view denoising with UV-space aggregation each step, instead of
  sequential per-view generation, to avoid cross-view inconsistency.
  <https://ar5iv.labs.arxiv.org/html/2311.12891>
- **MVPaint**, **TexPainter**, **Make-A-Texture**, **Im2SurfTex** — later work on the same problem;
  Im2SurfTex specifically does neural back-projection to the surface, which is our step.
  <https://arxiv.org/html/2411.02336> · <https://arxiv.org/pdf/2502.14006>

### What this says about our pipeline
Our design is roughly Text2Tex minus the trimap and minus view scheduling, fed a broken depth map.
Fixing the control image is the prerequisite; adopting the trimap and a next-best-view schedule is
the substantive quality work. **ComfyUI** (<https://github.com/comfyorg/comfyui-controlnet-aux>)
is worth using as a scratchpad to compare conditioning types on one of our frames before wiring
any of them into the pipeline.

