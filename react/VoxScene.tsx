import React, { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { inferGridDimensions, wallMasksEqual } from "@voxcss/core";
import type { VoxelGrid, WallsMask, ProjectionMode } from "@voxcss/core";
import { useSceneControllerContext } from "./context";

const DEFAULT_VOXELS: VoxelGrid = [];

export interface VoxSceneProps {
  voxels?: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
  dimetric?: boolean;
}

export function VoxScene({
  voxels = DEFAULT_VOXELS,
  rows,
  cols,
  depth,
  showWalls = false,
  showFloor = false,
  projection,
  dimetric = false
}: VoxSceneProps) {
  const controller = useSceneControllerContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<SceneHost | null>(null);
  const wallsRef = useRef<WallsMask>(controller.getWalls());
  const prevVoxelsRef = useRef<VoxelGrid | null>(null);
  const [boxStyle, setBoxStyle] = useState<Record<string, string>>(() => controller.getBoxStyle());

  useEffect(() => controller.subscribeBoxStyle((style) => setBoxStyle(style)), [controller]);

  const buildContext = useCallback(() => {
    const inferred = inferGridDimensions(voxels);
    const depthValue = typeof depth === "number" ? depth : inferred.depth;
    const rowValue = typeof rows === "number" ? rows : inferred.rows;
    const colValue = typeof cols === "number" ? cols : inferred.cols;
    const projectionMode: ProjectionMode | undefined = dimetric ? "dimetric" : projection;
    controller.setProjection?.(projectionMode);
    return {
      rows: rowValue,
      cols: colValue,
      depth: depthValue,
      showWalls,
      showFloor,
      projection: projectionMode,
      walls: wallsRef.current,
      resolveTexture(name: string, face: string) {
        if (!name || name.startsWith("#")) return undefined;
        if (
          name.startsWith("/") ||
          name.startsWith("./") ||
          name.startsWith("../") ||
          name.startsWith("http://") ||
          name.startsWith("https://") ||
          name.includes(".")
        ) {
          return name;
        }
        return `textures/${name}/${name}-${face}.svg`;
      }
    };
  }, [rows, cols, depth, voxels, showWalls, showFloor, projection, dimetric, controller]);

  useEffect(() => {
    const host = createSceneHost();
    hostRef.current = host;
    const node = containerRef.current;
    if (node) {
      host.mount(node, voxels, buildContext());
    }
    return () => host.destroy();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsubscribe = controller.subscribeCamera(() => {
      const nextWalls = controller.getWalls();
      if (wallMasksEqual(wallsRef.current, nextWalls)) {
        return;
      }
      wallsRef.current = nextWalls;
      const host = hostRef.current;
      if (!host) return;
      host.updateContext(buildContext());
    });
    return unsubscribe;
  }, [controller, voxels, buildContext]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const context = buildContext();
    if (prevVoxelsRef.current !== voxels) {
      prevVoxelsRef.current = voxels;
      host.update(voxels, context);
    } else {
      host.updateContext(context);
    }
  }, [voxels, rows, cols, showWalls, showFloor, depth, projection, dimetric, buildContext]);

  useEffect(() => {
    const inferred = inferGridDimensions(voxels);
    const depthValue = typeof depth === "number" ? depth : inferred.depth;
    const rowValue = typeof rows === "number" ? rows : inferred.rows;
    const colValue = typeof cols === "number" ? cols : inferred.cols;
    controller.setDimensions({ rows: rowValue, cols: colValue, depth: depthValue });
  }, [controller, rows, cols, depth, voxels]);

  return <div ref={containerRef} style={boxStyle as CSSProperties} />;
}
