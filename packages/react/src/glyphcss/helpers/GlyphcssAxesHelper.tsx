/**
 * GlyphcssAxesHelper — ASCII-mode axes helper.
 *
 * In ASCII rendering there are no polygon mesh overlays, so this helper
 * registers axis-indicator triangles with the scene so they appear in the
 * rasterized output. Mirrors PolyAxesHelper's prop surface.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { GlyphcssMeshHandle, GlyphcssTriangle } from "glyphcss";
import type { Vec3 } from "@layoutit/polycss-core";
import { useGlyphcssSceneContext } from "../scene/context";

export interface GlyphcssAxesHelperProps {
  /** Length of each axis bar in world units. Default 1. */
  size?: number;
}

function axisTriangles(size: number): GlyphcssTriangle[] {
  const s = size;
  const t = s * 0.05;
  const triangles: GlyphcssTriangle[] = [];

  function addBar(a: Vec3, b: Vec3, color: string): void {
    const v0: Vec3 = [a[0] - t, a[1] - t, a[2]];
    const v1: Vec3 = [b[0] - t, b[1] - t, b[2]];
    const v2: Vec3 = [b[0] + t, b[1] + t, b[2]];
    const v3: Vec3 = [a[0] + t, a[1] + t, a[2]];
    triangles.push({ vertices: [v0, v1, v2], color });
    triangles.push({ vertices: [v0, v2, v3], color });
  }

  addBar([0, 0, 0], [s, 0, 0], "#ff0000"); // X axis: red
  addBar([0, 0, 0], [0, s, 0], "#00ff00"); // Y axis: green
  addBar([0, 0, 0], [0, 0, s], "#0000ff"); // Z axis: blue

  return triangles;
}

function GlyphcssAxesHelperInner({ size = 1 }: GlyphcssAxesHelperProps) {
  const { sceneRef } = useGlyphcssSceneContext();
  const meshRef = useRef<GlyphcssMeshHandle | null>(null);
  const triangles = useMemo(() => axisTriangles(size), [size]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.add(triangles);
    meshRef.current = handle;
    return () => {
      handle.dispose();
      meshRef.current = null;
    };
  }, [sceneRef, triangles]);

  return null;
}

export const GlyphcssAxesHelper = memo(GlyphcssAxesHelperInner);
