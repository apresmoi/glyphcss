/**
 * PolyMesh — load a mesh URL (or accept a polygons array) and render its
 * polygons inside a `.polycss-mesh` wrapper that carries the mesh-wide
 * position/scale/rotation transform. Per §API freeze and §Design.4c.
 *
 * Uses nested DOM (preserve-3d) so the wrapper transform composes with each
 * atlas polygon's vertex matrix3d via CSS without JS doing the matrix math.
 *
 * Render-prop semantics (per §2a "Render-prop semantics"):
 *   - `children(polygon, index)` is called once per parsed polygon.
 *   - Returned elements render INSIDE the .polycss-mesh wrapper, so they
 *     inherit the mesh transform automatically. Don't re-apply position
 *     or you'll double-transform.
 */
import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import type {
  Polygon,
  PolyTextureLightingMode,
  Vec3,
} from "@layoutit/polycss-core";
import { computeSceneBbox, inverseRotateVec3 } from "@layoutit/polycss-core";
import type { TransformProps } from "../shapes/types";
import { usePolyMesh, type UseMeshOptions } from "./useMesh";
import {
  computeTextureAtlasPlan,
  getSolidPaintDefaults,
  isSolidTrianglePlan,
  type AtlasScale,
  type SolidPaintDefaults,
  TextureBorderShapePoly,
  TextureAtlasPoly,
  TextureTrianglePoly,
  buildSharedEdgeSets,
  useTextureAtlas,
} from "./textureAtlas";
import { usePolySceneContext } from "./sceneContext";
import { PolyCameraContext } from "../camera/context";
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
  const out: Record<string, string> = {};
  if (defaults.paintColor) out["--polycss-paint"] = defaults.paintColor;
  if (defaults.dynamicColor) {
    out["--psr"] = (defaults.dynamicColor.r / 255).toFixed(4);
    out["--psg"] = (defaults.dynamicColor.g / 255).toFixed(4);
    out["--psb"] = (defaults.dynamicColor.b / 255).toFixed(4);
  }
  return Object.keys(out).length > 0 ? out as CSSProperties : null;
}

export interface PolyMeshProps extends TransformProps, InteractionProps {
  /** Stable identifier — exposed on the mesh handle and reflected as
   *  `data-poly-mesh-id` on the wrapper div. Use for selection lookups. */
  id?: string;
  /** URL to .obj / .glb / .gltf. Mutually exclusive with `polygons`. */
  src?: string;
  /**
   * Companion `.mtl` URL for OBJ models. When set, materials defined in
   * the mtl (Kd colors, map_Kd textures) are applied to the loaded mesh.
   * Ignored for GLB/GLTF (they carry materials inline).
   */
  mtl?: string;
  /** Pre-parsed polygons. Mutually exclusive with `src`. */
  polygons?: Polygon[];
  /** Translate so mesh's bbox center is at local origin before applying `position`. */
  autoCenter?: boolean;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: PolyTextureLightingMode;
  /** Raster scale for generated atlas pages. `"auto"` reduces large atlases. */
  atlasScale?: AtlasScale;
  /** Per-polygon override render. Receives the polygon + its index. */
  children?: (polygon: Polygon, index: number) => ReactNode;
  /** Loading slot — rendered while `src` is being fetched/parsed. */
  fallback?: ReactNode;
  /** Error slot — rendered if parse fails. Receives the Error. */
  errorFallback?: (error: Error) => ReactNode;
  /** Parser options forwarded to parseObj/parseGltf. */
  parseOptions?: UseMeshOptions;
  className?: string;
  style?: CSSProperties;
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

export const PolyMesh = forwardRef<PolyMeshHandle, PolyMeshProps>(function PolyMesh(
  {
    id,
    src,
    mtl,
    polygons: polygonsProp,
    autoCenter,
    textureLighting,
    atlasScale,
    children,
    fallback,
    errorFallback,
    parseOptions,
    position,
    scale,
    rotation,
    className,
    style,
    onClick,
    onContextMenu,
    onDoubleClick,
    onWheel,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerOver,
    onPointerOut,
    onPointerEnter,
    onPointerLeave,
    onPointerCancel,
  }: PolyMeshProps,
  forwardedRef,
) {
  // Compose mtl prop into the parser options threaded to useMesh.
  const mergedOptions = useMemo<UseMeshOptions | undefined>(() => {
    if (!mtl && !parseOptions) return undefined;
    return { ...(parseOptions ?? {}), ...(mtl ? { mtlUrl: mtl } : {}) };
  }, [mtl, parseOptions]);

  // Either fetch via useMesh, or use the supplied polygons array.
  // useMesh tolerates an empty src (sits idle) so we always call it for
  // hook-rules consistency.
  const fetched = usePolyMesh(src ?? "", mergedOptions);

  const sourcePolygons = src ? fetched.polygons : (polygonsProp ?? []);

  // Re-center vertices into mesh-local space if autoCenter is set. Done
  // once per polygon-list identity — bake into vertices, not per frame.
  const polygons = useMemo(
    () => (autoCenter ? recenterPolygons(sourcePolygons) : sourcePolygons),
    [sourcePolygons, autoCenter]
  );

  const transform = buildTransform(position, scale, rotation);

  // ── Imperative ref handle + DOM registry ──────────────────────────────
  // The handle is a stable object whose getters always read the latest
  // props. Refs keep getters cheap without rebuilding the handle on every
  // render. The DOM-element registry lets <Select> and <TransformControls>
  // resolve a click target back to its owning mesh in O(depth).
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef({ position, scale, rotation });
  propsRef.current = { position, scale, rotation };
  const polygonsRef = useRef(polygons);
  polygonsRef.current = polygons;

  // `bakedRotation` is the rotation that was in effect when the atlas was
  // last rasterized. It starts equal to the initial `rotation` prop and
  // only advances when `rebakeAtlas()` is called (e.g. on rotate-drag
  // release). This decouples the smooth CSS wrapper transform (live
  // `rotation`) from the atlas baker, so we don't re-bake every frame
  // during a drag.
  const [bakedRotation, setBakedRotation] = useState<Vec3 | undefined>(rotation);

  const handle = useMemo<PolyMeshHandle>(() => ({
    get element() { return wrapperRef.current; },
    id,
    getPosition: () => propsRef.current.position,
    getRotation: () => propsRef.current.rotation,
    getScale: () => propsRef.current.scale,
    getPolygons: () => polygonsRef.current,
    rebakeAtlas: () => setBakedRotation(propsRef.current.rotation),
  }), [id]);

  useImperativeHandle(forwardedRef, () => handle, [handle]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    registerMeshElement(el, handle);
    return () => unregisterMeshElement(el);
  }, [handle]);

  // ── Pointer event synthesis ───────────────────────────────────────────
  // Build the polycss-shaped payload from a native React synthetic event.
  // intersections come from elementsFromPoint, walked up to nearest mesh
  // ancestor — front-to-back order matches DOM stacking. NDC pointer is
  // computed against the camera viewport bounds (falls back to (0,0) when
  // PolyMesh is rendered outside a <PolyCamera>).
  const cameraCtx = useContext(PolyCameraContext);
  const cameraElRef = cameraCtx?.cameraElRef ?? null;
  const pointerDownAtRef = useRef<{ x: number; y: number } | null>(null);

  const makeEvent = useCallback(
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
      const camEl = cameraElRef?.current;
      if (camEl) {
        const r = camEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          nx = ((clientX - r.left) / r.width) * 2 - 1;
          ny = -(((clientY - r.top) / r.height) * 2 - 1);
        }
      }
      let delta = 0;
      const pd = pointerDownAtRef.current;
      if (pd) delta = Math.hypot(clientX - pd.x, clientY - pd.y);
      return {
        object: intersections[0]?.object ?? handle,
        eventObject: handle,
        intersections,
        pointer: { x: nx, y: ny },
        delta,
        nativeEvent,
        stopPropagation: () => nativeEvent.stopPropagation(),
      };
    },
    [cameraElRef, handle],
  );

  // Build the union of DOM handlers we need to attach. Wiring stays inert
  // when the user provides no handlers — `wrapperHandlers` ends up empty.
  const wrapperHandlers = useMemo(() => {
    // Wrap the polycss event's stopPropagation to ALSO stop React's
    // synthetic event propagation (which is the relevant tree-bubbling
    // for ancestor handlers in JSX). Without this, calling
    // event.stopPropagation() from a polycss handler would only stop
    // native DOM bubbling — React's tree bubbling would still hit
    // ancestor onClick handlers, surprising consumers.
    const dispatch = <E extends Event, R extends { stopPropagation(): void }>(
      polyHandler: PolyEventHandler<E> | undefined,
      reactEvent: R,
      nativeEvent: E,
      clientX: number,
      clientY: number,
    ): void => {
      if (!polyHandler) return;
      const polyEvent = makeEvent(nativeEvent, clientX, clientY);
      const originalStop = polyEvent.stopPropagation;
      polyEvent.stopPropagation = () => {
        originalStop();
        reactEvent.stopPropagation();
      };
      polyHandler(polyEvent);
    };
    const out: {
      onClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onDoubleClick?: (e: ReactMouseEvent<HTMLDivElement>) => void;
      onWheel?: (e: ReactWheelEvent<HTMLDivElement>) => void;
      onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerEnter?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerLeave?: (e: ReactPointerEvent<HTMLDivElement>) => void;
      onPointerCancel?: (e: ReactPointerEvent<HTMLDivElement>) => void;
    } = {};
    if (onClick) {
      out.onClick = (e) => dispatch(onClick, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onContextMenu) {
      out.onContextMenu = (e) => dispatch(onContextMenu, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onDoubleClick) {
      out.onDoubleClick = (e) => dispatch(onDoubleClick, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onWheel) {
      out.onWheel = (e) => dispatch(onWheel, e, e.nativeEvent, e.clientX, e.clientY);
    }
    if (onPointerDown) {
      out.onPointerDown = (e) => {
        pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
        dispatch(onPointerDown, e, e.nativeEvent, e.clientX, e.clientY);
      };
    } else {
      // Still need to track pointerdown for delta computation when other
      // handlers (move/up/click) want it.
      out.onPointerDown = (e) => {
        pointerDownAtRef.current = { x: e.clientX, y: e.clientY };
      };
    }
    if (onPointerUp) {
      out.onPointerUp = (e) => {
        dispatch(onPointerUp, e, e.nativeEvent, e.clientX, e.clientY);
        pointerDownAtRef.current = null;
      };
    } else {
      out.onPointerUp = () => { pointerDownAtRef.current = null; };
    }
    if (onPointerMove) {
      out.onPointerMove = (e) => dispatch(onPointerMove, e, e.nativeEvent, e.clientX, e.clientY);
    }
    // r3f: onPointerOver and onPointerEnter both fire on entering the
    // mesh; onPointerOut and onPointerLeave on leaving. DOM enter/leave
    // (no bubble for child→child transitions) is the right primitive.
    if (onPointerOver || onPointerEnter) {
      out.onPointerEnter = (e) => {
        if (onPointerOver) dispatch(onPointerOver, e, e.nativeEvent, e.clientX, e.clientY);
        if (onPointerEnter) dispatch(onPointerEnter, e, e.nativeEvent, e.clientX, e.clientY);
      };
    }
    if (onPointerOut || onPointerLeave) {
      out.onPointerLeave = (e) => {
        if (onPointerOut) dispatch(onPointerOut, e, e.nativeEvent, e.clientX, e.clientY);
        if (onPointerLeave) dispatch(onPointerLeave, e, e.nativeEvent, e.clientX, e.clientY);
      };
    }
    if (onPointerCancel) {
      out.onPointerCancel = (e) => {
        dispatch(onPointerCancel, e, e.nativeEvent, e.clientX, e.clientY);
        pointerDownAtRef.current = null;
      };
    }
    return out;
  }, [
    makeEvent,
    onClick,
    onContextMenu,
    onDoubleClick,
    onWheel,
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerOver,
    onPointerOut,
    onPointerEnter,
    onPointerLeave,
    onPointerCancel,
  ]);

  // Inherit textureLighting + lights from the parent <PolyScene> so that
  // helper polygons (e.g. light marker octahedron) participate in the
  // scene's dynamic mode instead of getting overpainted by the scene's
  // global CSS rule with default normals.
  const sceneCtx = usePolySceneContext();
  const effectiveTextureLighting = textureLighting ?? sceneCtx?.textureLighting ?? "baked";
  const effectiveDirectional =
    effectiveTextureLighting === "dynamic" ? undefined : sceneCtx?.directionalLight;
  const effectiveAmbient =
    effectiveTextureLighting === "dynamic" ? undefined : sceneCtx?.ambientLight;

  // Dynamic-mode rotation fix: when the mesh has a non-zero rotation the
  // world-space light vars cascaded from <PolyScene> are wrong for the
  // per-polygon Lambert calc (which uses mesh-local normals). Override
  // --plx/ly/lz on the mesh wrapper with the light direction
  // inverse-rotated into the mesh's local frame. CSS cascade ensures the
  // override only affects this mesh's polygons. No debounce — CSS var
  // writes are cheap and this must track rotation in real time.
  const sceneDirectionalLight = sceneCtx?.directionalLight;
  const dynamicLightOverride = useMemo<CSSProperties | null>(() => {
    if (effectiveTextureLighting !== "dynamic") return null;
    if (!rotation || (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0)) return null;
    if (!sceneDirectionalLight) return null;
    const dir = sceneDirectionalLight.direction;
    const localDir = inverseRotateVec3(dir, rotation);
    const len = Math.hypot(localDir[0], localDir[1], localDir[2]) || 1;
    return {
      ["--plx" as string]: (localDir[0] / len).toFixed(4),
      ["--ply" as string]: (localDir[1] / len).toFixed(4),
      ["--plz" as string]: (localDir[2] / len).toFixed(4),
    };
  }, [effectiveTextureLighting, rotation, sceneDirectionalLight]);

  // Compute the effective light direction for baking. If the mesh has been
  // rotated since mount (bakedRotation), inverse-rotate the world-space
  // light direction into the mesh's local frame so the Lambert dot product
  // stays correct: dot(localNormal, localLight) === dot(worldNormal, worldLight).
  const bakedDirectional = useMemo(() => {
    if (!effectiveDirectional) return effectiveDirectional;
    const rot = bakedRotation ?? [0, 0, 0] as Vec3;
    if (rot[0] === 0 && rot[1] === 0 && rot[2] === 0) return effectiveDirectional;
    return {
      ...effectiveDirectional,
      direction: inverseRotateVec3(effectiveDirectional.direction, rot),
    };
  }, [effectiveDirectional, bakedRotation]);

  const atlasPlans = useMemo(
    () => {
      if (children) return [];
      const sharedEdges = buildSharedEdgeSets(polygons);
      return polygons.map((p, i) => computeTextureAtlasPlan(p, i, {
        directionalLight: bakedDirectional,
        ambientLight: effectiveAmbient,
        seamEdges: sharedEdges[i],
      }));
    },
    [children, polygons, bakedDirectional, effectiveAmbient],
  );
  const textureAtlas = useTextureAtlas(
    atlasPlans,
    effectiveTextureLighting,
    atlasScale,
  );
  const solidPaintDefaults = useMemo(
    () => !children ? getSolidPaintDefaults(atlasPlans, effectiveTextureLighting) : {},
    [children, atlasPlans, effectiveTextureLighting],
  );
  const defaultPaintVars = useMemo(
    () => solidPaintVars(solidPaintDefaults),
    [solidPaintDefaults],
  );

  const wrapperStyle: CSSProperties = {
    transform,
    ...dynamicLightOverride,
    ...style,
    ...defaultPaintVars,
  };

  const renderedPolygons = children
    ? polygons.map((p, i) => (
        // Render-prop: caller controls how each polygon renders. We still
        // wrap in a fragment with key so React reconciliation works.
        <RenderPropPolygon key={i} polygon={p} index={i}>
          {children}
        </RenderPropPolygon>
      ))
    : textureAtlas.entries.map((entry, index) => {
        if (entry) {
          return (
            <TextureAtlasPoly
              key={entry.index}
              entry={entry}
              page={textureAtlas.pages[entry.pageIndex]}
              textureLighting={effectiveTextureLighting}
            />
          );
        }

        const plan = atlasPlans[index];
        if (!plan || plan.texture) return null;
        return isSolidTrianglePlan(plan)
          ? (
              <TextureTrianglePoly
                key={plan.index}
                entry={plan}
                textureLighting={effectiveTextureLighting}
                solidPaintDefaults={solidPaintDefaults}
              />
            )
          : (
              <TextureBorderShapePoly
                key={plan.index}
                entry={plan}
                solidPaintDefaults={solidPaintDefaults}
              />
            );
      });

  // Loading + error slots only apply when we're fetching from `src`.
  if (src) {
    if (fetched.loading && fetched.polygons.length === 0) {
      return (
        <div
          ref={wrapperRef}
          data-poly-mesh-id={id}
          className={`polycss-mesh polycss-mesh-loading${className ? ` ${className}` : ""}`}
          style={wrapperStyle}
          {...wrapperHandlers}
        >
          {fallback ?? null}
        </div>
      );
    }
    if (fetched.error && fetched.polygons.length === 0) {
      return (
        <div
          ref={wrapperRef}
          data-poly-mesh-id={id}
          className={`polycss-mesh polycss-mesh-error${className ? ` ${className}` : ""}`}
          style={wrapperStyle}
          {...wrapperHandlers}
        >
          {errorFallback ? errorFallback(fetched.error) : null}
        </div>
      );
    }
  }

  return (
    <div
      ref={wrapperRef}
      data-poly-mesh-id={id}
      className={`polycss-mesh${className ? ` ${className}` : ""}`}
      style={wrapperStyle}
      {...wrapperHandlers}
    >
      {renderedPolygons}
    </div>
  );
});

// Helper component so the render-prop call sits inside React's tree (vs. an
// inline call in the parent's render) — keeps key handling consistent and
// makes profiler output more readable.
function RenderPropPolygon({
  polygon,
  index,
  children,
}: {
  polygon: Polygon;
  index: number;
  children: (polygon: Polygon, index: number) => ReactNode;
}) {
  return <>{children(polygon, index)}</>;
}
