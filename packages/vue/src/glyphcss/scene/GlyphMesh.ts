/**
 * GlyphMesh — Vue 3 component to register a polygon list with the parent
 * GlyphScene. Mirrors PolyMesh's prop surface for the ASCII backend.
 */
import { defineComponent, h, inject, onMounted, onBeforeUnmount, watch, shallowRef, computed } from "vue";
import type { PropType } from "vue";
import { resolveGeometry } from "@glyphcss/core";
import type { Vec3, Polygon, GlyphGeometryName } from "@glyphcss/core";
import type { GlyphMeshHandle, GlyphMeshTransform, GlyphPointerEvent, GlyphMouseEvent, GlyphWheelEvent } from "glyphcss";
import { GlyphSceneContextKey } from "./context";

export interface GlyphMeshProps {
  id?: string;
  polygons?: Polygon[];
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
    geometry: { type: String as PropType<GlyphGeometryName>, default: undefined },
    size: { type: Number, default: 1 },
    color: { type: String, default: undefined },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
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

    // Precedence: explicit polygons > geometry shortcut
    const resolvedPolygons = computed<Polygon[]>(() => {
      if (props.polygons !== undefined) return props.polygons;
      if (props.geometry !== undefined) {
        return resolveGeometry(props.geometry, { size: props.size, color: props.color });
      }
      return [];
    });

    function buildTransform(): GlyphMeshTransform {
      const t: GlyphMeshTransform = {};
      if (props.id) t.id = props.id;
      if (props.position) t.position = props.position;
      if (props.scale !== undefined) t.scale = props.scale;
      if (props.rotation) t.rotation = props.rotation;
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

    onMounted(register);
    onBeforeUnmount(unregister);

    // Re-register when resolved polygons change (covers polygons, geometry, size, color)
    watch(resolvedPolygons, () => {
      unregister();
      register();
    });

    // Update transform on id/position/scale/rotation changes
    watch(
      () => ({ id: props.id, position: props.position, scale: props.scale, rotation: props.rotation }),
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
