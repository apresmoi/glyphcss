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
import type { Vec3, Polygon } from "@glyphcss/core";
import type { GlyphcssMeshTransform } from "glyphcss";
import { useGlyphcssSceneContext } from "./context";
import { registerMeshElement, unregisterMeshElement } from "./events";
import type { GlyphcssMeshHandle } from "./context";

export interface GlyphcssMeshProps {
  id?: string;
  polygons?: Polygon[];
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphcssMeshInner({
  id,
  polygons: polygonsProp,
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

  const polygons = useMemo(() => polygonsProp ?? [], [polygonsProp]);

  const transform = useMemo<GlyphcssMeshTransform>(() => ({
    position,
    scale,
    rotation,
  }), [position, scale, rotation]);

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

  // Update transform when position/scale/rotation change
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
