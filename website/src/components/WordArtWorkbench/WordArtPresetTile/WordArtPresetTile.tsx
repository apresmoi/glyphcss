import { type BackFace, composeText, type Face, type ParsedFont, type Profile, resolveFace } from "@glyphcss/fonts";
import type { Polygon, Vec3 } from "@glyphcss/react";
import { GlyphMesh, GlyphOrthographicCamera, GlyphScene } from "@glyphcss/react";
import type { CompileSceneResult } from "glyphcss";
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
import { useMemo } from "react";
import {
  createGalleryEffectState,
  galleryEffectDefinition,
  sanitizeGalleryEffectParams,
} from "../../../features/gallery/model/effects";
import {
  type Preset,
  texUrl,
  type WordArtCharMode,
  type WordArtRenderMode,
} from "../../../features/wordart/model/parameters";
import { defaultGlyphColorEncoding } from "../../../services/rendering/glyphColorEncodingDefault";
import { centerMesh, rotateMeshVerticesDeg, WordArtEffectLayer } from "../WordArtStage";

// ── Preset tile static render ──────────────────────────────────────────────
// A SMALL grid of FEW, LARGE cells rendered at a comfortably legible
// font-size (`.wa-tile__glyph` in wordart.css) — not a big grid shrunk down.
// A browser can't render monospace glyphs crisply much below ~7px, so a
// denser grid forced into a small box just reads as blurred noise even
// though the underlying character data is a perfectly clean letterform
// (verified by dumping the plain-text `compileScene` output directly).
// Lowercase needs a bit more resolution than uppercase did: the "a" glyph's
// bowl/counter is a small interior hole (vs. the big triangular gap inside
// an "A"), and at the yaw this tile now uses to show the extrusion's side
// wall, a too-small grid or too-large a yaw flattens that hole into a solid
// blob — 16×11 at the rotation below is the smallest grid that keeps the
// bowl legible while still reading as a clean, un-noisy glyph.
// `cellAspect` is picked so a roughly square glyph bbox (~cap-height square,
// see `composeText`'s size:100) fills both cols and rows at close to the
// same fraction — `createGlyphOrthographicCamera`'s col axis divides by
// `BASE_TILE/cellAspect` while the row axis divides by `BASE_TILE` (see
// `project()`), so col demand scales with `cellAspect`; the library's own
// monospace-matching default (~2) is col-constrained for a square shape and
// wastes rows as blank margin.
const TILE_COLS = 16;

const TILE_ROWS = 11;

const TILE_CELL_ASPECT = 1.45;

// A little breathing room around the letter inside the grid (vs. the
// library's own 0.95 default), so the "a" doesn't touch the tile's edges.
const TILE_FRAME_FILL = 0.92;

const TILE_TEXTURE_SIZE = 20;

// Repaint cadence cap for a live effect tile's clock (see `WordArtEffectLayer`'s
// `maxFps` doc comment for the measured cost this recovers) — plenty to read
// as "animating" at 16×11, far cheaper than the main Stage's uncapped 60fps.
const TILE_EFFECT_ZOOM = 0.21;

const TILE_EFFECT_MAX_FPS = 12;

// Stage's own default light (lightAz -25 / lightEl 45), computed the same
// way — see the `lightDir` useMemo below — so the tile preview is lit
// exactly like the live composition's resting state.
const TILE_LIGHT_DIR: Vec3 = [
  Math.max(0.25, Math.cos(45 * (Math.PI / 180))),
  -Math.sin(-25 * (Math.PI / 180)) * Math.cos(45 * (Math.PI / 180)),
  -Math.sin(45 * (Math.PI / 180)),
];

/** Fit `polygons` into an orthographic camera's cols×rows grid by scaling
 *  zoom linearly off a zoom=1 projection (exact for orthographic — no
 *  perspective divide to fight). Mirrors `/synth`'s `frameObject`, minus the
 *  live-DOM cell-metrics measurement (compileScene has no DOM, so it always
 *  projects with the same BASE_TILE fallback metrics this uses too). */
function frameZoomForGrid(
  camera: ReturnType<typeof createGlyphOrthographicCamera>,
  polygons: Polygon[],
  cols: number,
  rows: number,
  cellAspect: number,
  fill = 0.95,
): number {
  camera.zoom = 1;
  let minc = Infinity,
    maxc = -Infinity,
    minr = Infinity,
    maxr = -Infinity;
  for (const p of polygons)
    for (const v of p.vertices) {
      const pr = camera.project(v as Vec3, cols, rows, cellAspect);
      if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
      if (pr[0]! < minc) minc = pr[0]!;
      if (pr[0]! > maxc) maxc = pr[0]!;
      if (pr[1]! < minr) minr = pr[1]!;
      if (pr[1]! > maxr) maxr = pr[1]!;
    }
  const w = maxc - minc,
    h = maxr - minr;
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min((fill * cols) / w, (fill * rows) / h);
}

interface PresetTileMesh {
  /** Already tilted + centered — same polygons for the static bake and a
   *  live tile's `<GlyphMesh>` (no separate `rotation` prop needed). */
  polygons: Polygon[];
  /** Orthographic zoom that fits `polygons` into `TILE_COLS`×`TILE_ROWS` at
   *  `TILE_CELL_ASPECT` — computed once via `frameZoomForGrid` and reused
   *  verbatim as `<GlyphOrthographicCamera zoom>` by a live tile, since it's
   *  the exact same `camera.project` fit `compileScene` renders with. */
  zoom: number;
}

/** Build the single-letter preset mesh + fitted camera zoom — the geometry
 *  half of a preset tile, shared by the static `compileScene` bake
 *  (`renderPresetTile`) and a live effect tile (`LiveEffectTile`) so both
 *  paths frame the exact same "a" the exact same way. */
function buildPresetTileMesh(font: ParsedFont, preset: Preset): PresetTileMesh | null {
  const sides: Face = preset.sideTex
    ? resolveFace({ kind: "texture", color: preset.sideColor, url: texUrl(preset.sideTex), tile: TILE_TEXTURE_SIZE })
    : { color: preset.sideColor };
  let back: BackFace = preset.backTex
    ? resolveFace({
        kind: "texture",
        color: preset.backColor ?? preset.color,
        url: texUrl(preset.backTex),
        tile: TILE_TEXTURE_SIZE,
      })
    : { color: preset.backColor ?? preset.color };
  if (preset.layered) back = { ...back, offset: [preset.offset ?? 12, -(preset.offset ?? 12)] };

  const front: Face = resolveFace(
    preset.fill === "gradient"
      ? {
          kind: "gradient",
          color: preset.color,
          from: preset.gradA ?? preset.color,
          to: preset.gradB ?? preset.color,
          angle: preset.gradAngle ?? 270,
        }
      : preset.fill === "rainbow"
        ? { kind: "rainbow", color: preset.color, angle: preset.gradAngle ?? 0 }
        : preset.fill === "texture"
          ? { kind: "texture", color: preset.color, url: texUrl(preset.faceTex ?? "dirt"), tile: TILE_TEXTURE_SIZE }
          : { kind: "solid", color: preset.color },
  );

  const profileObj: Profile =
    preset.profile === "flat"
      ? "flat"
      : // No PRESETS entry uses "custom" (that needs a caller-authored bezier curve,
        // which a Preset doesn't carry) — fall back to the default easing if one ever does.
        preset.profile === "custom"
        ? { curve: [0.3, 0.9, 0.7, 0.1], segments: 3 }
        : { edge: preset.profile, raised: false, segments: 3 };

  const polygons = composeText(font, "a", {
    size: 100,
    depth: preset.layered ? 0 : preset.depth,
    profile: profileObj,
    letterSpacing: 0,
    lineHeight: 1.15,
    align: "center",
    curveSteps: 3,
    simplify: 3,
    warp: { shape: preset.warp?.shape ?? "none", amount: preset.warp?.amount ?? 0.5 },
    faces: { front, sides, back },
    outline: preset.outline ? { color: preset.outline.color, width: preset.outline.width } : undefined,
  });
  if (polygons.length === 0) return null;

  // Turn + tilt the MESH (not the camera) for a 3/4 icon angle that shows a
  // strip of the extrusion's side wall (its own `sideColor`/`sideTex`, not
  // just the front face) — same convention `createGlyphScene`'s internal
  // `applyTransform` uses for a mesh's `rotation` prop (world-frame XYZ
  // Euler, R = Rx·Ry·Rz), and the same one the live Stage's
  // `<GlyphMesh rotation={[0, tilt, turn]}>` drives. The camera's own
  // `rotX`/`rotY` is a DIFFERENT convention (orbits per voxcss's
  // `rotateVec3Voxcss`) — mixing the two produced a squashed, illegible glyph.
  // The yaw (Rz, turntable around the glyph's vertical — height moved to
  // world Z, see extrude.ts) is kept modest: past ~24° it closes up the "a"
  // bowl's small counter into a solid blob at this grid size (an "A"'s big
  // triangular gap tolerated much more yaw).
  const tilted = rotateMeshVerticesDeg(centerMesh(polygons), [0, 10, 18]);
  const centered = centerMesh(tilted);
  const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 1 });
  camera.zoom = frameZoomForGrid(camera, centered, TILE_COLS, TILE_ROWS, TILE_CELL_ASPECT, TILE_FRAME_FILL);
  return { polygons: centered, zoom: camera.zoom };
}

/**
 * Render one preset as a static single-letter `<pre>` — the same face-fill /
 * profile / warp mapping `applyPreset` drives the live composition with,
 * extruded via the pinned preview font and compiled with `compileScene`
 * (pure: geometry + camera → string, no DOM, no rAF). Gradient/rainbow/
 * texture/image fills fall back to their flat `color` here — compileScene
 * has no async image decode to sample a texture sampler from (same fallback
 * the live runtime shows for one frame before its own sampler resolves).
 */
export function renderPresetTile(
  font: ParsedFont,
  preset: Preset,
  mode: WordArtRenderMode,
  charMode: WordArtCharMode,
): CompileSceneResult | null {
  const mesh = buildPresetTileMesh(font, preset);
  if (!mesh) return null;
  const camera = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: mesh.zoom });
  return compileScene({
    polygons: mesh.polygons,
    camera,
    cols: TILE_COLS,
    rows: TILE_ROWS,
    cellAspect: TILE_CELL_ASPECT,
    mode,
    charMode,
    useColors: true,
    // Same light vector the live Stage defaults to (lightAz -25 / lightEl 45)
    // — proven to keep the front face readably lit for this exact mesh
    // convention. A guessed off-axis vector left most of the front face
    // shaded dark enough to fall to near-blank ramp glyphs, so only a thin
    // bevel highlight band was visible — illegible. Ambient is bumped a
    // little further so weakly-lit facets still render a visible glyph.
    directionalLight: { direction: TILE_LIGHT_DIR, intensity: 0.95 },
    ambientLight: { intensity: 0.7 },
  });
}

/**
 * Live counterpart to `renderPresetTile`, used ONLY for the (currently 2)
 * presets that carry an `effect` — a static `compileScene` bake can't show a
 * Glyph Effect layer (it's runtime-only, see AGENTS.md's "Compilation"
 * section: `compileScene` never evaluates a mounted effect), so those tiles
 * were silently showing just the base style with no visible rain/scan. This
 * mounts the exact same live-scene machinery the main Stage uses for its own
 * effect layer (`<GlyphScene>` + `<GlyphMesh>` + `WordArtEffectLayer`'s
 * `requestAnimationFrame` clock) at the tile's own tiny `TILE_COLS`×`TILE_ROWS`
 * grid instead of reinventing a second effect-mounting path. The other 20
 * style-only presets are untouched — still a single cheap `compileScene`
 * bake computed once in the `presetTiles` memo.
 */
export function LiveEffectTile({
  font,
  preset,
  mode,
  charMode,
}: {
  font: ParsedFont;
  preset: Preset;
  mode: WordArtRenderMode;
  charMode: WordArtCharMode;
}) {
  const mesh = useMemo(() => buildPresetTileMesh(font, preset), [font, preset]);
  const effect = preset.effect;
  const definition = effect ? galleryEffectDefinition(effect.id) : null;
  const effectParams = useMemo(() => {
    if (!definition || !effect) return null;
    const state = createGalleryEffectState(definition.id, { blend: effect.blend });
    if (!state) return null;
    return sanitizeGalleryEffectParams(definition, { ...state.params, ...effect.params });
  }, [definition, effect]);
  if (!mesh || !definition || !effectParams || !effect) return null;
  return (
    // Effect tiles pull the camera back: a full-coverage effect (matrix rain
    // at density ~1) paints every covered cell, so at the static tiles' framing
    // the slab fills the grid edge-to-edge with no margin and reads as "too
    // big" beside the letter-with-breathing-room static tiles.
    <GlyphOrthographicCamera rotX={90} rotY={0} zoom={mesh.zoom * TILE_EFFECT_ZOOM}>
      <GlyphScene
        cols={TILE_COLS}
        rows={TILE_ROWS}
        cellAspect={TILE_CELL_ASPECT}
        mode={mode}
        charMode={charMode}
        useColors
        // Same site default the stage takes. The neighbouring STATIC preset
        // tiles stay on spans: they are `compileScene` output, and the static
        // path deliberately injects no atlas CSS (AGENTS.md), so making them
        // atlas would mean hand-wiring `font-family`/`font-palette` per tile.
        colorEncoding={defaultGlyphColorEncoding()}
        className="wa-tile__glyph"
        directionalLight={{ direction: TILE_LIGHT_DIR, intensity: 0.95 }}
        ambientLight={{ intensity: 0.7 }}
      >
        <GlyphMesh polygons={mesh.polygons} />
        <WordArtEffectLayer
          key={definition.id}
          definition={definition}
          params={effectParams}
          blend={effect.blend ?? definition.defaultBlend}
          paused={false}
          timeScale={1}
          maxFps={TILE_EFFECT_MAX_FPS}
        />
      </GlyphScene>
    </GlyphOrthographicCamera>
  );
}
