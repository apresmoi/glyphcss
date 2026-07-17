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
