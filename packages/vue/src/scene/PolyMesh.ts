/**
 * PolyMesh — load a mesh URL (or accept a polygons array) and render its
 * polygons inside a `.polycss-mesh` wrapper that carries the mesh-wide
 * position/scale/rotation transform. Per §API freeze and §Design.4c.
 *
 * Uses nested DOM (preserve-3d) so the wrapper transform composes with each
 * child <Poly>'s vertex matrix3d via CSS without JS doing the matrix math.
 *
 * Scoped slot semantics (Vue equivalent of React's render-prop child):
 *   - Named scoped slot `polygon({ polygon, index })`: called once per parsed
 *     polygon. Returned elements render INSIDE the .polycss-mesh wrapper.
 *   - Default slot: static children placed inside the wrapper.
 *   - Named slot `fallback`: rendered while loading.
 *   - Named slot `error({ error })`: rendered on parse failure.
 *
 * When neither `polygon` slot nor `default` slot is provided, <Poly> elements
 * are rendered automatically for each polygon.
 */
import { defineComponent, h, computed } from "vue";
import type { PropType, VNode, CSSProperties } from "vue";
import type { Polygon, Vec3 } from "@polycss/core";
import { computeSceneBbox } from "@polycss/core";
import { Poly } from "../shapes/Poly";
import { useMesh } from "./useMesh";

export interface PolyMeshProps {
  src?: string;
  polygons?: Polygon[];
  autoCenter?: boolean;
  class?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
}

function buildTransform(
  position: Vec3 | undefined,
  scale: number | Vec3 | undefined,
  rotation: Vec3 | undefined
): string | undefined {
  const parts: string[] = [];
  if (position) {
    parts.push(`translate3d(${position[0]}px, ${position[1]}px, ${position[2]}px)`);
  }
  if (scale !== undefined) {
    if (typeof scale === "number") {
      if (scale !== 1) parts.push(`scale3d(${scale}, ${scale}, ${scale})`);
    } else {
      parts.push(`scale3d(${scale[0]}, ${scale[1]}, ${scale[2]})`);
    }
  }
  if (rotation) {
    if (rotation[0]) parts.push(`rotateX(${rotation[0]}deg)`);
    if (rotation[1]) parts.push(`rotateY(${rotation[1]}deg)`);
    if (rotation[2]) parts.push(`rotateZ(${rotation[2]}deg)`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function recenterPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  if (cx === 0 && cy === 0 && cz === 0) return polygons;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(
      (v): Vec3 => [v[0] - cx, v[1] - cy, v[2] - cz]
    ),
  }));
}

export const PolyMesh = defineComponent({
  name: "PolyMesh",
  inheritAttrs: false,
  props: {
    src: { type: String, default: undefined },
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    class: { type: String },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
  },
  setup(props, { slots, attrs }) {
    // useMesh requires a Ref<string>. Computed ref wraps the src prop.
    const srcRef = computed(() => props.src ?? "");
    const fetched = useMesh(srcRef);

    const sourcePolygons = computed<Polygon[]>(() =>
      props.src ? fetched.polygons.value : (props.polygons ?? [])
    );

    const polygons = computed<Polygon[]>(() =>
      props.autoCenter ? recenterPolygons(sourcePolygons.value) : sourcePolygons.value
    );

    return () => {
      const transform = buildTransform(props.position, props.scale, props.rotation);
      const wrapperStyle: CSSProperties = {
        position: "absolute",
        transformStyle: "preserve-3d",
        transform,
        ...(attrs.style as CSSProperties | undefined),
      };

      const extraAttrs = Object.fromEntries(
        Object.entries(attrs).filter(([k]) => k !== "style" && k !== "class")
      );

      const wrapperClass = `polycss-mesh${props.class ? ` ${props.class}` : ""}`;

      // Loading slot — only when fetching from src
      if (props.src && fetched.loading.value && fetched.polygons.value.length === 0) {
        return h(
          "div",
          {
            class: `polycss-mesh polycss-mesh-loading${props.class ? ` ${props.class}` : ""}`,
            style: wrapperStyle,
            ...extraAttrs,
          },
          slots.fallback?.() ?? []
        );
      }

      // Error slot — only when fetching from src
      if (props.src && fetched.error.value && fetched.polygons.value.length === 0) {
        return h(
          "div",
          {
            class: `polycss-mesh polycss-mesh-error${props.class ? ` ${props.class}` : ""}`,
            style: wrapperStyle,
            ...extraAttrs,
          },
          slots.error?.({ error: fetched.error.value }) ?? []
        );
      }

      const polys = polygons.value;

      // Build polygon nodes: use `polygon` scoped slot if provided, else auto-render <Poly>.
      const polyNodes: VNode[] = polys.map((p, i) => {
        const slotContent = slots.polygon?.({ polygon: p, index: i });
        if (slotContent && slotContent.length > 0) {
          return h("template", { key: i }, slotContent);
        }
        return h(Poly, {
          key: i,
          vertices: p.vertices,
          color: p.color,
          texture: p.texture,
          uvs: p.uvs,
          data: p.data,
        });
      });

      // Static default slot children (e.g. additional <PolyMesh> children)
      const defaultChildren = slots.default?.() ?? [];

      return h(
        "div",
        {
          class: wrapperClass,
          style: wrapperStyle,
          ...extraAttrs,
        },
        [...polyNodes, ...defaultChildren]
      );
    };
  },
});
