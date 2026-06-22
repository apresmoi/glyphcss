/**
 * GlyphSceneStatic — render a scene to its `<pre>` ASCII with **no runtime**.
 *
 * `compileScene` is pure, so this renders the same string on the server (SSR /
 * SSG) and on the client with no hydration mismatch and no WebGL. Use it for
 * static 3D-as-text: a hero, a thumbnail, an OG image source — anything that
 * doesn't need interaction. For an orbit/zoom/FPV scene, use `GlyphScene`.
 */
import { defineComponent, h, computed } from "vue";
import type { PropType } from "vue";
import type { Polygon, RenderMode } from "@glyphcss/core";
import { compileScene } from "glyphcss";
import type { GlyphCamera } from "glyphcss";

export interface GlyphSceneStaticProps {
  polygons: Polygon[];
  camera?: GlyphCamera;
  autoCenter?: boolean;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  mode?: RenderMode;
  glyphPalette?: string;
  useColors?: boolean;
  smoothShading?: boolean;
  creaseAngle?: number;
  doubleSided?: boolean;
  supersample?: number;
}

export const GlyphSceneStatic = defineComponent({
  name: "GlyphSceneStatic",
  props: {
    polygons: { type: Array as PropType<Polygon[]>, required: true },
    camera: { type: Object as PropType<GlyphCamera>, default: undefined },
    autoCenter: { type: Boolean, default: undefined },
    cols: { type: Number, default: undefined },
    rows: { type: Number, default: undefined },
    cellAspect: { type: Number, default: undefined },
    mode: { type: String as PropType<RenderMode>, default: undefined },
    glyphPalette: { type: String, default: undefined },
    useColors: { type: Boolean, default: undefined },
    smoothShading: { type: Boolean, default: undefined },
    creaseAngle: { type: Number, default: undefined },
    doubleSided: { type: Boolean, default: undefined },
    supersample: { type: Number, default: undefined },
  },
  setup(props) {
    const inner = computed(() => compileScene({
      polygons: props.polygons,
      camera: props.camera,
      autoCenter: props.autoCenter,
      cols: props.cols,
      rows: props.rows,
      cellAspect: props.cellAspect,
      mode: props.mode,
      glyphPalette: props.glyphPalette,
      useColors: props.useColors,
      smoothShading: props.smoothShading,
      creaseAngle: props.creaseAngle,
      doubleSided: props.doubleSided,
      supersample: props.supersample,
    }).inner);
    return () => h("pre", { class: "glyph-output", innerHTML: inner.value });
  },
});
