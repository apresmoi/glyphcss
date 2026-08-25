/**
 * GlyphScene — React wrapper for the ASCII paint backend.
 *
 * Must be placed inside a <GlyphPerspectiveCamera> or <GlyphOrthographicCamera>.
 * Reads the camera handle from GlyphCameraContext, mounts a `createGlyphScene`
 * handle in a host div, and provides the scene handle via GlyphSceneContext so
 * child components (GlyphMesh, GlyphHotspot, controls) can register with it.
 *
 * No atlas, no matrix3d, no CSS polygon leaves — the ASCII rasterizer
 * writes into a single <pre> element per render.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { RenderMode } from "@glyphcss/core";
import type {
  GlyphSceneOptions,
  GlyphDirectionalLight,
  GlyphAmbientLight,
  GlyphShadowOptions,
  GlyphControlSceneManifest,
  GlyphObjectDictionary,
  GlyphSolidWeightRampStep,
  TransformCells,
} from "glyphcss";
import { createGlyphScene, injectGlyphBaseStyles } from "glyphcss";
import { useGlyphCameraContext } from "../camera/context";
import { GlyphSceneContext } from "./context";

export interface GlyphSceneProps {
  /** Render mode: "wireframe" | "solid". Default "solid". */
  mode?: RenderMode;
  /** Named glyph palette. Defaults to "default". */
  glyphPalette?: string;
  /**
   * Character encoding for rasterized output. `"ascii"` (default) is the
   * original ramp/rule-glyph encoding. `"braille"` renders wireframe mode
   * using Unicode Braille Patterns (U+2800..U+28FF) for smoother diagonal
   * and curved edges. Documented no-op in `solid`/`voxel`/`ink` modes.
   * `"halfblock"` is the solid-mode mirror: two independently colored
   * subcells (top/bottom) packed into one `▀`/`▄`/`█` cell for 2× vertical
   * color resolution. Documented no-op outside `solid` mode.
   */
  charMode?: "ascii" | "braille" | "halfblock" | "quadrant";
  /**
   * Box-drawing junction resolve pass (wireframe + `charMode: "ascii"` only).
   * When `true`, near-axis-aligned wireframe edges meeting in the same cell
   * resolve to a single `┌┐└┘├┤┬┴┼─│` glyph consistent with every edge that
   * touches it (corners, T-junctions, crossings) instead of a random per-tier
   * glyph. Default `false`.
   */
  wireframeJunctions?: boolean;
  /**
   * Hidden-line removal for the wireframe path (wireframe + `charMode:
   * "braille"`). `"show"` (default) is today's behavior. `"hide"`
   * depth-tests every stroke against a solid surface prepass so a back edge
   * doesn't paint through a nearer one. Documented no-op in `solid` and `ink`.
   */
  hiddenLines?: "show" | "hide";
  /**
   * Solid-mode-only second density axis: a font-weight-calibrated ramp of
   * (glyph, `font-weight`) steps ordered darkest → densest by measured ink
   * coverage (see `@glyphcss/effects`'s `calibrateWeightedGlyphRamp`). When
   * set, replaces `glyphPalette`'s solid ramp so shading picks both a glyph
   * and a weight, buying more perceptual shading steps than glyph shape
   * alone. `undefined` (default) is off and byte-identical. Documented no-op
   * during active temporal-blend reprojection.
   */
  solidWeightRamp?: GlyphSolidWeightRampStep[];
  /**
   * Row-wise greedy run-extension color merge tolerance (COLOR-TOLERANCE.md):
   * a run keeps extending while the next cell's true color is within
   * `colorTolerance` of the run's anchor color (redmean distance), trading
   * color fidelity for fewer `<span>`s. Default `0` = off, byte-identical.
   * **Range is 0..765, not 0..255.** `NaN`/negative values degrade to `0`;
   * `+Infinity` is honored as-is (merges every same-glyph run in a row). NOT
   * gated behind `temporalBlend` — tolerance pays off most under active TAA.
   */
  colorTolerance?: number;
  /**
   * Encode strategy for the rendered `<pre>` text. `"spans"` (default) is
   * today's HTML-span run-coalescing path — unset is byte-identical.
   * `"atlas"` encodes `(glyph, colour)` as Private Use Area code points
   * against a checked-in COLR/CPAL colour font (`glyphcss`'s
   * `render/fontAtlas.ts`), producing ONE text node with zero `<span>`s.
   * Requires {@link atlasPalette}; falls back to `"spans"` for a render with
   * no palette or whose glyphs/colors aren't fully covered by the atlas +
   * palette. `GlyphScene` does NOT auto-inject the atlas's `@font-face`/
   * `@font-palette-values` CSS — inject `buildGlyphAtlasFontFaceCss()`/
   * `buildGlyphAtlasFontPaletteValuesCss()` (exported from `glyphcss`)
   * yourself and set the rendered `<pre>`'s `font-family`/`font-palette` to
   * match.
   */
  colorEncoding?: "spans" | "atlas";
  /**
   * Palette `colorEncoding: "atlas"` cells encode against — an ordered
   * `#rrggbb` array whose entries' POSITIONS (never their values) become the
   * PUA mapping's palette-slot axis. Deriving this palette is out of scope
   * for this prop — it is an injected input.
   */
  atlasPalette?: readonly string[];
  /** Whether to emit color spans. Default true. */
  useColors?: boolean;
  /** Grid columns. Default 80. */
  cols?: number;
  /** Grid rows. Default 24. */
  rows?: number;
  /** Character cell aspect ratio (height/width). Default 2.0. */
  cellAspect?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  /** Smooth (Gouraud) shading. Default false. */
  smoothShading?: boolean;
  /** Crease angle in degrees. Edges sharper than this stay flat-shaded. Default 60. */
  creaseAngle?: number;
  /** Observe host element and adapt cols/rows to fill it. Default false. */
  autoSize?: boolean;
  /**
   * Interactive level-of-detail: while a control is dragging, render at
   * `1/interactiveDownscale` resolution (coarser, same on-screen size) and
   * restore full detail on release. `2` → ¼ cells while dragging. Default `1` (off).
   */
  interactiveDownscale?: number;
  /**
   * Shadow-map configuration. `undefined` (default) means no shadows.
   * Set this together with `castShadow`/`receiveShadow` on child `GlyphMesh`
   * components to enable shadow casting.
   */
  shadow?: GlyphShadowOptions;
  /**
   * Optional post-rasterize cell hook (M4 composition effects). Runs on the
   * final glyph grid before the single `<pre>` write. `undefined` (default) →
   * byte-identical render. Consumers (e.g. Molty's DancePreview) derive it from
   * the active cell effect + progress each frame.
   */
  transformCells?: TransformCells;
  glyphOutput?: "visible" | "semantic";
  sceneManifest?: GlyphControlSceneManifest;
  dictionary?: GlyphObjectDictionary;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphSceneInner({
  mode,
  glyphPalette,
  charMode,
  wireframeJunctions,
  hiddenLines,
  solidWeightRamp,
  colorTolerance,
  colorEncoding,
  atlasPalette,
  useColors,
  cols,
  rows,
  cellAspect,
  directionalLight,
  ambientLight,
  smoothShading,
  creaseAngle,
  autoSize,
  interactiveDownscale,
  shadow,
  transformCells,
  glyphOutput,
  sceneManifest,
  dictionary,
  className,
  style,
  children,
}: GlyphSceneProps) {
  const { cameraRef, sceneRerenderRef } = useGlyphCameraContext();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ReturnType<typeof createGlyphScene> | null>(null);

  // Build the initial scene options once (camera must exist at this point)
  const initialOpts: GlyphSceneOptions = useMemo(() => ({
    mode,
    glyphPalette,
    charMode,
    wireframeJunctions,
    hiddenLines,
    solidWeightRamp,
    colorTolerance,
    colorEncoding,
    atlasPalette,
    useColors,
    cols,
    rows,
    cellAspect,
    directionalLight,
    ambientLight,
    smoothShading,
    creaseAngle,
    autoSize,
    interactiveDownscale,
    shadow,
    transformCells,
    glyphOutput,
    sceneManifest,
    dictionary,
    camera: cameraRef.current ?? undefined,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mount / destroy the scene when the host element mounts / unmounts
  const hostCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !sceneRef.current) {
      hostRef.current = el;
      injectGlyphBaseStyles(el.ownerDocument ?? undefined);
      const camera = cameraRef.current ?? undefined;
      sceneRef.current = createGlyphScene(el, { ...initialOpts, camera });
      // Register the scene rerender function with the camera context so
      // prop changes on the camera component trigger rerenders.
      sceneRerenderRef.current = () => sceneRef.current?.rerender();
    } else if (!el && sceneRef.current) {
      sceneRef.current.destroy();
      sceneRef.current = null;
      sceneRerenderRef.current = null;
      hostRef.current = null;
    }
  }, [initialOpts, cameraRef, sceneRerenderRef]);

  // Sync option props to the live scene handle
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const partial: Partial<GlyphSceneOptions> = {};
    if (mode !== undefined) partial.mode = mode;
    if (glyphPalette !== undefined) partial.glyphPalette = glyphPalette;
    if (charMode !== undefined) partial.charMode = charMode;
    if (wireframeJunctions !== undefined) partial.wireframeJunctions = wireframeJunctions;
    if (hiddenLines !== undefined) partial.hiddenLines = hiddenLines;
    // Unlike `charMode`/`hiddenLines` (which always have a meaningful
    // non-undefined default), `solidWeightRamp`'s "off" state IS `undefined` —
    // always forward it (like `shadow`/`sceneManifest` below) so removing the
    // prop actually clears the ramp in vanilla instead of being swallowed by
    // an `!== undefined` guard.
    partial.solidWeightRamp = solidWeightRamp;
    if (colorTolerance !== undefined) partial.colorTolerance = colorTolerance;
    if (colorEncoding !== undefined) partial.colorEncoding = colorEncoding;
    // Unlike `colorEncoding` (a meaningful default `"spans"`), `atlasPalette`'s
    // "off" state IS `undefined` — always forward it, same as `solidWeightRamp`
    // above, so removing the prop actually clears the palette in vanilla.
    partial.atlasPalette = atlasPalette;
    if (useColors !== undefined) partial.useColors = useColors;
    if (cols !== undefined) partial.cols = cols;
    if (rows !== undefined) partial.rows = rows;
    if (cellAspect !== undefined) partial.cellAspect = cellAspect;
    if (directionalLight !== undefined) partial.directionalLight = directionalLight;
    if (ambientLight !== undefined) partial.ambientLight = ambientLight;
    if (smoothShading !== undefined) partial.smoothShading = smoothShading;
    if (creaseAngle !== undefined) partial.creaseAngle = creaseAngle;
    if (autoSize !== undefined) partial.autoSize = autoSize;
    if (interactiveDownscale !== undefined) partial.interactiveDownscale = interactiveDownscale;
    // Always forward shadow (including undefined) so setOptions can clear it
    // when the prop is removed. Uses the "in" check in vanilla setOptions.
    partial.shadow = shadow;
    // Always forward the cell hook (including undefined) so removing the effect
    // restores the byte-identical no-hook path. New fn each frame is expected
    // (DancePreview rebuilds it per progress); setOptions just re-renders.
    partial.transformCells = transformCells;
    // Forward absence as an explicit reset to the visible default.
    partial.glyphOutput = glyphOutput;
    partial.sceneManifest = sceneManifest;
    partial.dictionary = dictionary;
    if (Object.keys(partial).length > 0) {
      scene.setOptions(partial);
    }
  }, [mode, glyphPalette, charMode, wireframeJunctions, hiddenLines, solidWeightRamp, colorTolerance, colorEncoding, atlasPalette, useColors, cols, rows, cellAspect, directionalLight, ambientLight, smoothShading, creaseAngle, autoSize, interactiveDownscale, shadow, transformCells, glyphOutput, sceneManifest, dictionary]);

  const ctxValue = useMemo(() => ({ sceneRef }), [sceneRef]);

  const computedClassName = `glyph-host${className ? ` ${className}` : ""}`;

  return (
    <GlyphSceneContext.Provider value={ctxValue}>
      <div ref={hostCallbackRef} className={computedClassName} style={style}>
        {children}
      </div>
    </GlyphSceneContext.Provider>
  );
}

export const GlyphScene = memo(GlyphSceneInner);
