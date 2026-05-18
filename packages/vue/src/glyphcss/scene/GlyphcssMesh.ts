/**
 * GlyphcssMesh — Vue 3 component to register a polygon list with the parent
 * GlyphcssScene. Mirrors PolyMesh's prop surface for the ASCII backend.
 */
import { defineComponent, h, inject, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { PropType } from "vue";
import type { Vec3, Polygon } from "@glyphcss/core";
import type { GlyphcssMeshHandle, GlyphcssMeshTransform } from "glyphcss";
import { GlyphcssSceneContextKey } from "./context";

export interface GlyphcssMeshProps {
  id?: string;
  polygons?: Polygon[];
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  class?: string;
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

    // Update transform on position/scale/rotation changes
    watch(
      () => ({ position: props.position, scale: props.scale, rotation: props.rotation }),
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
