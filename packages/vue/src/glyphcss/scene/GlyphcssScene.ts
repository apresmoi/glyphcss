/**
 * GlyphcssScene — Vue 3 wrapper for the ASCII paint backend.
 *
 * Mounts a `createGlyphcssScene` handle in a host div and provides the scene
 * handle via GlyphcssSceneContextKey for child components to register with.
 */
import { defineComponent, h, provide, shallowRef, onMounted, onBeforeUnmount, watch } from "vue";
import type { PropType } from "vue";
import type { RenderMode } from "@glyphcss/core";
import type { GlyphcssSceneOptions, GlyphcssDirectionalLight, GlyphcssAmbientLight } from "glyphcss";
import { createGlyphcssScene, injectGlyphcssBaseStyles } from "glyphcss";
import { GlyphcssSceneContextKey } from "./context";

export interface GlyphcssSceneProps {
  mode?: RenderMode;
  glyphPalette?: string;
  useColors?: boolean;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  directionalLight?: GlyphcssDirectionalLight;
  ambientLight?: GlyphcssAmbientLight;
  class?: string;
}

export const GlyphcssScene = defineComponent({
  name: "GlyphcssScene",
  inheritAttrs: false,
  props: {
    mode: { type: String as PropType<RenderMode>, default: undefined },
    glyphPalette: { type: String, default: undefined },
    useColors: { type: Boolean, default: undefined },
    cols: { type: Number, default: undefined },
    rows: { type: Number, default: undefined },
    cellAspect: { type: Number, default: undefined },
    directionalLight: { type: Object as PropType<GlyphcssDirectionalLight>, default: undefined },
    ambientLight: { type: Object as PropType<GlyphcssAmbientLight>, default: undefined },
    class: { type: String, default: undefined },
  },
  setup(props, { slots, attrs }) {
    const hostRef = shallowRef<HTMLElement | null>(null);
    const sceneRef = shallowRef<ReturnType<typeof createGlyphcssScene> | null>(null);

    provide(GlyphcssSceneContextKey, { sceneRef });

    onMounted(() => {
      const el = hostRef.value;
      if (!el) return;
      injectGlyphcssBaseStyles(el.ownerDocument ?? undefined);
      const opts: GlyphcssSceneOptions = {};
      if (props.mode !== undefined) opts.mode = props.mode;
      if (props.glyphPalette !== undefined) opts.glyphPalette = props.glyphPalette;
      if (props.useColors !== undefined) opts.useColors = props.useColors;
      if (props.cols !== undefined) opts.cols = props.cols;
      if (props.rows !== undefined) opts.rows = props.rows;
      if (props.cellAspect !== undefined) opts.cellAspect = props.cellAspect;
      if (props.directionalLight !== undefined) opts.directionalLight = props.directionalLight;
      if (props.ambientLight !== undefined) opts.ambientLight = props.ambientLight;
      sceneRef.value = createGlyphcssScene(el, opts);
    });

    onBeforeUnmount(() => {
      sceneRef.value?.destroy();
      sceneRef.value = null;
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
      }),
      (next) => {
        const scene = sceneRef.value;
        if (!scene) return;
        const partial: Partial<GlyphcssSceneOptions> = {};
        if (next.mode !== undefined) partial.mode = next.mode;
        if (next.glyphPalette !== undefined) partial.glyphPalette = next.glyphPalette;
        if (next.useColors !== undefined) partial.useColors = next.useColors;
        if (next.cols !== undefined) partial.cols = next.cols;
        if (next.rows !== undefined) partial.rows = next.rows;
        if (next.cellAspect !== undefined) partial.cellAspect = next.cellAspect;
        if (next.directionalLight !== undefined) partial.directionalLight = next.directionalLight;
        if (next.ambientLight !== undefined) partial.ambientLight = next.ambientLight;
        if (Object.keys(partial).length > 0) scene.setOptions(partial);
      },
      { deep: false },
    );

    return () => {
      const computedClass = `glyphcss-host${props.class ? ` ${props.class}` : ""}`;
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
