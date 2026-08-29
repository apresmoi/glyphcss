/**
 * GlyphMesh — Vue 3 component to register a polygon list with the parent
 * GlyphScene. Mirrors PolyMesh's prop surface (including castShadow /
 * receiveShadow) for the ASCII backend.
 */
import { defineComponent, h, inject, onBeforeUnmount, watch, shallowRef, computed, watchEffect } from "vue";
import type { PropType } from "vue";
import { resolveGeometry, recenterPolygons, loadMesh } from "@glyphcss/core";
import type { Vec3, Polygon, GlyphGeometryName } from "@glyphcss/core";
import type { GlyphMeshHandle, GlyphMeshTransform, GlyphPointerEvent, GlyphMouseEvent, GlyphWheelEvent } from "glyphcss";
import { GlyphSceneContextKey } from "./context";

export interface GlyphMeshProps {
  id?: string;
  polygons?: Polygon[];
  /** URL of an OBJ / GLB / glTF / VOX / STL mesh, fetched + parsed via `loadMesh`. */
  src?: string;
  /**
   * Built-in geometry name. Resolved via `resolveGeometry` when neither
   * `polygons` nor `src` is provided.
   *
   * Precedence: explicit `polygons` > `geometry`.
   */
  geometry?: GlyphGeometryName;
  /** Uniform size passed to `resolveGeometry` when `geometry` is set. Defaults to 1. */
  size?: number;
  /** Fill color passed to `resolveGeometry` when `geometry` is set. */
  color?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  /**
   * Recenter the mesh's bounding-box center to the origin so it pivots around
   * its own center (center only, no scaling — matches voxcss). Default false.
   */
  autoCenter?: boolean;
  /**
   * This mesh casts shadows onto `receiveShadow` surfaces.
   * Default false — opt-in, matching PolyMesh behaviour.
   */
  castShadow?: boolean;
  /**
   * This mesh receives (displays) shadows from `castShadow` meshes.
   * A mesh that is both `castShadow` and `receiveShadow` will self-shadow.
   * Default false — opt-in, matching PolyMesh behaviour.
   */
  receiveShadow?: boolean;
  /** Per-mesh detail multiplier — own finer `<pre>` at `density`× resolution. `fontSize`/`lineHeight` override it. */
  density?: number;
  /** Low-level per-mesh cell size (px or CSS length); overrides `density`. */
  fontSize?: string | number;
  /** Low-level per-mesh line-height; overrides `density`. */
  lineHeight?: number;
  /** See-through (doesn't occlude / isn't occluded). Default false. Pops the mesh into its own `<pre>`. */
  transparent?: boolean;
  /** Per-mesh solid-mode glyph ramp. Pops the mesh into its own `<pre>` (the shared grid shades against one ramp). */
  glyphPalette?: string;
  /** Per-mesh ambient intensity (solid mode). Pops the mesh into its own `<pre>` (the shared grid is lit under one ambient). */
  ambientIntensity?: number;
  /** Cross-layer occlusion class for an opaque detail mesh — a higher class claims id-map cells regardless of depth. Default 0. */
  occlusionPriority?: number;
  /** Claim shape: `"alpha"` (default, texel-opaque cells only) or `"geometry"` (full triangle footprint). */
  occlusionClaim?: "alpha" | "geometry";
  /** Coverage-aware contour claim with a screen-px margin of clean ground around this mesh's ink. Never steals from another detail mesh. Omitted = point-sampled claims. */
  occlusionContourPx?: number;
  class?: string;
  // Pointer/mouse interaction — type surface matches voxcss PolyMesh.
  // TODO(hit-layer): wire these to the hit layer raycasting once the
  // rasterizer hit-map is wired to the hit-layer dispatch.
  onPointerDown?: (event: GlyphPointerEvent) => void;
  onPointerUp?: (event: GlyphPointerEvent) => void;
  onPointerMove?: (event: GlyphPointerEvent) => void;
  onPointerEnter?: (event: GlyphPointerEvent) => void;
  onPointerLeave?: (event: GlyphPointerEvent) => void;
  onClick?: (event: GlyphMouseEvent) => void;
  onWheel?: (event: GlyphWheelEvent) => void;
}

export const GlyphMesh = defineComponent({
  name: "GlyphMesh",
  props: {
    id: { type: String, default: undefined },
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    src: { type: String, default: undefined },
    geometry: { type: String as PropType<GlyphGeometryName>, default: undefined },
    size: { type: Number, default: 1 },
    color: { type: String, default: undefined },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    castShadow: { type: Boolean, default: false },
    receiveShadow: { type: Boolean, default: false },
    density: { type: Number, default: undefined },
    fontSize: { type: [String, Number] as unknown as PropType<string | number>, default: undefined },
    lineHeight: { type: Number, default: undefined },
    transparent: { type: Boolean, default: undefined },
    glyphPalette: { type: String, default: undefined },
    ambientIntensity: { type: Number, default: undefined },
    occlusionPriority: { type: Number, default: undefined },
    occlusionClaim: { type: String as PropType<"alpha" | "geometry">, default: undefined },
    occlusionContourPx: { type: Number, default: undefined },
    class: { type: String, default: undefined },
    // TODO(hit-layer): wire these to the hit layer raycasting once the
    // rasterizer hit-map is wired to the hit-layer dispatch.
    onPointerDown: { type: Function as PropType<(e: GlyphPointerEvent) => void>, default: undefined },
    onPointerUp: { type: Function as PropType<(e: GlyphPointerEvent) => void>, default: undefined },
    onPointerMove: { type: Function as PropType<(e: GlyphPointerEvent) => void>, default: undefined },
    onPointerEnter: { type: Function as PropType<(e: GlyphPointerEvent) => void>, default: undefined },
    onPointerLeave: { type: Function as PropType<(e: GlyphPointerEvent) => void>, default: undefined },
    onClick: { type: Function as PropType<(e: GlyphMouseEvent) => void>, default: undefined },
    onWheel: { type: Function as PropType<(e: GlyphWheelEvent) => void>, default: undefined },
  },
  setup(props, { slots }) {
    const ctx = inject(GlyphSceneContextKey);
    if (!ctx) {
      throw new Error("glyphcss: GlyphMesh must be used inside a GlyphScene.");
    }
    const { sceneRef } = ctx;
    const meshRef = shallowRef<GlyphMeshHandle | null>(null);

    // Fetch + parse `src` (race-safe: late responses for a stale src are dropped).
    const loadedPolygons = shallowRef<Polygon[] | null>(null);
    watch(
      () => props.src,
      (src, _prev, onCleanup) => {
        if (!src) { loadedPolygons.value = null; return; }
        let cancelled = false;
        onCleanup(() => { cancelled = true; });
        loadMesh(src)
          .then((result) => { if (!cancelled) loadedPolygons.value = result.polygons; })
          .catch(() => { if (!cancelled) loadedPolygons.value = []; });
      },
      { immediate: true },
    );

    // Precedence: explicit polygons > src > geometry shortcut
    const resolvedPolygons = computed<Polygon[]>(() => {
      const base =
        props.polygons !== undefined
          ? props.polygons
          : props.src !== undefined
            ? (loadedPolygons.value ?? [])
            : props.geometry !== undefined
              ? resolveGeometry(props.geometry, { size: props.size, color: props.color })
              : [];
      return props.autoCenter ? recenterPolygons(base) : base;
    });

    function buildTransform(): GlyphMeshTransform {
      const t: GlyphMeshTransform = {};
      if (props.id) t.id = props.id;
      if (props.position) t.position = props.position;
      if (props.scale !== undefined) t.scale = props.scale;
      if (props.rotation) t.rotation = props.rotation;
      t.castShadow = props.castShadow;
      t.receiveShadow = props.receiveShadow;
      if (props.density !== undefined) t.density = props.density;
      if (props.fontSize !== undefined) t.fontSize = props.fontSize;
      if (props.lineHeight !== undefined) t.lineHeight = props.lineHeight;
      if (props.transparent !== undefined) t.transparent = props.transparent;
      if (props.glyphPalette !== undefined) t.glyphPalette = props.glyphPalette;
      if (props.ambientIntensity !== undefined) t.ambientIntensity = props.ambientIntensity;
      if (props.occlusionPriority !== undefined) t.occlusionPriority = props.occlusionPriority;
      if (props.occlusionClaim !== undefined) t.occlusionClaim = props.occlusionClaim;
      if (props.occlusionContourPx !== undefined) t.occlusionContourPx = props.occlusionContourPx;
      return t;
    }

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      const handle = scene.add(resolvedPolygons.value, buildTransform());
      meshRef.value = handle;
    }

    function unregister(): void {
      meshRef.value?.dispose();
      meshRef.value = null;
    }

    // In Vue 3, child onMounted fires before parent onMounted, so sceneRef.value
    // is null at mount time. Watch for the scene to become available, then register.
    const stopWatch = watchEffect(() => {
      if (!sceneRef.value || meshRef.value) return;
      register();
    });

    onBeforeUnmount(() => {
      stopWatch();
      unregister();
    });

    // Update polygons in place when resolved polygons change (covers polygons, geometry, size, color)
    watch(resolvedPolygons, () => {
      if (meshRef.value) meshRef.value.setPolygons(resolvedPolygons.value);
      else register();
    });

    // Update transform on id/position/scale/rotation/castShadow/receiveShadow changes
    watch(
      () => ({ id: props.id, position: props.position, scale: props.scale, rotation: props.rotation, castShadow: props.castShadow, receiveShadow: props.receiveShadow, density: props.density, fontSize: props.fontSize, lineHeight: props.lineHeight, transparent: props.transparent, glyphPalette: props.glyphPalette, ambientIntensity: props.ambientIntensity, occlusionPriority: props.occlusionPriority, occlusionClaim: props.occlusionClaim, occlusionContourPx: props.occlusionContourPx }),
      () => {
        const mesh = meshRef.value;
        if (!mesh) return;
        mesh.setTransform(buildTransform());
        sceneRef.value?.rerender();
      },
      { deep: false },
    );

    return () => {
      const computedClass = `glyph-mesh${props.class ? ` ${props.class}` : ""}`;
      return h(
        "div",
        {
          "data-glyph-mesh-id": props.id,
          class: computedClass,
        },
        slots.default?.(),
      );
    };
  },
});
