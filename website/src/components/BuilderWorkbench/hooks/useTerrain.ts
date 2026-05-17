/**
 * Terrain editor state + viewport pointer capture.
 *
 * When `toolMode` is anything other than "pointer", the user is editing
 * the heightmap rather than placing meshes. We capture pointermove (to
 * update the hover ghost) and click (to apply the active tool) on the
 * viewport in CAPTURE phase, mirroring `usePlacementMode` so orbit
 * drag / mesh selection don't double-fire.
 *
 * Heightmap is VERTEX-based: clicks snap to the nearest grid vertex
 * and raise / lower / smooth that vertex. The 4 cells touching the
 * raised vertex automatically deform (one corner pulled up) so the
 * surrounding terrain reads as a smooth warp instead of a stamped
 * box. See `geometry/terrain.ts` for the rendering model.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Polygon } from "@layoutit/polycss-react";
import type { SceneOptionsState } from "../../types";
import type { TargetMode, ToolMode } from "../types";
import { projectScreenToWorldGround } from "../geometry/screenToWorld";
import {
  buildHoverGhostPolygons,
  vertexKey,
  worldToCell,
  worldToVertex,
  type HoverTarget,
  type TerrainVertices,
} from "../geometry/terrain";

/** World units added / removed per click for Raise / Lower. */
const BRUSH_STRENGTH = 1;
/** Strength of the Smooth tool — fraction of the way toward the
 *  neighbour average per click. */
const SMOOTH_STRENGTH = 0.5;

export interface UseTerrainOptions {
  toolMode: ToolMode;
  targetMode: TargetMode;
  sceneOptions: SceneOptionsState;
}

export interface UseTerrainResult {
  /** All vertices with non-zero elevation. Consumed by useSceneRender
   *  (to build the warped grid) and usePlacementMode (to land meshes
   *  on top of the terrain with the local slope tilt). */
  vertices: TerrainVertices;
  /** Polygons for the hover vertex marker (empty when not editing). */
  hoverPolygons: Polygon[];
}

export function useTerrain({ toolMode, targetMode, sceneOptions }: UseTerrainOptions): UseTerrainResult {
  const [vertices, setVertices] = useState<TerrainVertices>(() => new Map());
  // Single hover target descriptor that captures vertex OR face — the
  // hover-ghost builder picks the right rendering off this discriminator.
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);

  // Pointerdown coords for drag-vs-click discrimination. Kept in a ref
  // so they survive useEffect re-runs (sceneOptions changes between
  // pointerdown and click would otherwise reset them and every click
  // would look like a long drag).
  const downRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const cellSize = sceneOptions.gridResolution;

  // Apply the active tool to a target — either a single vertex (vertex
  // mode) or all 4 corners of a face (face mode). Tiny residuals are
  // dropped so vertices returning to flat leave the sparse map.
  const applyTool = useCallback(
    (target: HoverTarget): void => {
      setVertices((prev) => {
        const next = new Map(prev);

        // List of vertex indices this tool action will touch:
        // vertex target → just the clicked vertex; face target →
        // the 4 corners of the clicked cell.
        const targets: Array<[number, number]> =
          target.kind === "vertex"
            ? [[target.i, target.j]]
            : [
                [target.i,     target.j],
                [target.i + 1, target.j],
                [target.i + 1, target.j + 1],
                [target.i,     target.j + 1],
              ];

        for (const [i, j] of targets) {
          const key = vertexKey(i, j);
          const current = next.get(key) ?? 0;

          if (toolMode === "raise") {
            next.set(key, current + BRUSH_STRENGTH);
          } else if (toolMode === "lower") {
            next.set(key, current - BRUSH_STRENGTH);
          } else if (toolMode === "smooth") {
            // Average with the 8 neighbour vertices (default 0).
            let sum = 0;
            let count = 0;
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                if (di === 0 && dj === 0) continue;
                sum += next.get(vertexKey(i + di, j + dj)) ?? 0;
                count++;
              }
            }
            const avg = count > 0 ? sum / count : 0;
            const blended = current + (avg - current) * SMOOTH_STRENGTH;
            if (Math.abs(blended) < 1e-3) next.delete(key);
            else next.set(key, blended);
          }

          const updated = next.get(key);
          if (updated !== undefined && Math.abs(updated) < 1e-6) next.delete(key);
        }
        return next;
      });
    },
    [toolMode],
  );

  // Viewport pointer capture — only engaged when a terrain tool is
  // active. Capture phase + stopPropagation keeps the click out of
  // orbit drag / mesh selection.
  useEffect(() => {
    if (toolMode === "pointer") {
      setHoverTarget(null);
      return;
    }
    const viewport = document.querySelector(".dn-viewport") as HTMLElement | null;
    const cameraEl = document.querySelector(".polycss-camera") as HTMLElement | null;
    if (!viewport || !cameraEl) return;

    const projectAt = (clientX: number, clientY: number): [number, number] | null =>
      projectScreenToWorldGround({
        clientX,
        clientY,
        cameraEl,
        sceneOptions,
        autoCenterOffset: [0, 0, 0],
      });

    // We're in CAPTURE phase on the viewport, so events on every descendant
    // route through here first — including the floating tool palette and
    // camera-mode pill that live inside the viewport. Skip those so the
    // button's own click handler still fires; otherwise the user can't
    // change modes while a terrain tool is active.
    const isUiOverlay = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || !el.closest) return false;
      return Boolean(el.closest(".builder-tool-palette, .builder-target-mode, .builder-camera-mode"));
    };

    // Click-vs-drag discrimination: the user might pointer-drag to orbit
    // the camera, and we don't want every drag to also raise the floor.
    // 8 px tolerance — covers trackpad jitter while still catching real
    // drags. The downRef is hoisted above the effect so its value
    // survives effect re-runs caused by sceneOptions updates that fire
    // between pointerdown and click.
    const CLICK_THRESHOLD_PX = 8;

    const onDown = (e: PointerEvent) => {
      if (isUiOverlay(e.target)) return;
      downRef.current = { x: e.clientX, y: e.clientY };
    };

    const worldToTarget = (world: [number, number]): HoverTarget => {
      if (targetMode === "face") {
        const [i, j] = worldToCell(world[0], world[1], cellSize);
        return { kind: "face", i, j };
      }
      const [i, j] = worldToVertex(world[0], world[1], cellSize);
      return { kind: "vertex", i, j };
    };

    const onMove = (e: PointerEvent) => {
      if (isUiOverlay(e.target)) return;
      const world = projectAt(e.clientX, e.clientY);
      if (!world) return;
      const next = worldToTarget(world);
      setHoverTarget((prev) =>
        prev && prev.kind === next.kind && prev.i === next.i && prev.j === next.j ? prev : next,
      );
    };
    const onClick = (e: MouseEvent) => {
      if (isUiOverlay(e.target)) return;
      const dx = e.clientX - downRef.current.x;
      const dy = e.clientY - downRef.current.y;
      if (dx * dx + dy * dy > CLICK_THRESHOLD_PX * CLICK_THRESHOLD_PX) {
        return;
      }
      const world = projectAt(e.clientX, e.clientY);
      if (!world) return;
      e.preventDefault();
      e.stopPropagation();
      applyTool(worldToTarget(world));
    };
    const onLeave = () => setHoverTarget(null);

    viewport.addEventListener("pointerdown", onDown, true);
    viewport.addEventListener("pointermove", onMove, true);
    viewport.addEventListener("pointerleave", onLeave, true);
    viewport.addEventListener("click", onClick, true);
    return () => {
      viewport.removeEventListener("pointerdown", onDown, true);
      viewport.removeEventListener("pointermove", onMove, true);
      viewport.removeEventListener("pointerleave", onLeave, true);
      viewport.removeEventListener("click", onClick, true);
    };
  }, [toolMode, targetMode, sceneOptions, cellSize, applyTool]);

  const hoverPolygons = useMemo(() => {
    if (toolMode === "pointer" || !hoverTarget) return [];
    return buildHoverGhostPolygons({ target: hoverTarget, cellSize, vertices });
  }, [toolMode, hoverTarget, vertices, cellSize]);

  return { vertices, hoverPolygons };
}
