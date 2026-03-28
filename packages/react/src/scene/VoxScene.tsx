import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import type { ProjectionMode, VoxelGrid } from "@layoutit/voxcss-core";
import { DEFAULT_WALL_COLOR } from "@layoutit/voxcss-core";
import { createIsometricCamera } from "@layoutit/voxcss-core";
import type { MergeVoxelsOption } from "@layoutit/voxcss-core";
import { useCameraContext } from "../camera/context";
import { useStoreSelector } from "../store/sceneStore";
import { useSceneContext } from "./useSceneContext";
import { injectBaseStyles } from "../styles/styles";
import { Floor } from "./Floor";
import { Ceiling } from "./Ceiling";
import { Walls } from "./Walls";

const DIMETRIC_CLASS = "voxcss-projection--dimetric";
const GRID_DISABLE_THRESHOLD = 20;

const gridSvgCache = new Map<string, string>();

export function buildGridSvgDataUrl(width: number, height: number, alpha: number): string {
  const key = `${width}x${height}:${alpha}`;
  const cached = gridSvgCache.get(key);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect x="0" y="0" width="1" height="${height}" fill="rgb(0, 0, 0)" fill-opacity="${alpha}"/><rect x="0" y="0" width="${width}" height="1" fill="rgb(0, 0, 0)" fill-opacity="${alpha}"/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  gridSvgCache.set(key, url);
  return url;
}

export interface VoxSceneProps {
  voxels: VoxelGrid;
  rows?: number;
  cols?: number;
  depth?: number;
  showFloor?: boolean;
  showWalls?: boolean;
  projection?: ProjectionMode;
  mergeVoxels?: MergeVoxelsOption;
  wallColor?: string;
}

function VoxSceneInner({
  voxels,
  rows,
  cols,
  depth,
  showFloor = false,
  showWalls = false,
  projection = "cubic",
  mergeVoxels: mergeOption,
  wallColor = DEFAULT_WALL_COLOR,
}: VoxSceneProps) {
  const { store, cameraRef, sceneElRef } = useCameraContext();

  // Read camera state once for initial render — transform updates go via direct DOM
  const initialCameraState = useRef(store.getState().cameraState);
  const cameraState = initialCameraState.current;

  // Subscribe to wall mask — re-renders only when mask changes (a few times per rotation)
  const wallMaskRaw = useStoreSelector(store, (s) => s.wallMask);
  // Defer the wall mask update so it doesn't block the animation frame
  const wallMask = useDeferredValue(wallMaskRaw);

  const localSceneRef = useCallback((el: HTMLDivElement | null) => {
    sceneElRef.current = el;
  }, [sceneElRef]);

  // Inject base styles once
  const injectedRef = useRef(false);
  useEffect(() => {
    if (injectedRef.current) return;
    if (typeof document !== "undefined") {
      injectBaseStyles(document);
      injectedRef.current = true;
    }
  }, []);

  // Scene context uses the actual wall mask — only visible faces are rendered.
  // When mask changes (a few times per rotation), React re-renders the scene.
  const { context, dimensions, layers } = useSceneContext(voxels, {
    rows,
    cols,
    depth,
    projection,
    showFloor,
    showWalls,
    wallColor,
    wallMask,
    mergeVoxels: mergeOption,
  });

  // Compute camera style for scene positioning
  const sceneStyle = useMemo(() => {
    const handle = createIsometricCamera(cameraState);
    return handle.getStyle({
      rows: dimensions.rows,
      cols: dimensions.cols,
      depth: dimensions.depth,
      dimetric: projection === "dimetric",
    });
  }, [cameraState, dimensions, projection]);

  const className = `voxcss-scene${projection === "dimetric" ? ` ${DIMETRIC_CLASS}` : ""}`;

  const tileSize = context.tileSize;
  const layerElevation = context.layerElevation ?? tileSize;
  const disableGrid = dimensions.rows > GRID_DISABLE_THRESHOLD && dimensions.cols > GRID_DISABLE_THRESHOLD;

  const is3d = mergeOption === "3d";

  return (
    <div
      ref={localSceneRef}
      className={className}
      data-vox-depth-offset={String(
        dimensions.depth * cameraState.depthOffset * (projection === "dimetric" ? 0.5 : 1)
      )}
      style={
        {
          ...sceneStyle,
          "--voxcss-rows": dimensions.rows,
          "--voxcss-cols": dimensions.cols,
        } as React.CSSProperties
      }
    >
      <Floor
        layers={layers}
        context={context}
        dimensions={dimensions}
        showFloor={showFloor}
        wallMask={wallMask}
        wallColor={wallColor}
        tileSize={tileSize}
        layerElevation={layerElevation}
        disableGrid={disableGrid}
        is3d={is3d}
        store={store}
      />
      {showFloor && wallMask.t && (
        <Ceiling
          wallColor={wallColor}
          dimensions={dimensions}
          tileSize={context.tileSize}
        />
      )}
      {showWalls && (
        <Walls
          walls={context.walls}
          wallColor={wallColor}
          dimensions={dimensions}
          tileSize={tileSize}
          disableGrid={disableGrid}
          wallElevation={layerElevation}
        />
      )}
    </div>
  );
}

export const VoxScene = memo(VoxSceneInner);
