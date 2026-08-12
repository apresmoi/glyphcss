# Stateful ASCII-conditioned image generation

This research slice makes a generated image a **consumer** of glyphcss controls.
It does not alter glyphcss's ASCII paint path: every renderer `<pre>` keeps its
single-write contract. The companion image surface is an independently scheduled
WebGPU consumer.

## B57 coarse retrieved-base slice

The first runnable product path is deliberately smaller than the native
reference architecture:

1. `config/coarse-base-library.json` binds six actual PNG renders from the
   admitted B44 asset corpus by SHA-256, prompt tags, style, proxy geometry,
   camera neighborhood, and the B32 control contract.
2. `coarse:serve` exposes CORS-safe local/LAN retrieval. It scores prompt,
   style, geometry, scene, camera, coverage, and tensor compatibility. Camera
   divergence returns `fallback-required`; it never silently applies a distant
   base.
3. `browser/coarse-refiner-v1.json` is a separately exported 33-parameter RGB
   residual MLP, not arbitrary U-Net tail layers. It was fitted reproducibly to
   786,432 pixels from three actual pinned native-teacher continuation previews
   and consumes the retrieved base plus selected B32 planes, seed, prompt hash,
   and strength.
4. `/generative` presents the retrieved base and final canvas, their hashes and
   confidence, prompt/style/seed/camera controls, and explicit stale,
   divergence, fallback, refinement, and error states.

Run the service and website in separate terminals:

```sh
pnpm --dir research/ascii-image-generation coarse:serve -- \
  --host 127.0.0.1 \
  --artifact-root /tmp/glyphcss-coarse-b57
pnpm dev:website
```

Use `--host 0.0.0.0`, then enter the LAN URL in the workbench's Service field,
to serve another machine. The service defaults to port `47331`. Integrity and
intervention checks are:

```sh
pnpm --dir research/ascii-image-generation validate:coarse
pnpm --dir research/ascii-image-generation train:coarse-refiner
```

The fresh-keyframe endpoint serves an actual SDXL + depth-ControlNet
intermediate captured on `gpu-4090`. Its manifest binds the anchor, model, VAE,
scheduler, timesteps, scaling, prompt, control, initial noise, three
continuation starts/noise tensors, and decoded preview hashes. The local service
persists a manifest copy, all three previews, and a request pointer. This coarse
slice has one exact captured request; any other prompt, style, seed, scene,
tensor contract, geometry, or camera returns `409 native-keyframe-unavailable`
instead of inventing a surrogate result.

The public Diffusers fp16 continuation path is reproducible and measured but its
unperturbed decoded preview is not byte-exact with the uninterrupted baseline:
mean absolute RGB8 drift is `0.411678`, maximum `56`. The report makes no exact
resume, native-reference quality, or browser-performance claim.
`reports/coarse-slice.json` records the authority and remaining refinements.

## Selected slice

Native B12–B16 work uses SDXL Base 1.0 plus the stock diffusers SDXL depth
ControlNet as its capable reference pipeline. Both repositories are pinned by
immutable commit before download. This reference runs natively at 1024 × 1024;
it is not constrained by browser payload size. Training remains gated behind
the stock-pipeline generation and control-causality pilot:

| Job | Selected path | Runs when |
| --- | --- | --- |
| Native reference | SDXL Base 1.0 + stock SDXL depth ControlNet | pre-training integration and causality evaluation |
| Browser keyframe candidate | BK-SDM-Small + `GlyphKeyframeAdapter` | later distillation/export work only |
| Temporal correction | `GlyphTemporalRefiner` RGB residual network | after deterministic reprojection, only for holes/correction |
| Appearance | separate style deltas on the eventual frozen browser U-Net | selected by the user; never merged into training data |

`GlyphKeyframeAdapter` is a proposed, trainable T2I-Adapter-shaped conditioning
encoder, not a claim that an off-the-shelf T2I-Adapter checkpoint fits BK-SDM's
compressed U-Net. Its frozen B32 input stem has 17 channels and emits residuals at each
compatible BK-SDM down/mid block. `GlyphTemporalRefiner` is a proposed
feed-forward, 512-pixel RGB residual network with no diffusion loop. Its bounded
job is to repair a warped image, which is why it is the browser's asynchronous
path rather than a second full generator. B12/B13/B28 must prove that each branch
uses its controls; neither is treated as working because this document selects it.

The fixed reference target is Chrome for Testing Chromium 140.0.7339.80
(revision 1496484, SHA-256 `7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546`)
running on LeDeluge's NVIDIA RTX 4090 Laptop GPU with 16 GB VRAM. Playwright
1.58.2 is only the test client; it launches that pinned Chromium executable.
The harness requires hardware-accelerated WebGPU and an NVIDIA adapter. It
records OS, driver, CDP GPU, and adapter identity with every trace and rejects
fallback, CPU, Mesa, SwiftShader, and WASM paths. B37 first makes one untimed
exact CPU-oracle/readback/checkpoint/presentation comparison over all 326
transitions, then times 40 complete B47 GPU-resident atlas runs through one persistent canvas;
the timed path has no readback, hashing, full-state serialization, CPU
reprojection, evidence digest, or `<pre>` output. Acceptance waits for GPU
completion and two compositor frames. A separate bounded eight-transition
`submitProfiled()` run records routing, upload, dispatch, render, canvas-submit,
GPU-completion, and compositor/presentation phase decomposition, WebGPU
compute/render timestamps when `timestamp-query` is exposed, and independently
recomputed CDP presentation-event correlation; none of that instrumentation
enters the 40×326 acceptance loop.
Browser-model export separately requires the features selected by
B17/B18. This is a local-only experimental target, not a promise of universal
or mobile support.

The frozen B37 latency population is
`fixtures/reprojection/reference-trace-v1.json`. It derives 326 frames from the
exact B7 camera paths at B40's separately hash-bound, bounds-fitted public
80×24 corpus expansion using a frozen 32-subdivision cadence. It uses
`reprojectGlyphSurfaceAtlas` at its public atlas-size 64 default, pins the
configuration, manifest, input, frame, and expected-event hash chains, and
retains slow/fast motion, winner swap, reveal/disocclusion, and resets. It is
ready for deterministic presentation timing, while its honest structural
result remains minimum coverage 0.04
and maximum newly revealed area 0.96, which cannot pass the unchanged 0.9/0.2
G5 limits. B37 therefore emits a schema-validated `partial-non-pass` artifact;
it cannot claim full G5 acceptance, whose keyframe/refiner signals belong to
B20. The earlier exact-hardware
B24 trace is preserved at the hash-bound remote `preserved-red` path.
The remote launcher requires partial-artifact integrity and presentation p95
≤33.3 ms, not a full G5 pass.
The frozen contract SHA-256 is
`041dd4d9f126261adf00b541354251fef52fe938c83d9ba06fce4cba3cc7df9d`;
its expected-event SHA-256 is
`7bff12fb2738ad116cc5ef93f9395785ef9071ac74569792322ad0855ac0af4f`.
The enclosing measurement contract is independently bound at v3 canonical
SHA-256
`122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9`;
the unchanged G5-only signature is
`0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e`.
Prior attempts are runnable with
`node scripts/reproduce-prior-reference-attempt.mjs b7-unframed-public-80x24`
and
`node scripts/reproduce-prior-reference-attempt.mjs b40-bounds-fitted-atlas8`.

## Native-reference provenance

The native authority is `stabilityai/stable-diffusion-xl-base-1.0` at
`462165984030d82259a11f4367a4eed129e94a7b` plus
`diffusers/controlnet-depth-sdxl-1.0` at
`17bb97973f29801224cd66f192c5ffacf82648b4`. The strict required-file contract,
including upstream model cards, license, default safetensors, configurations,
and tokenizers, is in `config/native-reference-model.json`. Runtime inference
casts those weights to float16. Large files stay below
`/mnt/docker-data/glyphcss-ascii-image-generation/models/native-reference/`.
The freeze report is deliberately absent until the remote cache supplies every
artifact byte and its computed SHA-256; a configuration pin alone is not a
passing preflight.

```sh
python3 research/ascii-image-generation/scripts/freeze-native-reference.py \
  --config research/ascii-image-generation/config/native-reference-model.json \
  --cache-root /mnt/docker-data/glyphcss-ascii-image-generation/models/native-reference \
  --report research/ascii-image-generation/reports/native-reference-model-preflight.json

# Re-hash every cached byte against the sealed report:
python3 research/ascii-image-generation/scripts/freeze-native-reference.py \
  --check \
  --config research/ascii-image-generation/config/native-reference-model.json \
  --cache-root /mnt/docker-data/glyphcss-ascii-image-generation/models/native-reference \
  --report research/ascii-image-generation/reports/native-reference-model-preflight.json
```

The hash-bound prompt-only/correct-control/wrong-control comparison is
`reports/native-reference-review.json`. At 1024 × 1024 and 24 steps, the initial
cottage run completed in 21.06 s and the cottage run at control scale 0.65 is
the current best integration evidence (21.37 s; both measured 8,461,024,768
peak VRAM bytes). The wrong-car control changes the cottage result,
which is positive stock-depth causality evidence. The rabbit hybrid and car
failure are retained as rejected evidence. None of these runs proves the custom
17-channel control path or authorizes training, redistribution, hosting, public
browser bundles, or transfer of derived weights.

The reviewed runs loaded the repositories' default, non-suffixed safetensors
and cast them to float16 at runtime; the freeze binds those exact files rather
than unrelated `.fp16.safetensors` variants. Before B12 training can be enabled,
the remote host must also pass one measured ControlNet training step:

```sh
pnpm --dir research/ascii-image-generation smoke:native-training
```

That smoke is bound to the native config, passing model preflight, container
digest, exact model revisions, optimizer and memory policy. It records finite
loss, forward/backward/step time, runtime versions, GPU identity, total VRAM,
and peak allocated/reserved bytes under the strict 16 GiB limit. No report is
committed before the remote run. The old BK-SDM latent-residual trainer now
fails closed with `B12_SDXL_ADAPTER_NOT_IMPLEMENTED`; implementing the actual
SDXL 17-channel injection architecture is a separate required change.

## State packet and transition

Each camera update receives the real rasterizer's complete frame, not a second
projector. The fixed model control tensor is:

```
K = [visibleGlyph(1), semanticGlyph(1), semanticControlColor(3), depth(1),
     normal(3), worldPosition(3), surfaceUv(2), surfaceUvValid(1),
     coverage(1), shade(1)]                                           // 17 channels
T = [warpRgb(3), reprojectionValid(1), disocclusion(1),
     atlasConfidence(1), K(17)]                                        // 23 channels
```

`surfaceId` is deliberately **not** an appearance feature: it is an exact atlas
routing and depth-validation key. It remains a separate control map and is never
inferred from shade glyphs. `K` feeds the keyframe adapter; `T` feeds the
temporal refiner. Both packet layouts, channel scaling, scene depth/world
normalization, empty sentinels, dictionary/font binding, and glyph font are B32
versioned schema facts, not ad-hoc preprocessing. Raw winner/class/instance/
surface IDs remain atlas-routing controls and are deliberately absent from model
tensors.

### Model raster authority

The native asset corpus is stored as `256 × 128` glyph cells with
`cellAspect: 2`. That is physically a `256 × 256` view. Before either training
or evaluation, `src/model_raster.py` applies the one frozen
`glyph-model-raster/physical-cell-letterbox-v1` **contain** transform to the
raw RGB target and all 17 control planes. Every plane uses nearest sampling at
this boundary, so each model-raster pixel still refers to the RGB and all
control values from one exact raw depth-winning cell. Only the later
model-to-latent reduction differs: categorical planes stay nearest, while
depth, normals, world position, UV, and shade use bilinear reduction. The
surrounding letterbox is zero for both target and controls. A target whose raw
pixels, control `cols`/`rows`, or `cellAspect`
disagree with the frozen source metadata rejects before training; there is no
generic square-resize fallback. Every target record also carries the matching
`modelRaster` declaration before it is training-eligible, so a target/control
pair cannot merely have the same dimensions while claiming a different
physical source grid. Legacy/provider target records may omit this optional
field for archival validation, but the B12 selector rejects them.

The checked JSON contract is structurally identical to glyphcss's bundled
`controlTensorContract.json` and both bind the same SHA-256. Each packet also
carries a separately hashed, immutable instance containing its scene hash,
font/dictionary IDs and hashes, and concrete depth/world normalization bounds.
`validate:tensor` rejects contract drift and runs a Chromium-versus-Node Float32
byte and SHA-256 golden before it reports success.

1. A camera move produces the new glyphcss control frame and a monotonically
   increasing `stateVersion`.
2. WebGPU reprojects atlas texels by `(surfaceId, UV)` into the new winner/depth
   frame. It emits `warpRgb`, validity, disocclusion, and confidence; known texels
   are immediately presented.
3. If valid visible coverage is at least 55% and no reset condition applies, a
   temporal-refiner job is queued with `stateVersion`. Its residual is masked to
   invalid/disoccluded cells plus a bounded correction mask. A late job is dropped
   unless its version still equals the visible state.
4. A compatible result splats only high-confidence texels back into the per-surface
   atlas. The current frame then becomes the next state's provenance.
5. A keyframe is requested for no atlas, dictionary/font/model hash mismatch,
   valid coverage below 55%, newly revealed visible area above 45%, three rejected
   refinement results in a row, device loss, or an explicit reset. A keyframe
   replaces only the affected surface-atlas tiles and records the reset reason.

The thresholds above are architectural safety defaults. B25 freezes their
evaluation population and any acceptance limits before pilot evaluation; no result
may silently revise them. Presentation is expected at 30 fps through step 2;
keyframe and refinement rates are independently reported. A 33.3 ms p95 gate
applies to presentation only, never to a claim of fresh neural generation.

## Artifact and runtime policy

Source code, contracts, tiny fixtures, hashes, and reports belong in Git.
Datasets, targets, checkpoints, ONNX graphs, caches, and browser weight bundles
are **local-only** under `/mnt/docker-data/glyphcss-ascii-image-generation/` and
are ignored. No provider, training, or browser bundle is started by this decision.
Credentials are environment-only. Every downloaded model records repository,
revision, SHA-256, license text/hash, and the source URL in its run manifest.

## B9 target-provider boundary

`generate:targets -- --fixture --provider mock --check` is the only enabled
target generation command before B11 grants a request ledger. It uses an offline,
deterministic provider and reports API-call count, candidate count, per-request
input cost, per-candidate output cost, and their aggregate separately. Those
all-in estimates are caller-frozen from the approved provider pricing/token
budget rather than silently guessed by the target runner. Admission reads the
hash-valid B7 corpus and trajectory plus
both complete B6 bundle trees; all nine next-control roles must resolve to their
actual frame files and hashes. Target records preserve that complete request,
the accepted previous target, style/license provenance, response request id,
attempt history, candidate lineage, and image hash.
They are content-addressed below the configured artifact root and resume only
when the complete request identity matches.

A deterministic upload stage first encodes every admitted B6 map as a valid PNG,
records its normalization/legend and byte SHA-256, and binds that exact PNG to a
provider file ID or HTTPS URL in a content-addressed upload manifest. Arbitrary
references cannot enter a request directly. Visible and semantic ASCII controls
are cell-aligned glyph bitmaps rendered with B4's committed IBM Plex Mono font
bytes and pinned `cell-8x12` raster settings; their legends bind the font,
raster-config, renderer-provenance, and PNG hashes. Numeric controls retain
explicit role-specific visual encodings. The optional OpenAI provider follows
the official [Image API guide](https://developers.openai.com/api/docs/guides/image-generation):
both trajectory keyframes and following frames use `/v1/images/edits`. A
keyframe submits only the nine explicit next-view control images; an edit
submits the hash-validated accepted prior image followed by those same controls.
Its API key is read only from `OPENAI_API_KEY`,
never accepted as a constructor argument or stored in a request record or log.
A durable atomic provider ledger records every attempt and completed response
separately from the publication tree. Publication resume revalidates the request,
target metadata, image bytes, and complete tree hashes before reuse. An
unresolved pending/failed ledger stops for explicit reconciliation rather than
silently duplicating a paid request. Only documented 429/5xx and transient
transport failures retry. Plan concurrency is bounded and a caller-supplied
aggregate cost ceiling is checked before provider work; dry-run reports
per-request and aggregate API-call, candidate, and cost counts. No test or fixture
invokes the network provider.

The first B11 pilot has no provider route. `build-native-pilot.mjs` links only
B45-admitted, renderer-exact RGB frames from B43's split-safe asset registry.
Both build and validation rerun B45's production admission reconstruction
against the frozen B10 contract and the B44/B48 aggregate artifact trees; a
schema-valid or re-sealed admission report is not sufficient.
It records the B45 report hash, renderer target/control hashes, source pack,
canonical geometry, texture, camera, pose, occlusion, lighting, and B10
acceptance for every frame. Material-only records are retained as explicitly
excluded evidence; they cannot enter the exact-RGB image population. The
builder reconstructs the 77-source census directly from B43, recording every
source as represented or as an explicit admission failure. The matching B12
selector accepts only this `native-exact-rgb/v1` authority and the frozen
physical-cell model-raster declaration. Validation also requires exact
accepted-frame and material-record bijections, reconstructs every pilot field
from the registry and sealed asset/control manifests, and freezes explicit
validation/test appearance populations with configured minimum floors.

The OpenAI/provider implementation remains legacy teacher infrastructure for
the post-baseline experiment only. It is not B11 authority and a provider
target cannot be selected by B12's native pilot preflight. Validate a completed
remote native dataset with:

```sh
research/ascii-image-generation/scripts/validate-dataset.sh \
  /mnt/docker-data/glyphcss-ascii-image-generation/datasets/pilot \
  --report research/ascii-image-generation/reports/pilot-manifest.json --check
```

The training container independently validates the emitted target metadata and
image hash with `pytest -q /workspace/research/ascii-image-generation/tests/test_training_target_consumer.py`.

Approximate payloads are estimates, not measurements: BK-SDM-Small's 0.66B
parameters are about 1.23 GiB at fp16 before graph/runtime overhead; a 40M
fp16 control adapter is about 76 MiB; a 30M fp16 refiner about 57 MiB; each
512² RGBA8+R8 atlas tile is 1.25 MiB. Actual download, peak GPU memory, and
latency are G6 evidence, not extrapolations from these figures. Training is
adapter/refiner/LoRA-only with frozen base weights, fp16/bf16 as validated,
batch 1, gradient accumulation and checkpointing; this is a 16 GB feasibility
strategy, not a verified VRAM result.

Read [decisions.md](./decisions.md) for the accepted/rejected alternatives and
[references.md](./references.md) for source evidence and license handling.

## LeDeluge training container

The B8 image is only a GPU-toolchain smoke environment; it never downloads a
base checkpoint. Build and run it through the remote Docker context:

```sh
research/ascii-image-generation/scripts/remote-smoke.sh --check
```

It pins the CUDA/PyTorch base by registry digest. The base digest pins its
preinstalled dependency graph; `docker/requirements.lock` is a hash-locked,
no-dependency overlay containing every package the B8 build adds or changes,
and the build runs `pip check`. The pinned upstream image reports only its
pre-existing `ninja 1.11.1.1 is not supported on this platform` defect; the
Dockerfile permits exactly that output and rejects every other dependency error.
The container runs as
UID/GID `10001`, mounts only `/mnt/docker-data/glyphcss-ascii-image-generation`
at `/artifacts`, and writes checkpoints, run metadata, and B25-adapter evidence
there. Credentials are runtime environment variables for later jobs; never copy
them into a Dockerfile, build context, image, or repository.

The Docker build context has its own deny-all `docker/.dockerignore`; only the
Dockerfile, that ignore file, the dependency lock, and `smoke.py` cross the
remote build boundary. The image build audits that exact manifest and
`remote-smoke.sh` verifies the embedded audit before starting a GPU job. Regenerate
the overlay lock from `docker/requirements.in` with:

```sh
uv pip compile docker/requirements.in --output-file docker/requirements.lock \
  --generate-hashes --no-deps
```

`--check` stages a complete B25 evidence root, replaces
G7 with the real smoke report (unproved later gates and the B23-owned secret
and large-artifact audits remain numeric failures, never fabricated passes),
runs the existing evidence and Oven adapters, copies the outputs to the mounted
remote root, copies them back, and repeats both check commands byte-for-byte.

To prove checkpoint restoration, point the smoke at a prior remote run; it
loads that checkpoint before its next mixed-precision step and records the
source path in the new run manifest:

```sh
research/ascii-image-generation/scripts/remote-smoke.sh --check --resume-run remote-smoke-YYYYMMDDTHHMMSSZ
```
