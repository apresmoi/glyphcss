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
- **fieldSynth** — a composable oscillator synth: up to six voices, each pairing a
  field (`radial`/`linearX`/`linearY`/`diagonal`/`angular`/`spiral`/`noise`) with a
  waveform (`sin`/`triangle`/`saw`/`square`), combined (`add`/`multiply`/`max`/`min`/
  `difference`) into one scalar mapped to a glyph ramp and color over a `space`. `amp`
  is a per-voice mix weight rather than a gain, `lit` modulates the output color by
  surface shading, and `voiceColors` blends each active voice's own color instead of a
  single value gradient. Ships with a curated set of presets (Sunburst, Interference,
  Plaid weave, and more).

`GlyphRamps` exports named glyph-ramp strings for the `glyphs` parameter — `Fade`,
`Blocks`, `Shades`, `Dots`, `Binary`, `ASCII`, `Hatch`, `Stars`, `Digital`.

Other exports: `GlyphEffectCatalog` (array of every stock definition),
`getGlyphEffect(id)` (look one up by id), `defaultGlyphEffectParams(definition)`
(build a params object from a definition's schema defaults),
`glyphEffectHasColor(definition)` (whether a definition exposes a color parameter),
and `GlyphEffectNoColor` (the packed-color sentinel meaning a cell writes no color).

Matrix rain, flow text, and scan prefer authored UVs in `auto` mapping, generate
orientation-aware coordinates from world position and face normal when UVs are
absent, and fall back to projected coordinates when those fields are absent.
`surface` forces the generated geometry mapping even when UVs exist; `scene`
forces projected coordinates.
Generated `down` projects world `-Z` into each face's tangent plane. Slopes
therefore flow downhill, coplanar triangles agree, differently oriented faces
diverge, and horizontal planes use a stable pseudo-random tangent direction.
Matrix rain fits each quantized coplanar surface basis to projected glyph-cell
space and uses the resulting orthogonal face-local field for both its sparse mask
and its glyph lookup. Letters are indexed by periodic distance behind the head,
which makes the word and trail share one direction and velocity even on a sheared
or foreshortened roof. Active trail cells emit full coverage; density and trail
extent provide sparsity without dithered gaps.
