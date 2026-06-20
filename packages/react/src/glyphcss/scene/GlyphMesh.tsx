/**
 * GlyphMesh — register a polygon list with the parent GlyphScene.
 *
 * Mirrors PolyMesh's prop surface (id, position/scale/rotation transform,
 * castShadow/receiveShadow, children) but for the ASCII paint backend —
 * no atlas, no polygon leaves. Children are static React children mounted
 * inside the host's wrapper div (not rendered per-polygon).
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { resolveGeometry, recenterPolygons, loadMesh } from "@glyphcss/core";
import type { Vec3, Polygon, GlyphGeometryName } from "@glyphcss/core";
import type { GlyphMeshTransform, GlyphPointerEvent, GlyphMouseEvent, GlyphWheelEvent } from "glyphcss";
import { useGlyphSceneContext } from "./context";
import { registerMeshElement, unregisterMeshElement } from "./events";
import type { GlyphMeshHandle } from "./context";

export interface GlyphMeshProps {
  id?: string;
  polygons?: Polygon[];
  /** URL of an OBJ / GLB / glTF / VOX / STL mesh, fetched + parsed via `loadMesh`. */
  src?: string;
  /**
   * Built-in geometry name. Resolved via `resolveGeometry` when neither
   * `polygons` nor `src` is provided.
   *
   * Precedence: explicit `polygons` > `src` > `geometry`.
   */
  geometry?: GlyphGeometryName;
  /** Uniform size passed to `resolveGeometry` when `geometry` is set. Defaults to 1. */
  size?: number;
  /** Fill color passed to `resolveGeometry` when `geometry` is set. */
  color?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  /**
   * Recenter the mesh's bounding-box center to the origin so it pivots around
   * its own center (center only, no scaling — matches voxcss). Default false.
   */
  autoCenter?: boolean;
  /**
   * This mesh casts shadows onto `receiveShadow` surfaces.
   * Default false — opt-in, matching PolyMesh behaviour.
   */
  castShadow?: boolean;
  /**
   * This mesh receives (displays) shadows from `castShadow` meshes.
   * A mesh that is both `castShadow` and `receiveShadow` will self-shadow.
   * Default false — opt-in, matching PolyMesh behaviour.
   */
  receiveShadow?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  // Pointer/mouse interaction — type surface matches voxcss PolyMesh.
  // TODO(hit-layer): wire these to the hit layer raycasting once the
  // rasterizer hit-map is wired to the hit-layer dispatch.
  onPointerDown?: (event: GlyphPointerEvent) => void;
  onPointerUp?: (event: GlyphPointerEvent) => void;
  onPointerMove?: (event: GlyphPointerEvent) => void;
  onPointerEnter?: (event: GlyphPointerEvent) => void;
  onPointerLeave?: (event: GlyphPointerEvent) => void;
  onClick?: (event: GlyphMouseEvent) => void;
  onWheel?: (event: GlyphWheelEvent) => void;
}

function GlyphMeshInner({
  id,
  polygons: polygonsProp,
  src,
  geometry,
  size = 1,
  color,
  position,
  scale,
  rotation,
  autoCenter = false,
  castShadow = false,
  receiveShadow = false,
  className,
  style,
  children,
}: GlyphMeshProps) {
  const { sceneRef } = useGlyphSceneContext();
  const meshRef = useRef<GlyphMeshHandle | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Fetch + parse `src` (race-safe: late responses for a stale src are dropped).
  const [loadedPolygons, setLoadedPolygons] = useState<Polygon[] | null>(null);
  useEffect(() => {
    if (!src) {
      setLoadedPolygons(null);
      return;
    }
    let cancelled = false;
    loadMesh(src)
      .then((result) => { if (!cancelled) setLoadedPolygons(result.polygons); })
      .catch(() => { if (!cancelled) setLoadedPolygons([]); });
    return () => { cancelled = true; };
  }, [src]);

  // Precedence: explicit polygons > src > geometry shortcut
  const polygons = useMemo(() => {
    const base =
      polygonsProp !== undefined
        ? polygonsProp
        : src !== undefined
          ? (loadedPolygons ?? [])
          : geometry !== undefined
            ? resolveGeometry(geometry, { size, color })
            : [];
    return autoCenter ? recenterPolygons(base) : base;
  }, [polygonsProp, src, loadedPolygons, geometry, size, color, autoCenter]);

  const transform = useMemo<GlyphMeshTransform>(() => ({
    id,
    position,
    scale,
    rotation,
    castShadow,
    receiveShadow,
  }), [id, position, scale, rotation, castShadow, receiveShadow]);

  // Register the mesh handle with the parent scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.add(polygons, transform);
    meshRef.current = handle;
    return () => {
      handle.dispose();
      meshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, polygons]);

  // Update transform when id/position/scale/rotation/castShadow/receiveShadow change
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.setTransform(transform);
    sceneRef.current?.rerender();
  }, [sceneRef, transform]);

  // Register wrapper element in the mesh registry for hit-testing
  useEffect(() => {
    const el = wrapperRef.current;
    const handle = meshRef.current;
    if (!el || !handle) return;
    registerMeshElement(el, handle);
    return () => unregisterMeshElement(el);
  });

  const computedClassName = `glyph-mesh${className ? ` ${className}` : ""}`;

  return (
    <div
      ref={wrapperRef}
      data-glyph-mesh-id={id}
      className={computedClassName}
      style={style}
    >
      {children}
    </div>
  );
}

export const GlyphMesh = memo(GlyphMeshInner);
