/**
 * GlyphcssMesh — register a triangle list with the parent GlyphcssScene.
 *
 * Mirrors PolyMesh's prop surface (id, position/scale/rotation transform,
 * children) but for the ASCII paint backend — no atlas, no polygon leaves.
 * Children are static React children mounted inside the host's wrapper div
 * (not rendered per-triangle).
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Vec3 } from "@layoutit/polycss-core";
import type { GlyphcssTriangle, GlyphcssMeshTransform } from "glyphcss";
import { useGlyphcssSceneContext } from "./context";
import { registerMeshElement, unregisterMeshElement } from "./events";
import type { GlyphcssMeshHandle } from "./context";

export interface GlyphcssMeshProps {
  id?: string;
  triangles?: GlyphcssTriangle[];
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function GlyphcssMeshInner({
  id,
  triangles: trianglesProp,
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

  const triangles = useMemo(() => trianglesProp ?? [], [trianglesProp]);

  const transform = useMemo<GlyphcssMeshTransform>(() => ({
    position,
    scale,
    rotation,
  }), [position, scale, rotation]);

  // Register the mesh handle with the parent scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.add(triangles, transform);
    meshRef.current = handle;
    return () => {
      handle.dispose();
      meshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, triangles]);

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
