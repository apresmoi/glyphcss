/**
 * GlyphObject — Vue 3 mirror of the React `<GlyphObject>` component. Mounts
 * a `GlyphSceneObject` (PLAN-3d.md §3.1) into the parent GlyphScene via
 * `scene.addObject()`.
 */
import { defineComponent, inject, onBeforeUnmount, shallowRef, watch, watchEffect } from "vue";
import type { PropType } from "vue";
import type { Vec3 } from "@glyphcss/core";
import type { GlyphSceneObject, GlyphSceneObjectHandle, GlyphSceneObjectTransform } from "glyphcss";
import { GlyphSceneContextKey } from "./context";

export interface GlyphObjectProps {
  object: GlyphSceneObject;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

export const GlyphObject = defineComponent({
  name: "GlyphObject",
  props: {
    object: { type: Object as PropType<GlyphSceneObject>, required: true },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
  },
  setup(props) {
    const ctx = inject(GlyphSceneContextKey);
    if (!ctx) {
      throw new Error("glyphcss: GlyphObject must be used inside a GlyphScene.");
    }
    const { sceneRef } = ctx;
    const handleRef = shallowRef<GlyphSceneObjectHandle | null>(null);

    function buildTransform(): GlyphSceneObjectTransform {
      return { position: props.position, scale: props.scale, rotation: props.rotation };
    }

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      handleRef.value = scene.addObject(props.object, buildTransform());
    }

    function unregister(): void {
      handleRef.value?.remove();
      handleRef.value = null;
    }

    // Mirrors GlyphMesh.ts: in Vue 3 a child's onMounted fires before its
    // parent's, so sceneRef.value is still null at this component's own
    // mount — wait for it, then register once.
    const stopWatch = watchEffect(() => {
      if (!sceneRef.value || handleRef.value) return;
      register();
    });

    onBeforeUnmount(() => {
      stopWatch();
      unregister();
    });

    watch(() => props.object, (nextObject) => {
      if (handleRef.value) handleRef.value.update(nextObject);
      else register();
    });

    watch(
      () => ({ position: props.position, scale: props.scale, rotation: props.rotation }),
      () => {
        const handle = handleRef.value;
        if (!handle) return;
        handle.setTransform(buildTransform());
        sceneRef.value?.rerender();
      },
      { deep: false },
    );

    return () => null;
  },
});
