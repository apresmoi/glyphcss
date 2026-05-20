/**
 * GlyphDirectionalLightHelper — ASCII-mode directional light helper.
 *
 * Shows a small octahedron at the light source position in the ASCII output.
 * Shows the light origin as an ASCII octahedron glyph in the output.
 */
import { memo, useEffect, useMemo, useRef } from "react";
import type { GlyphMeshHandle } from "glyphcss";
import type { Vec3, Polygon } from "@glyphcss/core";
import { useGlyphSceneContext } from "../scene/context";

export interface GlyphDirectionalLightHelperProps {
  /** Light source position in world space. Default [1, 1, 1]. */
  position?: Vec3;
  /** Glyph color. Default "#ffff00". */
  color?: string;
  /** Marker size in world units. Default 0.1. */
  size?: number;
}

function lightMarkerPolygons(position: Vec3, color: string, size: number): Polygon[] {
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

function GlyphDirectionalLightHelperInner({
  position = [1, 1, 1],
  color = "#ffff00",
  size = 0.1,
}: GlyphDirectionalLightHelperProps) {
  const { sceneRef } = useGlyphSceneContext();
  const meshRef = useRef<GlyphMeshHandle | null>(null);
  const polygons = useMemo(
    () => lightMarkerPolygons(position, color, size),
    [position, color, size],
  );

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const handle = scene.add(polygons);
    meshRef.current = handle;
    return () => {
      handle.dispose();
      meshRef.current = null;
    };
  }, [sceneRef, polygons]);

  return null;
}

export const GlyphDirectionalLightHelper = memo(GlyphDirectionalLightHelperInner);
