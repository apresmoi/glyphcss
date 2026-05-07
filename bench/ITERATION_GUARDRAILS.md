# Perf-iteration guardrails

Rules of engagement for an automated (or human-driven) loop that proposes
performance changes to the polycss renderer. Lives next to the bench
harness because the harness is the only legitimate way to claim a perf
result — every change has to pass through it.

---

## Philosophy: polycss is **CSS-based polygon rendering**

The renderer's job is to translate parsed polygons into DOM + CSS such
that the browser composites the scene **using the CSS engine, not
JavaScript-driven per-frame paint**. JS exists at the API surface
(setOptions, custom elements, React/Vue) but must not own the per-frame
visual update.

Every proposed change is judged against this rule first. If the change
moves visual state from CSS into a per-frame JS write loop, it's out
of scope — even if it's faster.

---

## What's on the table

### ✅ Allowed: things you can change

- **CSS rules in `packages/polycss/src/styles/styles.ts`** — cascade
  variables, `calc()` shapes, `contain` declarations,
  `transform-style`, `backface-visibility`, `background-blend-mode`,
  `@property` registrations, the dynamic-mode rule body. The whole
  cascade is in scope.
- **Atlas pipeline in `packages/polycss/src/render/textureAtlas.ts`** —
  packing strategy, page count, encoding (canvas → blob URL), the
  `applyAtlasBackground` per-element writes, mask-image vs alpha-clip,
  page consolidation, atlas scale resolution.
- **`createPolyScene.ts`** — `setOptions` diff logic, `applySceneStyle`
  internals, the cull bin classifier (`classifyNormal`), how culled
  polys are hidden, `recomputeAutoCenter`, the auto-center wrapper
  structure.
- **DOM structure inside the scene** — adding wrapper divs, changing
  the parent-of-`<i>` chain, reorganizing how the cull/dir classes
  attach, as long as the scene element class names users depend on
  (`.polycss-scene`, `.polycss-mesh`, `<i>`) keep their public meaning.
- **Mesh post-processing** — the merge / normalize pipeline, dedup,
  poly-count reduction tactics that preserve visual output.
- **Bench harness itself** — better filters, more bimodal detectors,
  new mesh presets, new scenarios, smarter outlier rejection.

### ❌ Off-limits: things you cannot change

- **The four public APIs** — vanilla `createPolyScene` /
  `<poly-scene>` / React `<PolyScene>` / Vue `<PolyScene>`.
  Add fields if needed; never break existing ones in an iteration
  commit. (A breaking change is its own discrete commit, reviewed
  separately, never bundled with a perf-claim commit.)
- **`SceneHandle` contract**: `add` / `setOptions` / `destroy` /
  `host` / `getOptions`. Same rule — additive only mid-iteration.
- **The CSS-only render philosophy.** No `requestAnimationFrame` loop
  inside the renderer that writes inline styles per polygon per frame.
  No JS-computed `style.backgroundColor` / `style.filter` /
  `style.opacity` writes per polygon per frame to apply visual state.
  The cascade is the renderer; JS sets the inputs.
- **Visual output.** Every change must pass `pnpm bench:visual` (mean
  ΔE per channel ≤ 0.01 on chicken + rock1 × 3 azimuths). A change
  that fails visual is not a perf change — it's a different
  rendering. Reject.
- **Existing 820 tests.** All must stay green. A change that needs to
  drop tests should also explain *why* the test was checking the
  wrong thing.
- **Browser support.** No `chrome://flags`-only features. No
  experimental APIs not in evergreen Chrome / Safari / Firefox
  baselines. Houdini Paint API in particular is still partial — only
  acceptable as a progressive enhancement, not a requirement.

### 🤔 Gray areas (need an explicit call)

- **API surface additions.** Adding a new option (e.g., a
  `mergeStrategy` knob) is fine in principle but should land as its
  own commit with tests, not bundled with a perf claim that uses it.
- **New `textureLighting` modes.** Allowed only if they stay
  CSS-driven (e.g., a new cascade shape, a Houdini Paint worklet
  with a CSS fallback). Specifically forbidden: any mode whose
  per-frame work is JS DOM mutation.
- **Removing back-compat shims.** Case-by-case, but never inside
  an iteration commit — give it its own focused PR.

---

## How an iteration is structured

Each iteration follows a strict shape so results are reproducible and
attributable.

### 1. Hypothesis

A single sentence about what changes and why it might help.

> *Hoist the Lambert dot product into a per-poly registered
> property so rgb() doesn't recompute it 3× per channel.*

If the hypothesis spans multiple unrelated changes, split it. One
hypothesis = one iteration commit.

### 2. Baseline

Run the bench against the *current* main on the relevant mesh **before**
touching anything. Save:

```sh
pnpm bench:perf -- --label baseline
```

Output goes to `bench/results/baseline.json`.

### 3. Apply the change

Single, surgical diff. If the hypothesis turns out to need ancillary
refactors, abandon and re-scope — surgical first, structural later.

### 4. Re-bench + visual diff

```sh
pnpm bench:perf -- --label after
pnpm bench:visual                # MUST pass
pnpm -r test --run               # MUST pass
```

### 5. Decide

Compare `baseline.json` vs `after.json` on these axes:

| Metric                                | Acceptance criterion                         |
| ------------------------------------- | -------------------------------------------- |
| `dynamic.light_rotate.fps_p50`        | **Primary.** Improve ≥ 2 % on at least one mesh, OR |
| `dynamic.camera_rotate.fps_p50`       | Improve ≥ 2 %, OR                             |
| `dynamic.static.fps_p50`              | Improve ≥ 2 % without regressing the others  |
| Any of the above                      | **Cannot regress** > 2 % on any mesh         |
| `is_bimodal` flag                     | Cannot newly turn on for any scenario        |
| Visual diff `mean_delta`              | Each frame ≤ 0.01 (no exceptions)            |
| All package tests                     | All 820 must pass                            |
| All four renderer paths               | Cross-renderer regression > 2 % cancels even if vanilla wins |

Numbers below the noise floor (~2 %) don't count. Run-to-run variance
of ~1 % is normal even with the fresh-chromium-per-scenario fix.

### 6. Document outcome

Each iteration leaves a row in the iteration log (proposed location:
`bench/ITERATION_LOG.md`) with:

- Hypothesis ID, one-line summary
- Before / after p50 for the primary metric on each test mesh
- Visual diff max ΔE
- Verdict: **WIN** / **LOSE** / **FLAT** / **REJECT** (visual or test failure)
- One-sentence "why" — especially important for LOSE/FLAT, because
  knowing *why* an idea didn't work prevents the next iteration from
  proposing a sibling that fails for the same reason.

### 7. Tree-search winners; don't chase losers

If a hypothesis WINs, generate 2–3 sibling hypotheses that **build on**
the win (push the same lever further, combine with adjacent ideas,
test on a different mesh). If it LOSEs/FLATS, *do not* propose a near-
duplicate hypothesis — the cause that killed it likely kills the
sibling too.

---

## Standard test meshes

These three together cover the surface area worth measuring:

| Mesh     | Why it's interesting                                                |
| -------- | ------------------------------------------------------------------- |
| `chicken`| Small (648 polys), flat-color MTL materials. Cascade-driven path.   |
| `rock1`  | Tiny (194 polys), UV-mapped texture (`map_Kd`). Atlas-blob path.    |
| `saucer` | Large (6384 polys), procedural flat color. Stresses the cascade walk. |

Run hypotheses against **all three** before drawing conclusions. A
change that helps one and hurts another is a trade-off, not a win.

For "where does it break down?" research, bench `synth-10k`,
`synth-30k`, `synth-50k` — UV-sphere meshes built in the browser.

---

## Standard scenarios

The five always-on scenarios:

```
dynamic.static          (idle frame floor under cascade)
dynamic.light_rotate    (light-direction changes per frame)   ← primary
dynamic.camera_rotate   (camera transform changes per frame)
baked.static            (idle frame floor without cascade)
baked.camera_rotate     (camera transform changes, no light cost)
```

Per renderer (html / vanilla / react / vue) → 5 × 4 = 20 rows per mesh.
Run all four renderers on the primary metric to spot framework-tax
regressions.

---

## Cataloged dead-ends (don't repropose)

These have all been measured at one point or another and either
violated the architecture or regressed the numbers. Save the cycle:

| Hypothesis                                               | Why it doesn't work                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `textureLighting: "dynamic-js"` (per-frame JS Lambert)   | Architecturally out of scope (CSS-only philosophy).                          |
| `style.filter` on per-poly elements driven by JS         | Same.                                                                        |
| `clip-path` instead of `mask-image`                      | 4000+ `clip-path`s in `preserve-3d` = ~15 s/frame. Catastrophic.             |
| `opacity: 0.999` to force compositor layer               | Triple regression on light + camera + visual fail. Layer promo fights `preserve-3d`. |
| Per-poly `--polycss-tint` registered-property route      | Cascade walk still visits all polys; calc resolution into `background-color` re-paints. No win. |
| `filter: brightness(calc(...))` on the CSS-driven path   | Same — `calc()` in CSS still triggers `UpdateLayoutTree`.                    |
| `className`-swap to apply per-frame state                | Rule re-matching cost > inline style cost when `mask-image` is present.      |
| Bench-only frame-rate quantization to inflate fps        | Not a real win — only "worked" because identical-value writes were skipped, not from temporal throttling. |
| Atlas page consolidation (4 → 2 pages)                   | Larger atlas → much slower `toBlob()` encoding bleeds into the measurement window. Real regression. |

Re-proposing one of these requires explaining what changed since last
time — usually nothing has, and the answer is no.

---

## Output / housekeeping

- Per-iteration JSON lives in `bench/results/<label>.json` (gitignored).
- Iteration log goes in `bench/ITERATION_LOG.md` (tracked).
- Successful changes commit as `perf(<area>): <summary>`. Visual-diff
  baselines re-record only when the iteration *intentionally* changes
  pixel output — and that's its own commit (`fix(bench): re-record
  baselines after <reason>`), separate from the perf change itself.
- Failed changes don't commit code at all — only the log row.

---

## When to stop

The loop has natural stopping criteria. Stop when:

- Three consecutive iterations land FLAT or LOSE on the primary metric.
- The remaining hypothesis queue is exhausted and no new ones surface
  from the most recent traces / measurements.
- The trace-level cost driver (e.g., `UpdateLayoutTree` walking N
  polys) is structural — solving it would require an architecture
  change, not a tactical edit.

Claiming "no more wins" early, with evidence, is more honest than
churning. A loop that stops with a clear floor reading is a successful
loop, not a failed one.
