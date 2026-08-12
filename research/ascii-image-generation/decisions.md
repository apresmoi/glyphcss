# Decisions — Stateful ASCII-conditioned image generation

## 2026-07-23 — Rejected: lossless semantic/surface extraction through color-only passes

**Evidence.** `probes/control-alignment.test.ts` drives the production
`buildRasterizeContext` → `rasterizeToCells` path with an immutable B31 scene,
including two tessellated polygons for one surface and two instances of one
class. Checked-in winner/coverage masks, hashes, and landmarks cover
orthographic, adjacent orthographic, perspective, perspective SS=2, and partial
cross-layer-occlusion renders. The probe also proves that an SS=1 semantic-color
pass resolves the B31/B4 control color for every retained visible winner in the
orthographic, adjacent orthographic, and perspective fixtures. That limited
SS=1 color result is not a proof of distinct surface identity: same-class
instances intentionally share the same semantic color.

That is insufficient for G0. The same probe's adversarial supersample-2,
one-output-cell fixture has red and green semantic owners in different covered
subcells. `downsampleSolid` box-averages the color to olive while its depth,
world-position, normal, and UV fields select one nearest-center subcell. Olive
is not a semantic color and contains no discrete winner identity. Therefore a
color-only pass cannot recover the semantic or stable surface ID exactly for
the final retained correspondence fields, even though ordinary SS=1 scenes
appear aligned.

**Approved implementation boundary.** The user approved an optional,
renderer-retained positional winning-polygon buffer. It is written in
`scanFillTriangle` alongside depth and, under supersampling, copied from the
*same representative subcell* as depth/world-position/normal/UV. `-1` means
empty or cross-layer-occluded. It is off by default and is not a semantic label.

The authoritative control lookup is
`polygon → surface → instance → class → dictionary`. The dictionary owns the
class's semantic glyph and control color; visible shade glyphs stay a separate
appearance palette. Two surfaces or instances may share one class while
remaining distinct positional/control identities. The scene and compiler's
`glyphOutput: "visible" | "semantic"` is an output selector using this single
rasterization result, not a new render mode or a second projection pass.

**Frozen extraction rule.** The retained `winnerPolygon` buffer is the sole
spatial lookup path for semantic/control extraction. Every nonempty cell first
looks up its positional winner in the immutable polygon order, then resolves
that exact index through the scene's polygon-surface, surface-instance, and
instance-class records before consulting the dictionary. A tessellated surface
may therefore repeat one surface ID across several polygon indices, and several
instances may share a dictionary class, without conflating their raw identities.
No color decode, reverse glyph table, or second projection/raster pass is an
accepted substitute. The B3 golden probe exercises this against empty and
partially cross-layer-occluded cells, two camera models and an adjacent view,
authored UVs, depth/shade/normal/world fields, SS=1 semantic-color agreement,
and SS=2 winner retention. Its frozen masks reject a shifted or swapped winner
even when coverage remains unchanged.

## 2026-07-24 — Selected: SDXL Base 1.0 plus stock SDXL depth ControlNet as native reference

**Decision.** Native B12–B16 authority is
`stabilityai/stable-diffusion-xl-base-1.0` at immutable revision
`462165984030d82259a11f4367a4eed129e94a7b` plus
`diffusers/controlnet-depth-sdxl-1.0` at immutable revision
`17bb97973f29801224cd66f192c5ffacf82648b4`. This is a capable native
reference, so browser bundle size is not an acceptance criterion. BK-SDM-Small
is historical browser-student/distillation work only and cannot authorize
native training.

**Evidence.** The 1024 × 1024, 24-step stock pilot fits the target RTX 4090
Laptop GPU at 8,461,024,768 peak VRAM bytes. The cottage with correct depth at
control scale 0.65 is the current best run; prompt-only and wrong-car-control
runs form the required causal comparison. Their reports and images are sealed
by `reports/native-reference-review.json`. The rabbit hybrid and car result are
rejected evidence. This establishes stock depth integration and causality only,
not the proposed 17-channel adapter.

**Gate.** `config/native-reference-model.json` and
`schema/native-reference-model.schema.json` require exact upstream files,
source texts, immutable revisions, byte sizes, and SHA-256 values. No production
preflight is committed until the remote cache manifest is available and
`freeze-native-reference.py` hashes every required byte. A passing freeze still
does not grant redistribution or publication authority.

The reviewed images loaded the default non-suffixed safetensors and cast them
to float16 at runtime. The freeze binds that actual artifact set; it does not
substitute the repositories' separately named fp16 variants. A measured,
hash-bound single ControlNet training step must also pass the 16 GiB feasibility
contract before native adapter training can be enabled.

## 2026-07-23 — Historical browser candidate: BK-SDM-Small keyframes plus deterministic atlas and feed-forward temporal repair

**Historical scope.** The proposed browser vertical slice uses
`nota-ai/bk-sdm-small` at 512 × 512 or below, with frozen base weights, a new
`GlyphKeyframeAdapter`, independently swappable rank-8 style LoRAs, and a new
`GlyphTemporalRefiner`. The stateful atlas/reprojection path is the presentation
path; the refiner is asynchronous. Training runs only through `gpu-4090` Docker
context and large artifacts stay local-only under
`/mnt/docker-data/glyphcss-ascii-image-generation/`.

**Why this base.** Its model card documents a 0.49B U-Net and 0.66B whole model,
and that it can be loaded through `StableDiffusionPipeline`. That is materially
smaller than the SD 1.4 lineage it preserves, while retaining the 512-class
latent-diffusion shape needed for this first slice. The license/provenance
manifest must pin the exact downloaded revision and license text before a run.
BK-SDM's card inherits SD-v1 usage restrictions; it is accepted only for the
local research/demo scope while those restrictions and attribution travel with
every bundle. Weight publication, public hosting, or a commercial claim is
explicitly outside this decision and stops for a license review.

**Conditioning.** A stock T2I-Adapter establishes that lightweight adapters are
an accepted conditioning mechanism, but no public adapter is asserted compatible
with BK-SDM's altered U-Net. We will train an adapter whose frozen B32 17-channel control
stem sees the full aligned glyphcss control packet and injects learned residuals
into BK-SDM's actually exported block interfaces. This is custom work and fails
closed if B13 cannot export every operation to the declared WebGPU runtime.

**Refinement.** The temporal model is an RGB residual U-Net (proposed 30M-parameter
cap), not a second diffusion system. Input is the frozen B32 23-channel `T` packet in the
README; output is RGB residual, alpha/confidence, and correction mask. Loss gives
invalid/disoccluded pixels priority and penalizes valid-region damage. It exists
to improve state continuity; it must not be described as a general keyframe
generator. The control-causality and prior-frame ablations are required gates.

**Browser.** ONNX Runtime Web WebGPU is selected because its official API has a
WebGPU execution provider, static-shape graph capture, GPU-buffer I/O binding,
and explicit GPU-resource lifecycle rules. The atlas and control packet remain
on GPU. The fixed reference is Chrome for Testing Chromium 140.0.7339.80
(revision 1496484, SHA-256 `7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546`)
on LeDeluge's NVIDIA RTX 4090 Laptop GPU with 16 GB VRAM. Playwright 1.58.2 is
the launcher, not the browser pin. The harness requires `navigator.gpu` and that
exact NVIDIA adapter, records `shader-f16` availability plus resolved OS/driver
identity, and stops on integrated-GPU, CPU, Mesa, or SwiftShader selection.
The app rejects a session unless every graph reports WebGPU execution; there is
no WASM/CPU success path for G6. Device loss is an explicit reset case.

**State.** Atlas routing uses stable `surfaceId` + authored UV, then checks the
target frame's real depth/coverage winner. It never routes by semantic class or
visible glyph. Valid coverage ≥55% permits refinement; coverage <55%, new visible
area >45%, missing/hash-mismatched atlas, repeated failed refinements, device
loss, or manual reset requests a keyframe. Each queued result is tagged with a
state version and discarded if stale. The immediate reprojection frame must meet
p95 ≤33.3 ms. Neural keyframe/refinement latency is a separate metric.

**Style.** Style A/B are rank-8 LoRAs over the frozen base U-Net. They remain
separate deltas with hashes and can be selected independently. Browser export
will expose their low-rank additions as explicit graph inputs or separate,
hash-addressed graph bundles; B18 must choose and prove one. This is an export
implementation choice, not an unresolved architecture choice: style data never
mixes with structural controls or temporal state.

## 2026-07-23 — Rejected: SSD-1B for the first slice

`segmind/SSD-1B` is attractive because its card declares Apache-2.0. It is not
the first slice because the same card says it is a 1.3B-parameter SDXL-derived
model, documents 1024-or-larger supported resolutions, and reports training on
four A100s. Those facts do not prove that adapter/refiner training or a 512
browser graph fits the 16 GB target. It remains the license-clean escalation
candidate if BK-SDM's inherited terms prevent the intended distribution or if a
measured later bake-off justifies its higher resource cost.

## 2026-07-23 — Rejected: full ControlNet and unverified LCM substitution

A full ControlNet duplicates substantial U-Net capacity and is an unnecessary
first fit for 16 GB. A T2I-Adapter-shaped branch is smaller and, unlike a full
ControlNet, leaves the frozen base path unchanged. LCM-LoRA is not selected:
available LCM-LoRA checkpoints target SD v1.5, not BK-SDM's compressed block
layout. Distilling BK-SDM to few-step sampling is a possible later experiment,
but is deliberately not asserted as a present capability or dependency.

## 2026-07-23 — Replaced: invalid B24 G5 measurement population with a B7-derived trace contract

The first exact B37 browser/GPU run is preserved as red evidence at
`/mnt/docker-data/glyphcss-ascii-image-generation/reference-browser/runs/reference-g5-contract-20260723T002000Z/`.
Its trace SHA-256 is
`4b9d7ef97a9d765067aa019f598e147117507c3e0e9530ac44ce206f89d35c7d`;
the normalized-summary and GPU-diagnostic hashes are
`25a6b35665a89ef4999eb1259e40ab05c8a972164e0c4f5966d043d901a19e70`
and `ae10ce5527d6b305ad97ccbd4ada3e3d2ceb499b3fc46471b04e953e0492ac0c`.
It is not deleted or rewritten.

Only its G5 measurement population is superseded. The B24 two-cell parity
probe intentionally exposes one of two cells, so both its coverage and newly
revealed-area ratios are 0.5 and cannot satisfy the already frozen G5 domains
of coverage ≥0.9 and newly revealed area ≤0.2. Numeric thresholds, formulas,
aggregations, Chrome-for-Testing revision, image, and RTX 4090 requirement are
unchanged.

`fixtures/reprojection/reference-trace-v1.json` records the attempted dated
replacement. It uses the exact B7 scene/material/camera paths with B40's
separately hash-bound bounds-fitted expansion at glyphcss's existing public
80×24 default, interpolating each endpoint leg into 32 equal steps fixed before
timing. It evaluates `reprojectGlyphSurfaceAtlas` once at its public atlas-size
64 default. It pins the corpus configuration and manifest plus the complete
input-frame and expected-event hash chains. Its 326-frame population retains
slow/fast motion, a real winner swap, reveal/disocclusion, and six resets; fast
motion remains numerically faster than slow motion. The earlier atlas-size 8
red attempt is retained in the contract and was not substituted for the public
default.

That honest population remains structurally red: minimum coverage is 0.04 and
maximum newly revealed area is 0.96 (reset frequency is
0.018404907975460124). The tiny B7 geometry occupies too few cells for a real
winner change to remain below the unchanged per-frame G5 min/max ratios. The
contract preserves those values instead of selecting gentler camera frames or
inventing a passing value. They do not block B37's deterministic presentation
timing. B37 writes a separate schema-validated `partial-non-pass` artifact with
numeric presentation-owned signals and explicit null reasons for neural or
keyframe-only signals. Its launcher requires artifact integrity and
presentation p95 ≤33.3 ms, but cannot report full G5 pass. B20 later supplies
the full keyframe/refiner report to unchanged B25 G5 acceptance.
The replacement contract is bound as SHA-256
`041dd4d9f126261adf00b541354251fef52fe938c83d9ba06fce4cba3cc7df9d`
and expected-event SHA-256
`7bff12fb2738ad116cc5ef93f9395785ef9071ac74569792322ad0855ac0af4f`
in the trace, partial adapter, launcher manifest, and baseline report.
The enclosing measurement contract v3 canonical SHA-256 is
`122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9`.

### 2026-07-24 — reference input-lineage rebind for tensor contract v2

Adding the explicit `surface-uv-valid` plane changes the B32 tensor contract
from K=16/T=22 to K=17/T=23 and therefore changes the generated reference
corpus manifest plus input/frame lineage hashes. The B39 camera events,
reprojection results, structural measurements, frozen G5 signature, and
measurement contract do not change. The reference fixture and remote
preflight are rebound only to the reproducibly generated v2 corpus manifest
and input/frame hashes; the unchanged event hash remains the authority that
this is not a post-measurement workload or threshold change.
Its G5-only signature remains independently frozen at
`0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e`,
so unrelated contract evolution cannot change B37's formulas, aggregations,
unwired flags, or thresholds.

## 2026-07-23 — Rejected: per-move independent generation and model-in-the-renderer

Generating a fresh image on every mouse event loses correspondence, cannot make a
credible 30 fps interaction claim, and wastes known surface texels. Putting an
ML loop into glyphcss would also violate its single-`<pre>` render boundary.
Persistent atlas reprojection lives beside the renderer and makes all unknown
areas explicit for the asynchronous repair path.
