/**
 * GlyphcssDirectionalLightHelper — ASCII-mode directional light helper.
 *
 * Shows a small octahedron at the light source position in the ASCII output.
 * Shows the light origin as an ASCII octahedron glyph in the output.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { GlyphcssMeshHandle, GlyphcssTriangle } from "glyphcss";
import type { Vec3 } from "@glyphcss/core";
import { useGlyphcssSceneContext } from "../scene/context";

export interface GlyphcssDirectionalLightHelperProps {
  /** Light source position in world space. Default [1, 1, 1]. */
  position?: Vec3;
  /** Glyph color. Default "#ffff00". */
  color?: string;
  /** Marker size in world units. Default 0.1. */
  size?: number;
}

function lightMarkerTriangles(position: Vec3, color: string, size: number): GlyphcssTriangle[] {
  const [px, py, pz] = position;
  const s = size;
  const top: Vec3 = [px, py, pz + s];
  const bot: Vec3 = [px, py, pz - s];
  const right: Vec3 = [px + s, py, pz];
  const left: Vec3 = [px - s, py, pz];
  const front: Vec3 = [px, py + s, pz];
  const back: Vec3 = [px, py - s, pz];
  return [
    { vertices: [top, right, front], color },
    { vertices: [top, front, left], color },
    { vertices: [top, left, back], color },
    { vertices: [top, back, right], color },
    { vertices: [bot, front, right], color },
    { vertices: [bot, left, front], color },
    { vertices: [bot, back, left], color },
    { vertices: [bot, right, back], color },
  ];
}

function GlyphcssDirectionalLightHelperInner({
  position = [1, 1, 1],
  color = "#ffff00",
  size = 0.1,
}: GlyphcssDirectionalLightHelperProps) {
  const { sceneRef } = useGlyphcssSceneContext();
  const meshRef = useRef<GlyphcssMeshHandle | null>(null);
  const triangles = useMemo(
    () => lightMarkerTriangles(position, color, size),
    [position, color, size],
  );

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

export const GlyphcssDirectionalLightHelper = memo(GlyphcssDirectionalLightHelperInner);
