# @glyphcss/effects

Reusable spatial effects for glyphcss render surfaces. Effects are ordinary,
shareable definitions: mount one as a scene layer, then animate its stable
parameter object with Anime.js, another animation library, or a small custom
loop.

```ts
import { createGlyphScene } from "glyphcss";
import { GlyphEffects } from "@glyphcss/effects";

const scene = createGlyphScene(host, { autoSize: true });
const rain = scene.addEffectLayer({
  effect: GlyphEffects.matrixRain,
  blend: "replace",
  params: {
    glyphs: "HOLA",
    speedMin: 5,
    speedMax: 12,
    colorMode: "monochrome",
    color: "#00ff66",
  },
});

function frame(now: number) {
  rain.params.time = now / 1000;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

The package does not own a clock or require an animation dependency. The same
definitions work with vanilla glyphcss and its React and Vue layer wrappers.

`GlyphEffects` bundles nine stock definitions, each mountable via
`scene.addEffectLayer({ effect: GlyphEffects.<name> })` or its named export
(`GlyphMatrixRainEffect`, `GlyphFlowTextEffect`, `GlyphScanEffect`,
`GlyphWipeEffect`, `GlyphScrambleEffect`, `GlyphGlitchEffect`,
`GlyphNoiseDissolveEffect`, `GlyphRippleEffect`, `GlyphFieldSynthEffect`):

- **matrixRain** — deterministic text strands that flow over visible surfaces.
- **flowText** — repeats a word and moves it continuously across the surface domain.
- **scan** — a luminous scan band moving through the rendered surfaces.
- **wipe** — a directional reveal mask suitable for direct progress animation.
- **scramble** — randomly substitutes glyphs while retaining the model silhouette and shading.
- **glitch** — bursts of deterministic banded glyph corruption and color.
- **noiseDissolve** — a stable procedural dissolve that can be scrubbed with one progress value.
- **ripple** — concentric glyph and color waves in canonical scene coordinates.
- **fieldSynth** — a composable oscillator synth: up to nine voices, each pairing a
  field (`radial`/`linearX`/`linearY`/`diagonal`/`angular`/`spiral`/`noise`, `linearZ`
  under the volumetric branch, plus the SDF family `gyroid`/`menger`/`sierpinski`)
  with a waveform (`sin`/`triangle`/`saw`/`square`/`step`), combined
  (`add`/`multiply`/`max`/`min`/`difference`/`argmax`) into one scalar mapped to a
  glyph ramp and color over a `space`. `argmax` is categorical — each region takes
  the winning voice's flat level (and, with `voiceColors`, its color), which makes
  hard-edged tilings possible. Each voice also carries `angleN` (rotates its
  sampling frame), `originUN`/`originVN`/`originWN` (its own center offset — for the
  SDF family this TRANSLATES the sampled point rather than just anchoring a
  distance measurement, so an SDF voice can be aligned to its host mesh), `dutyN`
  (the square wave's high fraction), and `phaseN` (a cycle offset — the only way to
  phase-shift a linear field, since voice origins don't; for an SDF voice `phase` is
  instead an iso-level offset that erodes/dilates the solid). `amp` is a per-voice
  mix weight rather than a gain, `lit` modulates the output color by surface
  shading, and `voiceColors` blends each active voice's own color instead of a
  single value gradient. `subcellRes` picks the output encoding: `"1x1"` (one ramp
  glyph per cell), `"2x4"` (Braille subcell dots), or `"ink"` (contour lines of the
  field, with `inkLevels` setting how many). Voices can also opt into one of three
  `layer1..9` groups, each with its own threshold/invert/blend into the next layer —
  this is what makes a per-scale rule like Menger-sponge membership expressible,
  which a flat voice fold cannot reach. Under `space: "object"` (a volumetric field
  in the mesh's own 3D frame, like matrix rain's `"object"` mode), `render: "carve"`
  raymarches the field into hollow interior structure, and `render: "xray"`
  integrates density along the whole chord into a transmittance brightness instead.
  `render: "carve"` also accepts `subcellRes: "2x4"`/`"ink"` (ink-over-carve
  contours the march's hit/hole boundary; braille-over-carve marches 8 sub-rays
  per cell) — only `render: "xray"` still requires `"1x1"`. For a program that is
  provably a distance field (a single `min`-combined layer of `menger`/`sierpinski`
  `step` voices at `amp: 1`), carve automatically sphere-traces instead of marching
  a fixed grid — `buildGlyphFieldDistanceOracle`/`marchGlyphFieldSphere` are public
  for a caller building the same check — falling back to a fixed-step scan whenever
  a ray stalls, so it never finds fewer hits than the fixed-step path, only more or
  the same, roughly 1.8-1.9× faster on deep recursive content. The SDF fields
  (`menger`/`sierpinski` at recursion depth `iterN`, 1..4) are exact signed
  distances to the depth-`iterN` box/tetra union, not a distance-estimator
  approximation; their own Nyquist floor is separate from the square-wave duty-aware
  one below. Every voice's step-count floor for `square` waves is duty-aware —
  `freq / min(duty, 1 − duty)` — so a narrow-duty recipe (a Menger-sponge-style
  membership rule with `duty: 1/3` axis voices, for example) resolves correctly
  without an inflated manual step estimate. `buildGlyphFieldProgram({ domain,
  layers: [...] })` builds a field program from a pleasant `voices: [...]`
  authoring surface with no 9-voice cap, and `validateGlyphFieldProgram(program)`
  shape-checks one; passing a built (or hand-built) program to a mounted layer via
  `program` instead of `params` — glyphcss plumbs this opaque payload through
  unchanged — is field-synth's unbounded "program-as-data" tier, immutable after
  mount. `program`'s colour-stack sibling, `colorProgram`, is the same opaque,
  mount-immutable, once-validated (via `validateGlyphFieldProgram`) payload for
  field-synth's independent colour voice stack — passed alongside (not instead
  of) `program`, since geometry and colour are two separate programs. Ships
  with a curated set of presets (Cube tiles, Ink cells, Sunburst,
  Ring pulse, Plaid weave, Sonar ping, Lattice, Vortex, Lava, Static rain, Moiré
  rings, Checkerboard, Warp core, Bubbles, Aurora, Zebra, Kaleidoscope, Halftone,
  Weave, Pulse grid, Nebula, Sierpinski pyramid, Breathing gyroid, and Menger
  (cssGraphics)) — the last two are volumetric, and Breathing gyroid animates
  with `speedN` turned on, showing the same `time` axis every 2D preset's own
  animation already uses.

`GlyphRamps` exports named glyph-ramp strings for the `glyphs` parameter — `Fade`,
`Blocks`, `Shades`, `Dots`, `Binary`, `ASCII`, `Hatch`, `Stars`, `Digital`. These are
authored guesses, eyeballed against one font — change family or weight and the
gradient bands unevenly. `calibrateGlyphRamp({ font, steps })` measures real
per-glyph ink coverage in a live font (a candidate glyph rasterized onto a 2D
canvas, alpha-summed, sorted, and deduped so no two ramp steps are visually
identical) and returns a ramp string that's perceptually linear for **that**
font. `measureGlyphInkCoverage(glyph, { font })` exposes the underlying
per-glyph measurement. Both are browser-only by default (need a Canvas 2D
context); pass `canvasFactory` to measure off the DOM — e.g. with
[`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas)'s `createCanvas`. The
result is a plain string, the same shape as `GlyphRamps` — it drops into any
ramp slot unchanged (including a `glyphcss` `WIREFRAME_PALETTES` entry consumed
by `compileScene`), since this module never imports `glyphcss`.

Other exports: `GlyphEffectCatalog` (array of every stock definition),
`getGlyphEffect(id)` (look one up by id), `defaultGlyphEffectParams(definition)`
(build a params object from a definition's schema defaults),
`glyphEffectHasColor(definition)` (whether a definition exposes a color parameter),
and `GlyphEffectNoColor` (the packed-color sentinel meaning a cell writes no color).

The `space` parameter has four values. `auto` (flow text and scan's default)
prefers authored UVs, then generated surface coordinates, then projected scene
coordinates. `surface` forces the generated geometry mapping even when UVs
exist; `scene` forces projected coordinates. `object` treats the pattern as a
volumetric field in the mesh's own local space — matrix rain's default, since
falling strands have a natural 3D form that continues across face seams.
Generated `down` projects world `-Z` into each face's tangent plane, so slopes
flow downhill and horizontal planes get a stable pseudo-random direction.
When matrix rain runs on generated surface coordinates instead, it fits each
coplanar surface basis to projected glyph-cell space so the word and trail
share one direction and velocity even on sheared or foreshortened faces.

Also exported: `calibrateWeightedGlyphRamp` (measures a glyph × font-weight
ramp for glyphcss's `solidWeightRamp` scene option) and
`buildGlyphFieldSynthStaticExport` (bakes an effect-only, static-camera
field-synth scene into a self-contained snippet with zero runtime imports;
`isGlyphFieldSynthStaticExportSupported(params)` checks first — the volumetric
branch and `render: "carve"`/`"xray"` reject explicitly, since a per-cell-per-
frame march needs a different export design; the SDF fields and the `step`
wave export normally in the 2D branch).
The field-program IR itself is also public — `evaluateGlyphFieldProgram`,
`marchGlyphField`, its integral sibling `integrateGlyphField` (used by xray),
the shared step-count floor `glyphFieldStepCount`, and the `GlyphFieldProgram`/
`GlyphFieldLayer`/`GlyphFieldVoice` types — the seam a future field-authoritative
primitive plugs into without touching field-synth's flat param schema.

Full documentation: **https://glyphcss.com/guides/effects/**
