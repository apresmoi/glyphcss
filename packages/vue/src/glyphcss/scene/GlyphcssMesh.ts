/**
 * GlyphcssMesh — Vue 3 component to register a polygon list with the parent
 * GlyphcssScene. Mirrors PolyMesh's prop surface for the ASCII backend.
 */
import { defineComponent, h, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { PropType } from "vue";
import type { Vec3, Polygon } from "@glyphcss/core";
import type { GlyphcssMeshHandle, GlyphcssMeshTransform, GlyphcssPointerEvent, GlyphcssMouseEvent, GlyphcssWheelEvent } from "glyphcss";
import { GlyphcssSceneContextKey } from "./context";

export interface GlyphcssMeshProps {
  id?: string;
  polygons?: Polygon[];
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  class?: string;
  // Pointer/mouse interaction — type surface matches voxcss PolyMesh.
  // TODO(hit-layer): wire these to the hit layer raycasting once the
  // rasterizer hit-map is wired to the hit-layer dispatch.
  onPointerDown?: (event: GlyphcssPointerEvent) => void;
  onPointerUp?: (event: GlyphcssPointerEvent) => void;
  onPointerMove?: (event: GlyphcssPointerEvent) => void;
  onPointerEnter?: (event: GlyphcssPointerEvent) => void;
  onPointerLeave?: (event: GlyphcssPointerEvent) => void;
  onClick?: (event: GlyphcssMouseEvent) => void;
  onWheel?: (event: GlyphcssWheelEvent) => void;
}

export const GlyphcssMesh = defineComponent({
  name: "GlyphcssMesh",
  props: {
    id: { type: String, default: undefined },
    polygons: { type: Array as PropType<Polygon[]>, default: () => [] },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    class: { type: String, default: undefined },
    // TODO(hit-layer): wire these to the hit layer raycasting once the
    // rasterizer hit-map is wired to the hit-layer dispatch.
    onPointerDown: { type: Function as PropType<(e: GlyphcssPointerEvent) => void>, default: undefined },
    onPointerUp: { type: Function as PropType<(e: GlyphcssPointerEvent) => void>, default: undefined },
    onPointerMove: { type: Function as PropType<(e: GlyphcssPointerEvent) => void>, default: undefined },
    onPointerEnter: { type: Function as PropType<(e: GlyphcssPointerEvent) => void>, default: undefined },
    onPointerLeave: { type: Function as PropType<(e: GlyphcssPointerEvent) => void>, default: undefined },
    onClick: { type: Function as PropType<(e: GlyphcssMouseEvent) => void>, default: undefined },
    onWheel: { type: Function as PropType<(e: GlyphcssWheelEvent) => void>, default: undefined },
  },
  setup(props, { slots }) {
    const ctx = inject(GlyphcssSceneContextKey);
    if (!ctx) {
      throw new Error("glyphcss: GlyphcssMesh must be used inside a GlyphcssScene.");
    }
    const { sceneRef } = ctx;
    const meshRef = shallowRef<GlyphcssMeshHandle | null>(null);

    function buildTransform(): GlyphcssMeshTransform {
      const t: GlyphcssMeshTransform = {};
      if (props.id) t.id = props.id;
      if (props.position) t.position = props.position;
      if (props.scale !== undefined) t.scale = props.scale;
      if (props.rotation) t.rotation = props.rotation;
      return t;
    }

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      const handle = scene.add(props.polygons ?? [], buildTransform());
      meshRef.value = handle;
    }

    function unregister(): void {
      meshRef.value?.dispose();
      meshRef.value = null;
    }

    onMounted(register);
    onBeforeUnmount(unregister);

    // Re-register when polygons array identity changes
    watch(() => props.polygons, () => {
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
      const computedClass = `glyphcss-mesh${props.class ? ` ${props.class}` : ""}`;
      return h(
        "div",
        {
          "data-glyphcss-mesh-id": props.id,
          class: computedClass,
        },
        slots.default?.(),
      );
    };
  },
});
