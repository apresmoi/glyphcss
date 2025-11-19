import { useEffect, useRef, useState, type RefObject } from "react";
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { buildSceneContext } from "@voxcss/core";
import type { SceneHost } from "@voxcss/controller/createSceneHost";
import type { ProjectionMode, VoxelGrid, SceneDimensions } from "@voxcss/core";

interface SceneHostParams {
  containerRef: RefObject<HTMLDivElement>;
  controller: SceneController;
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showWalls?: boolean;
  showFloor?: boolean;
  projection?: ProjectionMode;
  dimetric?: boolean;
}

export function useSceneHost(params: SceneHostParams): Record<string, string> {
  const {
    containerRef,
    controller,
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection,
    dimetric
  } = params;
  const hostRef = useRef<SceneHost | null>(null);
  const prevVoxelsRef = useRef<VoxelGrid | null>(null);
  const latestVoxelsRef = useRef(voxels);
  latestVoxelsRef.current = voxels;
  const [boxStyle, setBoxStyle] = useState<Record<string, string>>(() => controller.getBoxStyle());

  useEffect(() => {
    const unsubscribe = controller.subscribeBoxStyle((style) => setBoxStyle(style));
    return () => unsubscribe();
  }, [controller]);

  const applyDimensions = (next: Required<SceneDimensions>) => {
    const current = controller.getDimensions();
    if (
      next.rows !== current.rows ||
      next.cols !== current.cols ||
      next.depth !== current.depth
    ) {
      controller.setDimensions(next);
    }
  };

  const buildAnalysis = () => {
    const projectionMode: ProjectionMode | undefined = dimetric ? "dimetric" : projection;
    controller.setProjection?.(projectionMode);
    return buildSceneContext({
      grid: voxels,
      context: {
        rows,
        cols,
        depth,
        showWalls,
        showFloor,
        projection: projectionMode,
        walls: controller.getWalls()
      }
    });
  };

  const buildContextRef = useRef(() => buildAnalysis().snapshot);
  buildContextRef.current = () => buildAnalysis().snapshot;

  useEffect(() => {
    const host = createSceneHost();
    hostRef.current = host;
    const node = containerRef.current;
    const contextBuilder = buildContextRef.current;
    const initialVoxels = latestVoxelsRef.current;
    if (node) {
      host.mount(node, initialVoxels, contextBuilder());
    }
    prevVoxelsRef.current = initialVoxels;
    host.syncController(controller, () => buildContextRef.current());
    return () => {
      host.destroy();
      hostRef.current = null;
    };
  }, [controller, containerRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const analysis = buildAnalysis();
    const context = analysis.snapshot;
    if (prevVoxelsRef.current !== voxels) {
      prevVoxelsRef.current = voxels;
      host.setState({ voxels, context });
    } else {
      host.setState({ context });
    }
    host.flush();
    applyDimensions(analysis.dimensions);
  }, [controller, voxels, rows, cols, depth, showWalls, showFloor, projection, dimetric]);

  return boxStyle;
}
