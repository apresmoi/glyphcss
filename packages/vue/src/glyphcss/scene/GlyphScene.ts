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
import type { GlyphSceneOptions, GlyphDirectionalLight, GlyphAmbientLight } from "glyphcss";
import { createGlyphScene, injectGlyphBaseStyles } from "glyphcss";
import { useGlyphCameraContext } from "../camera/context";
import { GlyphSceneContextKey } from "./context";

export interface GlyphSceneProps {
  mode?: RenderMode;
  glyphPalette?: string;
  useColors?: boolean;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  autoSize?: boolean;
  class?: string;
}

export const GlyphScene = defineComponent({
  name: "GlyphScene",
  inheritAttrs: false,
  props: {
    mode: { type: String as PropType<RenderMode>, default: undefined },
    glyphPalette: { type: String, default: undefined },
    useColors: { type: Boolean, default: undefined },
    cols: { type: Number, default: undefined },
    rows: { type: Number, default: undefined },
    cellAspect: { type: Number, default: undefined },
    directionalLight: { type: Object as PropType<GlyphDirectionalLight>, default: undefined },
    ambientLight: { type: Object as PropType<GlyphAmbientLight>, default: undefined },
    autoSize: { type: Boolean, default: undefined },
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
      if (props.useColors !== undefined) opts.useColors = props.useColors;
      if (props.cols !== undefined) opts.cols = props.cols;
      if (props.rows !== undefined) opts.rows = props.rows;
      if (props.cellAspect !== undefined) opts.cellAspect = props.cellAspect;
      if (props.directionalLight !== undefined) opts.directionalLight = props.directionalLight;
      if (props.ambientLight !== undefined) opts.ambientLight = props.ambientLight;
      if (props.autoSize !== undefined) opts.autoSize = props.autoSize;
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
        useColors: props.useColors,
        cols: props.cols,
        rows: props.rows,
        cellAspect: props.cellAspect,
        directionalLight: props.directionalLight,
        ambientLight: props.ambientLight,
        autoSize: props.autoSize,
      }),
      (next) => {
        const scene = sceneRef.value;
        if (!scene) return;
        const partial: Partial<GlyphSceneOptions> = {};
        if (next.mode !== undefined) partial.mode = next.mode;
        if (next.glyphPalette !== undefined) partial.glyphPalette = next.glyphPalette;
        if (next.useColors !== undefined) partial.useColors = next.useColors;
        if (next.cols !== undefined) partial.cols = next.cols;
        if (next.rows !== undefined) partial.rows = next.rows;
        if (next.cellAspect !== undefined) partial.cellAspect = next.cellAspect;
        if (next.directionalLight !== undefined) partial.directionalLight = next.directionalLight;
        if (next.ambientLight !== undefined) partial.ambientLight = next.ambientLight;
        if (next.autoSize !== undefined) partial.autoSize = next.autoSize;
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
