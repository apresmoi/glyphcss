import { computed, defineComponent, h, inject, onBeforeUnmount, shallowRef, watch, watchEffect } from "vue";
import type { CSSProperties, PropType } from "vue";
import {
  loadMesh,
  recenterPolygons,
  resolveGeometry,
} from "@glyphcss/core";
import type {
  GlyphGeometryName,
  Polygon,
} from "@glyphcss/core";
import {
  Object3D,
  transformPolygonsToGlyph,
} from "@glyphcss/core/three";
import type { Vector3Tuple } from "@glyphcss/core/three";
import type { GlyphMeshHandle, GlyphMeshTransform } from "glyphcss";
import { GlyphSceneContextKey } from "../glyphcss/scene/context";

export interface GlyphThreeMeshProps {
  id?: string;
  object?: Object3D;
  polygons?: Polygon[];
  src?: string;
  geometry?: GlyphGeometryName;
  size?: number;
  color?: string;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: number | Vector3Tuple;
  autoCenter?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  density?: number;
  fontSize?: string | number;
  lineHeight?: number;
  transparent?: boolean;
  class?: string;
  style?: CSSProperties | string;
}

function applyObjectProps(
  object: Object3D,
  props: Pick<GlyphThreeMeshProps, "position" | "rotation" | "scale">,
): Object3D {
  if (props.position) object.position.set(props.position[0], props.position[1], props.position[2]);
  if (props.rotation) object.rotation.set(props.rotation[0], props.rotation[1], props.rotation[2]);
  if (typeof props.scale === "number") object.scale.set(props.scale, props.scale, props.scale);
  else if (props.scale) object.scale.set(props.scale[0], props.scale[1], props.scale[2]);
  return object;
}

export const GlyphThreeMesh = defineComponent({
  name: "GlyphThreeMesh",
  props: {
    id: { type: String, default: undefined },
    object: { type: Object as PropType<Object3D>, default: undefined },
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    src: { type: String, default: undefined },
    geometry: { type: String as PropType<GlyphGeometryName>, default: undefined },
    size: { type: Number, default: 1 },
    color: { type: String, default: undefined },
    position: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vector3Tuple>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vector3Tuple>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    castShadow: { type: Boolean, default: false },
    receiveShadow: { type: Boolean, default: false },
    density: { type: Number, default: undefined },
    fontSize: { type: [String, Number] as unknown as PropType<string | number>, default: undefined },
    lineHeight: { type: Number, default: undefined },
    transparent: { type: Boolean, default: undefined },
    class: { type: String, default: undefined },
    style: { type: [Object, String] as unknown as PropType<CSSProperties | string>, default: undefined },
  },
  setup(props, { slots }) {
    const ctx = inject(GlyphSceneContextKey);
    if (!ctx) {
      throw new Error("glyphcss: GlyphThreeMesh must be used inside a GlyphScene.");
    }
    const { sceneRef } = ctx;
    const meshRef = shallowRef<GlyphMeshHandle | null>(null);
    const objectRef = shallowRef<Object3D>(props.object ?? new Object3D());
    const loadedPolygons = shallowRef<Polygon[] | null>(null);

    watch(
      () => props.src,
      (src, _prev, onCleanup) => {
        if (!src) {
          loadedPolygons.value = null;
          return;
        }
        let cancelled = false;
        onCleanup(() => { cancelled = true; });
        loadMesh(src)
          .then((result) => { if (!cancelled) loadedPolygons.value = result.polygons; })
          .catch(() => { if (!cancelled) loadedPolygons.value = []; });
      },
      { immediate: true },
    );

    const sourcePolygons = computed<Polygon[]>(() => {
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

    const glyphPolygons = computed<Polygon[]>(() => transformPolygonsToGlyph(
      sourcePolygons.value,
      applyObjectProps(props.object ?? objectRef.value, {
        position: props.position,
        rotation: props.rotation,
        scale: props.scale,
      }),
    ));

    function buildTransform(): GlyphMeshTransform {
      const t: GlyphMeshTransform = {};
      if (props.id) t.id = props.id;
      t.castShadow = props.castShadow;
      t.receiveShadow = props.receiveShadow;
      if (props.density !== undefined) t.density = props.density;
      if (props.fontSize !== undefined) t.fontSize = props.fontSize;
      if (props.lineHeight !== undefined) t.lineHeight = props.lineHeight;
      if (props.transparent !== undefined) t.transparent = props.transparent;
      return t;
    }

    function register(): void {
      const scene = sceneRef.value;
      if (!scene) return;
      const handle = scene.add(glyphPolygons.value, buildTransform());
      meshRef.value = handle;
    }

    function unregister(): void {
      meshRef.value?.dispose();
      meshRef.value = null;
    }

    const stopWatch = watchEffect(() => {
      if (!sceneRef.value || meshRef.value) return;
      register();
    });

    onBeforeUnmount(() => {
      stopWatch();
      unregister();
    });

    watch(glyphPolygons, () => {
      if (meshRef.value) meshRef.value.setPolygons(glyphPolygons.value);
      else register();
    });

    watch(
      () => ({
        id: props.id,
        castShadow: props.castShadow,
        receiveShadow: props.receiveShadow,
        density: props.density,
        fontSize: props.fontSize,
        lineHeight: props.lineHeight,
        transparent: props.transparent,
      }),
      () => {
        const mesh = meshRef.value;
        if (!mesh) return;
        mesh.setTransform(buildTransform());
        sceneRef.value?.rerender();
      },
      { deep: false },
    );

    return () => h(
      "div",
      {
        "data-glyph-mesh-id": props.id,
        class: `glyph-three-mesh${props.class ? ` ${props.class}` : ""}`,
        style: props.style,
      },
      slots.default?.() ?? [],
    );
  },
});
