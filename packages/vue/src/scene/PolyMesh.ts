/**
 * PolyMesh — load a mesh URL (or accept a polygons array) and render its
 * polygons inside a `.polycss-mesh` wrapper that carries the mesh-wide
 * position/scale/rotation transform. Per §API freeze and §Design.4c.
 *
 * Uses nested DOM (preserve-3d) so the wrapper transform composes with each
 * atlas polygon's vertex matrix3d via CSS without JS doing the matrix math.
 *
 * Scoped slot semantics (Vue equivalent of React's render-prop child):
 *   - Named scoped slot `polygon({ polygon, index })`: called once per parsed
 *     polygon. Returned elements render INSIDE the .polycss-mesh wrapper.
 *   - Default slot: static children placed inside the wrapper.
 *   - Named slot `fallback`: rendered while loading.
 *   - Named slot `error({ error })`: rendered on parse failure.
 *
 * When no `polygon` slot is provided, atlas-backed polygon i elements are rendered
 * automatically for each polygon.
 */
import { defineComponent, h, computed, inject, onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { PropType, VNode, CSSProperties } from "vue";
import type { Polygon, PolyTextureLightingMode, Vec3 } from "@layoutit/polycss-core";
import { computeSceneBbox, inverseRotateVec3, findOverlappingPolygonDuplicates, parseHexColor } from "@layoutit/polycss-core";
import { usePolyMesh } from "./useMesh";
import {
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  cssBorderShapeForPlan,
  getSolidPaintDefaults,
  isSolidTrianglePlan,
  type TextureQuality,
  type SolidPaintDefaults,
  renderTextureBorderShapePoly,
  renderTextureAtlasPoly,
  renderTextureTrianglePoly,
  useTextureAtlas,
} from "./textureAtlas";
import { usePolySceneContext } from "./sceneContext";
import { PolyCameraContextKey } from "../camera";
import {
  findPolyMeshHandle,
  registerMeshElement,
  unregisterMeshElement,
  type InteractionProps,
  type PolyEventHandler,
  type PolyMeshHandle,
  type PolyPointerEvent,
} from "./events";

function solidPaintVars(defaults: SolidPaintDefaults): CSSProperties | null {
  const out: CSSProperties = {};
  if (defaults.paintColor) out["--polycss-paint"] = defaults.paintColor;
  if (defaults.dynamicColor) {
    out["--psr"] = (defaults.dynamicColor.r / 255).toFixed(4);
    out["--psg"] = (defaults.dynamicColor.g / 255).toFixed(4);
    out["--psb"] = (defaults.dynamicColor.b / 255).toFixed(4);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface PolyMeshProps extends InteractionProps {
  /** Stable identifier — exposed on the mesh handle and reflected on
   *  the wrapper as `data-poly-mesh-id`. Used by Select / TransformControls
   *  for selection lookups. */
  id?: string;
  src?: string;
  /**
   * Companion `.mtl` URL for OBJ models. When set, materials defined in
   * the mtl are applied to the loaded mesh. Ignored for GLB/GLTF.
   */
  mtl?: string;
  polygons?: Polygon[];
  autoCenter?: boolean;
  textureLighting?: PolyTextureLightingMode;
  /** Raster scale for generated atlas pages. `"auto"` (default) downscales to
   *  a device-appropriate memory budget (~4 MB mobile / ~16 MB desktop).
   *  Numeric values 0.1..1 force an explicit scale. */
  textureQuality?: TextureQuality;
  /** Repairs antialiased atlas pixels at shared textured polygon edges without expanding geometry. Defaults to the scene context, then true. */
  experimentalTextureEdgeRepair?: boolean;
  /**
   * When `true` and the scene is in dynamic lighting mode, the renderer emits
   * a flat shadow leaf sibling for each non-duplicate polygon. The shadow is
   * projected onto the ground plane along the CSS-space light direction.
   * Defaults to `false`.
   */
  castShadow?: boolean;
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
  const shift = (v: Vec3): Vec3 => [v[0] - cx, v[1] - cy, v[2] - cz];
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(shift),
    ...(p.textureTriangles?.length
      ? {
          textureTriangles: p.textureTriangles.map((triangle) => ({
            ...triangle,
            vertices: triangle.vertices.map(shift) as [Vec3, Vec3, Vec3],
          })),
        }
      : null),
  }));
}

export const PolyMesh = defineComponent({
  name: "PolyMesh",
  inheritAttrs: false,
  props: {
    id: { type: String, default: undefined },
    src: { type: String, default: undefined },
    mtl: { type: String, default: undefined },
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    textureLighting: { type: String as PropType<PolyTextureLightingMode>, default: undefined },
    textureQuality: { type: [Number, String] as PropType<TextureQuality>, default: undefined },
    experimentalTextureEdgeRepair: { type: Boolean as PropType<boolean>, default: undefined },
    castShadow: { type: Boolean as PropType<boolean>, default: false },
    class: { type: String },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    onClick: { type: Function as PropType<PolyEventHandler<MouseEvent>>, default: undefined },
    onContextMenu: { type: Function as PropType<PolyEventHandler<MouseEvent>>, default: undefined },
    onDoubleClick: { type: Function as PropType<PolyEventHandler<MouseEvent>>, default: undefined },
    onWheel: { type: Function as PropType<PolyEventHandler<WheelEvent>>, default: undefined },
    onPointerDown: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerUp: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerMove: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerOver: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerOut: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerEnter: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerLeave: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
    onPointerCancel: { type: Function as PropType<PolyEventHandler<PointerEvent>>, default: undefined },
  },
  setup(props, { slots, attrs, expose }) {
    // useMesh requires a Ref<string>. Computed ref wraps the src prop.
    const srcRef = computed(() => props.src ?? "");
    const meshOptions = computed(() => (props.mtl ? { mtlUrl: props.mtl } : undefined));
    const fetched = usePolyMesh(srcRef, meshOptions.value);

    const propPolygons = computed<Polygon[]>(() =>
      props.src ? fetched.polygons.value : (props.polygons ?? [])
    );

    // Holds a locally-mutated copy of the polygon array after updatePolygon()
    // is called. Reset to null whenever the upstream polygon source changes so
    // a fresh prop assignment or a completed src-fetch wins over stale edits.
    const polygonOverride = ref<Polygon[] | null>(null);
    watch(propPolygons, () => { polygonOverride.value = null; });

    const sourcePolygons = computed<Polygon[]>(() =>
      polygonOverride.value ?? propPolygons.value
    );

    const polygons = computed<Polygon[]>(() =>
      props.autoCenter ? recenterPolygons(sourcePolygons.value) : sourcePolygons.value
    );
    const atlasAutoRender = !slots.polygon;

    // Inherit textureLighting + lights from the parent <PolyScene> so that
    // helper polygons (e.g. light marker octahedron) participate in the
    // scene's dynamic mode instead of getting overpainted by the scene's
    // global CSS rule with default normals.
    const sceneCtx = usePolySceneContext();
    const atlasTextureLighting = computed<PolyTextureLightingMode>(
      () => props.textureLighting ?? sceneCtx?.value.textureLighting ?? "baked",
    );
    const atlasDirectional = computed(() =>
      atlasTextureLighting.value === "dynamic" ? undefined : sceneCtx?.value.directionalLight,
    );
    const atlasAmbient = computed(() =>
      atlasTextureLighting.value === "dynamic" ? undefined : sceneCtx?.value.ambientLight,
    );
    const atlasTextureEdgeRepair = computed(() =>
      props.experimentalTextureEdgeRepair ?? sceneCtx?.value.experimentalTextureEdgeRepair ?? true,
    );

    // Dynamic lighting override: when textureLighting is "dynamic" AND the
    // mesh has a non-zero rotation, we emit overridden --plx/ly/lz
    // vars on the wrapper. The scene emits world-space light vars; polygons
    // use local-space normals for the Lambert dot product, so when a mesh
    // rotates, we must supply the light direction in the mesh-local frame
    // via inverseRotateVec3. Cascade rules mean these vars shadow the scene-
    // level values only for this mesh's polygons.
    const dynamicLightOverride = computed<Record<string, string> | null>(() => {
      if (atlasTextureLighting.value !== "dynamic") return null;
      const rot = props.rotation;
      if (!rot || (rot[0] === 0 && rot[1] === 0 && rot[2] === 0)) return null;
      const dir = sceneCtx?.value.directionalLight?.direction;
      if (!dir) return null;
      const localDir = inverseRotateVec3(dir, rot);
      const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
      return {
        "--plx": (localDir[0] / len).toFixed(4),
        "--ply": (localDir[1] / len).toFixed(4),
        "--plz": (localDir[2] / len).toFixed(4),
      };
    });

    // bakedRotation is the rotation snapshot used by the atlas baker.
    // It only advances when rebakeAtlas() is called (or on initial mount),
    // NOT on every prop change — that would rebake every frame during a drag.
    // The visual wrapper uses the live `rotation` prop (smooth feedback);
    // the atlas uses bakedRotation (jumps to current rotation on release).
    const bakedRotation = ref<Vec3 | undefined>(props.rotation);

    const textureAtlasPlans = computed(() => {
      if (!atlasAutoRender) return [];
      const baseLight = atlasDirectional.value;
      // Inverse-rotate the world light into the mesh-local frame so the
      // pre-multiplied Lambert term stays correct after the mesh rotates.
      // dot(localNormal, localLight) === dot(worldNormal, worldLight).
      const effectiveLight = baseLight && bakedRotation.value
        ? { ...baseLight, direction: inverseRotateVec3(baseLight.direction, bakedRotation.value) }
        : baseLight;
      const repairEdges = buildTextureEdgeRepairSets(polygons.value);
      return polygons.value.map((p, i) =>
        computeTextureAtlasPlan(p, i, {
          directionalLight: effectiveLight,
          ambientLight: atlasAmbient.value,
          textureEdgeRepairEdges: repairEdges[i],
          experimentalTextureEdgeRepair: atlasTextureEdgeRepair.value,
        }),
      );
    });
    const atlasTextureQuality = computed(() => props.textureQuality);
    const textureAtlas = useTextureAtlas(textureAtlasPlans, atlasTextureLighting, atlasTextureQuality);
    const solidPaintDefaults = computed<SolidPaintDefaults>(() =>
      atlasAutoRender ? getSolidPaintDefaults(textureAtlasPlans.value, atlasTextureLighting.value) : {},
    );
    const defaultPaintVars = computed(() => solidPaintVars(solidPaintDefaults.value));

    // Shadow leaf emission. Only active when castShadow=true and the scene is
    // in dynamic lighting mode. Computed from textureAtlasPlans so every
    // polygon (including textured <s> polygons) gets a shadow leaf based on
    // its outline.
    const shadowNodes = computed<Array<VNode | null>>(() => {
      if (!props.castShadow || atlasTextureLighting.value !== "dynamic") return [];
      const shadowOpts = sceneCtx?.value.shadow;
      const shadowColor = shadowOpts?.color ?? "#000000";
      const shadowOpacity = shadowOpts?.opacity ?? 0.25;
      const parsed = parseHexColor(shadowColor)?.rgb ?? [0, 0, 0];
      const shadowColorCss = `rgba(${parsed[0]},${parsed[1]},${parsed[2]},${shadowOpacity})`;

      const plans = textureAtlasPlans.value;
      if (plans.length === 0) return [];

      const dedupDrop = findOverlappingPolygonDuplicates(polygons.value, {
        normalTolerance: 0.1,
        distanceTolerance: 0.5,
        overlapFraction: 0.4,
      });

      return plans.map((plan, index) => {
        if (dedupDrop.has(index)) return null;
        const origMatrix = `matrix3d(${plan.matrix})`;
        const borderShape = cssBorderShapeForPlan(plan);
        const style: CSSProperties = {
          transform: `var(--shadow-proj) ${origMatrix}`,
          color: shadowColorCss,
          width: `${plan.canvasW}px`,
          height: `${plan.canvasH}px`,
          "--pnx": plan.normal[0].toFixed(4),
          "--pny": plan.normal[1].toFixed(4),
          "--pnz": plan.normal[2].toFixed(4),
        };

        const applyShadowBorderShape = (vnode: VNode) => {
          const el = vnode.el as HTMLElement | null;
          if (!el) return;
          el.style.setProperty("border-shape", borderShape);
        };

        return h("q", {
          class: "polycss-shadow",
          style,
          onVnodeMounted: applyShadowBorderShape,
          onVnodeUpdated: applyShadowBorderShape,
        });
      });
    });

    // Register this mesh with the shadow registry when castShadow=true so
    // PolyScene can compute --shadow-ground-cssz reactively.
    const shadowRegistryId = Symbol();
    watch(
      () => [props.castShadow, atlasTextureLighting.value] as const,
      ([castShadow, lighting], _, onCleanup) => {
        const registry = sceneCtx?.value.shadowRegistry;
        if (!registry) return;
        if (castShadow && lighting === "dynamic") {
          registry.register(shadowRegistryId, () => polygons.value);
        } else {
          registry.unregister(shadowRegistryId);
        }
        onCleanup(() => registry.unregister(shadowRegistryId));
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      sceneCtx?.value.shadowRegistry?.unregister(shadowRegistryId);
    });

    // Imperative handle exposed via defineExpose. Read-only view of
    // the mesh's element + transform + polygons. Stable getter object;
    // refs keep getters cheap without rebuilding on every render.
    const wrapperRef = ref<HTMLDivElement | null>(null);
    const handle: PolyMeshHandle = {
      get element() { return wrapperRef.value; },
      get id() { return props.id; },
      getPosition: () => props.position,
      getRotation: () => props.rotation,
      getScale: () => props.scale,
      getPolygons: () => polygons.value,
      updatePolygon(target: Polygon | number, partial: Partial<Polygon>) {
        const current = polygons.value;
        const idx = typeof target === "number"
          ? target
          : current.indexOf(target);
        if (idx < 0 || idx >= current.length) return;
        Object.assign(current[idx], partial);
        // Produce a new array reference so Vue's computed reacts and
        // re-renders the atlas (the polygon object itself is mutated
        // in place to preserve identity for callers holding a ref).
        polygonOverride.value = current.slice();
      },
      rebakeAtlas: () => {
        bakedRotation.value = props.rotation;
      },
    };
    expose(handle);

    // Register the wrapper element so Select / TransformControls can
    // resolve clicks back to this handle via findMeshHandle.
    onMounted(() => {
      if (wrapperRef.value) registerMeshElement(wrapperRef.value, handle);
    });
    onBeforeUnmount(() => {
      if (wrapperRef.value) unregisterMeshElement(wrapperRef.value);
    });

    // Event synthesis. Build the polycss-shaped payload from a native
    // DOM event. `intersections` walks elementsFromPoint to find every
    // mesh stacked under the pointer; `pointer` is NDC against the
    // camera viewport (falls back to (0,0) outside a <PolyCamera>).
    const cameraCtx = inject(PolyCameraContextKey, null);
    let pointerDownAt: { x: number; y: number } | null = null;

    function makeEvent<E extends Event>(
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): PolyPointerEvent<E> {
      const intersections: Array<{ object: PolyMeshHandle }> = [];
      if (typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
        const stacked = document.elementsFromPoint(clientX, clientY);
        const seen = new Set<PolyMeshHandle>();
        for (const el of stacked) {
          const h = findPolyMeshHandle(el);
          if (h && !seen.has(h)) {
            seen.add(h);
            intersections.push({ object: h });
          }
        }
      }
      let nx = 0;
      let ny = 0;
      const camEl = cameraCtx?.cameraElRef.value;
      if (camEl) {
        const r = camEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          nx = ((clientX - r.left) / r.width) * 2 - 1;
          ny = -(((clientY - r.top) / r.height) * 2 - 1);
        }
      }
      let delta = 0;
      if (pointerDownAt) {
        delta = Math.hypot(clientX - pointerDownAt.x, clientY - pointerDownAt.y);
      }
      return {
        object: intersections[0]?.object ?? handle,
        eventObject: handle,
        intersections,
        pointer: { x: nx, y: ny },
        delta,
        nativeEvent,
        stopPropagation: () => nativeEvent.stopPropagation(),
      };
    }

    function dispatch<E extends Event>(
      handler: PolyEventHandler<E> | undefined,
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): void {
      if (!handler) return;
      handler(makeEvent(nativeEvent, clientX, clientY));
    }

    return () => {
      const transform = buildTransform(props.position, props.scale, props.rotation);
      const wrapperStyle: CSSProperties = {
        transform,
        ...(dynamicLightOverride.value as CSSProperties | null ?? undefined),
        ...(attrs.style as CSSProperties | undefined),
        ...(defaultPaintVars.value ?? undefined),
      };

      const extraAttrs = Object.fromEntries(
        Object.entries(attrs).filter(([k]) => k !== "style" && k !== "class")
      );

      const wrapperClass = `polycss-mesh${props.class ? ` ${props.class}` : ""}`;

      // Build the union of DOM handlers we need to attach. Each
      // registered prop becomes a `onXxx` attr on the wrapper div;
      // omitted props add zero overhead. pointerOver/pointerOut are
      // mapped to enter/leave so they fire once per mesh boundary
      // crossing (not per internal polygon transition).
      const handlers: Record<string, (e: Event) => void> = {};
      if (props.onClick) {
        handlers.onClick = (e) => {
          const m = e as MouseEvent;
          dispatch(props.onClick, m, m.clientX, m.clientY);
        };
      }
      if (props.onContextMenu) {
        handlers.onContextmenu = (e) => {
          const m = e as MouseEvent;
          dispatch(props.onContextMenu, m, m.clientX, m.clientY);
        };
      }
      if (props.onDoubleClick) {
        handlers.onDblclick = (e) => {
          const m = e as MouseEvent;
          dispatch(props.onDoubleClick, m, m.clientX, m.clientY);
        };
      }
      if (props.onWheel) {
        handlers.onWheel = (e) => {
          const m = e as WheelEvent;
          dispatch(props.onWheel, m, m.clientX, m.clientY);
        };
      }
      // pointerdown is always wired (even without user handler) so we
      // can track delta for click-vs-drag discrimination.
      handlers.onPointerdown = (e) => {
        const p = e as PointerEvent;
        pointerDownAt = { x: p.clientX, y: p.clientY };
        dispatch(props.onPointerDown, p, p.clientX, p.clientY);
      };
      handlers.onPointerup = (e) => {
        const p = e as PointerEvent;
        dispatch(props.onPointerUp, p, p.clientX, p.clientY);
        pointerDownAt = null;
      };
      if (props.onPointerMove) {
        handlers.onPointermove = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerMove, p, p.clientX, p.clientY);
        };
      }
      if (props.onPointerOver || props.onPointerEnter) {
        handlers.onPointerenter = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerOver, p, p.clientX, p.clientY);
          dispatch(props.onPointerEnter, p, p.clientX, p.clientY);
        };
      }
      if (props.onPointerOut || props.onPointerLeave) {
        handlers.onPointerleave = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerOut, p, p.clientX, p.clientY);
          dispatch(props.onPointerLeave, p, p.clientX, p.clientY);
        };
      }
      if (props.onPointerCancel) {
        handlers.onPointercancel = (e) => {
          const p = e as PointerEvent;
          dispatch(props.onPointerCancel, p, p.clientX, p.clientY);
          pointerDownAt = null;
        };
      }

      const meshIdAttr: Record<string, string> = props.id ? { "data-poly-mesh-id": props.id } : {};

      // Loading slot — only when fetching from src
      if (props.src && fetched.loading.value && fetched.polygons.value.length === 0) {
        return h(
          "div",
          {
            ref: wrapperRef,
            class: `polycss-mesh polycss-mesh-loading${props.class ? ` ${props.class}` : ""}`,
            style: wrapperStyle,
            ...meshIdAttr,
            ...handlers,
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
            ref: wrapperRef,
            class: `polycss-mesh polycss-mesh-error${props.class ? ` ${props.class}` : ""}`,
            style: wrapperStyle,
            ...meshIdAttr,
            ...handlers,
            ...extraAttrs,
          },
          slots.error?.({ error: fetched.error.value }) ?? []
        );
      }

      const polys = polygons.value;

      // Build polygon nodes: use `polygon` scoped slot if provided, else auto-render atlas elements.
      const polyNodes: Array<VNode | null> = slots.polygon
        ? polys.map((p, i) => h("template", { key: i }, slots.polygon?.({ polygon: p, index: i })))
        : textureAtlas.entries.value.map((entry, index) => {
            if (entry) {
              return renderTextureAtlasPoly({
                entry,
                page: textureAtlas.pages.value[entry.pageIndex],
                textureLighting: atlasTextureLighting.value,
              });
            }
            const plan = textureAtlasPlans.value[index];
            if (!plan || plan.texture) return null;
            return isSolidTrianglePlan(plan)
              ? renderTextureTrianglePoly({
                  entry: plan,
                  textureLighting: atlasTextureLighting.value,
                  solidPaintDefaults: solidPaintDefaults.value,
                })
              : renderTextureBorderShapePoly({
                  entry: plan,
                  solidPaintDefaults: solidPaintDefaults.value,
                });
          });

      // Static default slot children (e.g. additional <PolyMesh> children)
      const defaultChildren = slots.default?.() ?? [];

      // Shadow leaves go before polygon nodes so they sit below casters in
      // DOM order — painter-order tie-breaking favors earlier nodes when both
      // are coplanar in 3D.
      const shadows = shadowNodes.value;

      return h(
        "div",
        {
          ref: wrapperRef,
          class: wrapperClass,
          style: wrapperStyle,
          ...meshIdAttr,
          ...handlers,
          ...extraAttrs,
        },
        [...shadows, ...polyNodes, ...defaultChildren]
      );
    };
  },
});
