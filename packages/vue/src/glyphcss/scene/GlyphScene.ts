/**
 * GlyphScene — Vue 3 wrapper for the ASCII paint backend.
 *
 * Must be placed inside a <GlyphPerspectiveCamera> or <GlyphOrthographicCamera>.
 * Reads the camera handle from GlyphCameraContextKey, mounts a `createGlyphScene`
 * handle in a host div, and provides the scene handle via GlyphSceneContextKey
 * for child components to register with.
 */
import { defineComponent, h, provide, shallowRef, onMounted, onBeforeUnmount, watch } from "vue";
import type { PropType } from "vue";
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
import { GlyphSceneContextKey } from "./context";

export interface GlyphSceneProps {
  mode?: RenderMode;
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
   * Smooth (Gouraud) shading: per-cell Lambert intensity interpolated from
   * per-vertex normals averaged across adjacent polygons within `creaseAngle`.
   * Default `false` — the faceted look is part of glyph's identity.
   */
  smoothShading?: boolean;
  /** Max angle (degrees) between adjacent faces still averaged into one vertex
   *  normal when `smoothShading` is on. Default `60`. */
  creaseAngle?: number;
  useColors?: boolean;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
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
   * Optional post-rasterize cell hook. Runs on the final glyph grid before the
   * single `<pre>` write. Removing the prop restores the untransformed output.
   */
  transformCells?: TransformCells;
  glyphOutput?: "visible" | "semantic";
  sceneManifest?: GlyphControlSceneManifest;
  dictionary?: GlyphObjectDictionary;
  class?: string;
}

export const GlyphScene = defineComponent({
  name: "GlyphScene",
  inheritAttrs: false,
  props: {
    mode: { type: String as PropType<RenderMode>, default: undefined },
    glyphPalette: { type: String, default: undefined },
    charMode: { type: String as PropType<"ascii" | "braille" | "halfblock" | "quadrant">, default: undefined },
    wireframeJunctions: { type: Boolean, default: undefined },
    hiddenLines: { type: String as PropType<"show" | "hide">, default: undefined },
    solidWeightRamp: { type: Array as PropType<GlyphSolidWeightRampStep[]>, default: undefined },
    colorTolerance: { type: Number, default: undefined },
    smoothShading: { type: Boolean, default: undefined },
    creaseAngle: { type: Number, default: undefined },
    useColors: { type: Boolean, default: undefined },
    cols: { type: Number, default: undefined },
    rows: { type: Number, default: undefined },
    cellAspect: { type: Number, default: undefined },
    directionalLight: { type: Object as PropType<GlyphDirectionalLight>, default: undefined },
    ambientLight: { type: Object as PropType<GlyphAmbientLight>, default: undefined },
    autoSize: { type: Boolean, default: undefined },
    interactiveDownscale: { type: Number, default: undefined },
    shadow: { type: Object as PropType<GlyphShadowOptions>, default: undefined },
    transformCells: { type: Function as PropType<TransformCells>, default: undefined },
    glyphOutput: { type: String as PropType<"visible" | "semantic">, default: undefined },
    sceneManifest: { type: Object as PropType<GlyphControlSceneManifest>, default: undefined },
    dictionary: { type: Object as PropType<GlyphObjectDictionary>, default: undefined },
    class: { type: String, default: undefined },
  },
  setup(props, { slots, attrs }) {
    const { cameraRef, sceneRerenderRef } = useGlyphCameraContext();

    const hostRef = shallowRef<HTMLElement | null>(null);
    const sceneRef = shallowRef<ReturnType<typeof createGlyphScene> | null>(null);

    provide(GlyphSceneContextKey, { sceneRef });

    onMounted(() => {
      const el = hostRef.value;
      if (!el) return;
      injectGlyphBaseStyles(el.ownerDocument ?? undefined);
      const opts: GlyphSceneOptions = {};
      if (props.mode !== undefined) opts.mode = props.mode;
      if (props.glyphPalette !== undefined) opts.glyphPalette = props.glyphPalette;
      if (props.charMode !== undefined) opts.charMode = props.charMode;
      if (props.wireframeJunctions !== undefined) opts.wireframeJunctions = props.wireframeJunctions;
      if (props.hiddenLines !== undefined) opts.hiddenLines = props.hiddenLines;
      if (props.solidWeightRamp !== undefined) opts.solidWeightRamp = props.solidWeightRamp;
      if (props.colorTolerance !== undefined) opts.colorTolerance = props.colorTolerance;
      if (props.smoothShading !== undefined) opts.smoothShading = props.smoothShading;
      if (props.creaseAngle !== undefined) opts.creaseAngle = props.creaseAngle;
      if (props.useColors !== undefined) opts.useColors = props.useColors;
      if (props.cols !== undefined) opts.cols = props.cols;
      if (props.rows !== undefined) opts.rows = props.rows;
      if (props.cellAspect !== undefined) opts.cellAspect = props.cellAspect;
      if (props.directionalLight !== undefined) opts.directionalLight = props.directionalLight;
      if (props.ambientLight !== undefined) opts.ambientLight = props.ambientLight;
      if (props.autoSize !== undefined) opts.autoSize = props.autoSize;
      if (props.interactiveDownscale !== undefined) opts.interactiveDownscale = props.interactiveDownscale;
      if (props.shadow !== undefined) opts.shadow = props.shadow;
      if (props.transformCells !== undefined) opts.transformCells = props.transformCells;
      if (props.glyphOutput !== undefined) opts.glyphOutput = props.glyphOutput;
      if (props.sceneManifest !== undefined) opts.sceneManifest = props.sceneManifest;
      if (props.dictionary !== undefined) opts.dictionary = props.dictionary;
      if (cameraRef.value !== null) opts.camera = cameraRef.value;
      sceneRef.value = createGlyphScene(el, opts);
      // Register the rerender callback with the camera context so prop changes
      // on the camera component trigger rerenders on this scene.
      sceneRerenderRef.value = () => sceneRef.value?.rerender();
    });

    onBeforeUnmount(() => {
      sceneRef.value?.destroy();
      sceneRef.value = null;
      sceneRerenderRef.value = null;
    });

    // Sync option prop changes to the live scene handle
    watch(
      () => ({
        mode: props.mode,
        glyphPalette: props.glyphPalette,
        charMode: props.charMode,
        wireframeJunctions: props.wireframeJunctions,
        hiddenLines: props.hiddenLines,
        solidWeightRamp: props.solidWeightRamp,
        colorTolerance: props.colorTolerance,
        smoothShading: props.smoothShading,
        creaseAngle: props.creaseAngle,
        useColors: props.useColors,
        cols: props.cols,
        rows: props.rows,
        cellAspect: props.cellAspect,
        directionalLight: props.directionalLight,
        ambientLight: props.ambientLight,
        autoSize: props.autoSize,
        interactiveDownscale: props.interactiveDownscale,
        shadow: props.shadow,
        transformCells: props.transformCells,
        glyphOutput: props.glyphOutput,
        sceneManifest: props.sceneManifest,
        dictionary: props.dictionary,
      }),
      (next) => {
        const scene = sceneRef.value;
        if (!scene) return;
        const partial: Partial<GlyphSceneOptions> = {};
        if (next.mode !== undefined) partial.mode = next.mode;
        if (next.glyphPalette !== undefined) partial.glyphPalette = next.glyphPalette;
        if (next.charMode !== undefined) partial.charMode = next.charMode;
        if (next.wireframeJunctions !== undefined) partial.wireframeJunctions = next.wireframeJunctions;
        if (next.hiddenLines !== undefined) partial.hiddenLines = next.hiddenLines;
        // `solidWeightRamp`'s "off" state IS `undefined` — always forward it
        // (like `shadow` below) so removing the prop actually clears the ramp.
        partial.solidWeightRamp = next.solidWeightRamp;
        if (next.colorTolerance !== undefined) partial.colorTolerance = next.colorTolerance;
        if (next.smoothShading !== undefined) partial.smoothShading = next.smoothShading;
        if (next.creaseAngle !== undefined) partial.creaseAngle = next.creaseAngle;
        if (next.useColors !== undefined) partial.useColors = next.useColors;
        if (next.cols !== undefined) partial.cols = next.cols;
        if (next.rows !== undefined) partial.rows = next.rows;
        if (next.cellAspect !== undefined) partial.cellAspect = next.cellAspect;
        if (next.directionalLight !== undefined) partial.directionalLight = next.directionalLight;
        if (next.ambientLight !== undefined) partial.ambientLight = next.ambientLight;
        if (next.autoSize !== undefined) partial.autoSize = next.autoSize;
        if (next.interactiveDownscale !== undefined) partial.interactiveDownscale = next.interactiveDownscale;
        // Always forward shadow (including undefined) so setOptions can clear it
        // when the prop is removed. Uses the "in" check in vanilla setOptions.
        partial.shadow = next.shadow;
        // Always forward the hook so removing the prop clears it in vanilla.
        partial.transformCells = next.transformCells;
        // Forward absence as an explicit reset to the visible default.
        partial.glyphOutput = next.glyphOutput;
        partial.sceneManifest = next.sceneManifest;
        partial.dictionary = next.dictionary;
        if (Object.keys(partial).length > 0) scene.setOptions(partial);
      },
      { deep: false },
    );

    return () => {
      const computedClass = `glyph-host${props.class ? ` ${props.class}` : ""}`;
      return h(
        "div",
        {
          ref: hostRef,
          class: computedClass,
          ...Object.fromEntries(
            Object.entries(attrs).filter(([k]) => k !== "class"),
          ),
        },
        slots.default?.(),
      );
    };
  },
});
