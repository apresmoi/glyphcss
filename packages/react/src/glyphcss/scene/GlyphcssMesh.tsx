/**
 * GlyphcssMesh — register a polygon list with the parent GlyphcssScene.
 *
 * Mirrors PolyMesh's prop surface (id, position/scale/rotation transform,
 * children) but for the ASCII paint backend — no atlas, no polygon leaves.
 * Children are static React children mounted inside the host's wrapper div
 * (not rendered per-polygon).
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { resolveGeometry } from "@glyphcss/core";
import type { Vec3, Polygon, GlyphcssGeometryName } from "@glyphcss/core";
import type { GlyphcssMeshTransform, GlyphcssPointerEvent, GlyphcssMouseEvent, GlyphcssWheelEvent } from "glyphcss";
import { useGlyphcssSceneContext } from "./context";
import { registerMeshElement, unregisterMeshElement } from "./events";
import type { GlyphcssMeshHandle } from "./context";

export interface GlyphcssMeshProps {
  id?: string;
  polygons?: Polygon[];
  /**
   * Built-in geometry name. Resolved via `resolveGeometry` when neither
   * `polygons` nor `src` is provided.
   *
   * Precedence: explicit `polygons` > `src` > `geometry`.
   */
  geometry?: GlyphcssGeometryName;
  /** Uniform size passed to `resolveGeometry` when `geometry` is set. Defaults to 1. */
  size?: number;
  /** Fill color passed to `resolveGeometry` when `geometry` is set. */
  color?: string;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  // Pointer/mouse interaction — type surface matches voxcss PolyMesh.
  // TODO(hit-layer): wire these to the hit layer raycasting once the
  // rasterizer hit-map is wired to the hit-layer dispatch.
  onPointerDown?: (event: GlyphcssPointerEvent) => void;
  onPointerUp?: (event: GlyphcssPointerEvent) => void;
  onPointerMove?: (event: GlyphcssPointerEvent) => void;
  onPointerEnter?: (event: GlyphcssPointerEvent) => void;
  onPointerLeave?: (event: GlyphcssPointerEvent) => void;
  onClick?: (event: GlyphcssMouseEvent) => void;
  onWheel?: (event: GlyphcssWheelEvent) => void;
}

function GlyphcssMeshInner({
  id,
  polygons: polygonsProp,
  geometry,
  size = 1,
  color,
  position,
  scale,
  rotation,
  className,
  style,
  children,
}: GlyphcssMeshProps) {
  const { sceneRef } = useGlyphcssSceneContext();
  const meshRef = useRef<GlyphcssMeshHandle | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Precedence: explicit polygons > geometry shortcut
  const polygons = useMemo(() => {
    if (polygonsProp !== undefined) return polygonsProp;
    if (geometry !== undefined) return resolveGeometry(geometry, { size, color });
    return [];
  }, [polygonsProp, geometry, size, color]);

  const transform = useMemo<GlyphcssMeshTransform>(() => ({
    id,
    position,
    scale,
    rotation,
  }), [id, position, scale, rotation]);

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

  // Update transform when id/position/scale/rotation change
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

  const computedClassName = `glyphcss-mesh${className ? ` ${className}` : ""}`;

  return (
    <div
      ref={wrapperRef}
      data-glyphcss-mesh-id={id}
      className={computedClassName}
      style={style}
    >
      {children}
    </div>
  );
}

export const GlyphcssMesh = memo(GlyphcssMeshInner);
