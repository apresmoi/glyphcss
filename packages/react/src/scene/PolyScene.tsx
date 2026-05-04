import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  ProjectionMode,
  Polygon,
  DirectionalLight,
  AutoRotateOption,
  Vec3,
} from "@polycss/core";
import { createIsometricCamera } from "@polycss/core";
import { useCameraContext } from "../camera/context";
import { useSceneContext } from "./useSceneContext";
import { injectBaseStyles } from "../styles/styles";
import { Poly } from "../shapes";
import type { TransformProps } from "../shapes/types";

const DIMETRIC_CLASS = "polycss-projection--dimetric";

export interface PolySceneProps extends TransformProps {
  /** Polygons to render. Composes additively with `children`. */
  polygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  projection?: ProjectionMode;
  directionalLight?: DirectionalLight;
  /** Mesh post-processing — `"auto"` runs `mergePolygons`, `"off"` passes through. */
  merge?: "off" | "auto";
  autoRotate?: AutoRotateOption;
  interactive?: boolean;
  invert?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;

  // Debug toggles. Cube-only `debugShowOccluded` was removed in Phase 4.
  debugShowLabels?: boolean;
  debugShowBackfaces?: boolean;
}

function sceneSize(bbox: { min: Vec3; max: Vec3 }): Vec3 {
  return [
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ];
}

function PolySceneInner({
  polygons: polygonsProp,
  perspective: _perspective,
  rotX: _rotX,
  rotY: _rotY,
  zoom: _zoom,
  projection = "cubic",
  directionalLight,
  merge = "off",
  autoRotate: _autoRotate,
  interactive: _interactive,
  invert: _invert,
  className,
  style,
  children,
  position: _position,
  scale: _scale,
  rotation: _rotation,
  debugShowLabels: _debugShowLabels,
  debugShowBackfaces,
}: PolySceneProps) {
  const { store, sceneElRef } = useCameraContext();

  // Read camera state once for initial render — transform updates go via direct DOM
  const initialCameraState = useRef(store.getState().cameraState);
  const cameraState = initialCameraState.current;

  const localSceneRef = useCallback(
    (el: HTMLDivElement | null) => {
      sceneElRef.current = el;
    },
    [sceneElRef]
  );

  // Toggle the back-faces debug class on the scene element. CSS uses this
  // root-level class to flip backface-visibility on poly elements so users
  // can see backfaces during debugging.
  useEffect(() => {
    const el = sceneElRef.current;
    if (!el) return;
    el.classList.toggle("polycss-debug-show-backfaces", !!debugShowBackfaces);
  }, [debugShowBackfaces, sceneElRef]);

  // Inject base styles once
  const injectedRef = useRef(false);
  useEffect(() => {
    if (injectedRef.current) return;
    if (typeof document !== "undefined") {
      injectBaseStyles(document);
      injectedRef.current = true;
    }
  }, []);

  // Resolve polygons input. Empty array if none provided so useSceneContext
  // still computes a sane (empty) sceneBbox.
  const inputPolygons = useMemo(() => polygonsProp ?? [], [polygonsProp]);

  // Run mesh post-processing pipeline (normalize + optional merge) and
  // compute the scene bbox.
  const { polygons, sceneBbox } = useSceneContext(inputPolygons, {
    projection,
    merge,
    directionalLight,
  });

  // Compute camera style for scene positioning. Sized by the scene bbox so
  // the camera framing math has something concrete to work with even for
  // arbitrary-coordinate polygon meshes.
  const sceneStyle = useMemo(() => {
    const handle = createIsometricCamera(cameraState);
    const sizeX = sceneBbox.max[0] - sceneBbox.min[0];
    const sizeY = sceneBbox.max[1] - sceneBbox.min[1];
    const sizeZ = sceneBbox.max[2] - sceneBbox.min[2];
    return handle.getStyle({
      // Map mesh bbox span into the camera's row/col/depth framing inputs.
      // The camera is generic (per §Design.9); these names are historical.
      rows: Math.max(1, Math.ceil(sizeX)),
      cols: Math.max(1, Math.ceil(sizeY)),
      depth: Math.max(1, Math.ceil(sizeZ)),
      dimetric: projection === "dimetric",
    });
  }, [cameraState, sceneBbox, projection]);

  const computedClassName = `polycss-scene${
    projection === "dimetric" ? ` ${DIMETRIC_CLASS}` : ""
  }${className ? ` ${className}` : ""}`;

  // Per-polygon context: just lighting + debug flags. tileSize/elevation
  // default inside <Poly> since polygon vertices are already in world units.
  const polyContext = useMemo(
    () => ({
      directionalLight,
      debugShowBackfaces,
    }),
    [directionalLight, debugShowBackfaces]
  );

  const depthOffset =
    sceneSize(sceneBbox)[2] *
    cameraState.depthOffset *
    (projection === "dimetric" ? 0.5 : 1);

  return (
    <div
      ref={localSceneRef}
      className={computedClassName}
      data-polycss-depth-offset={String(depthOffset)}
      style={
        {
          ...sceneStyle,
          ...style,
          // No more --polycss-rows / --polycss-cols — CSS Grid was dropped
          // in Phase 4 (per §Design.4a).
        } as CSSProperties
      }
    >
      {polygons.map((p, i) => (
        <Poly
          key={i}
          vertices={p.vertices}
          color={p.color}
          texture={p.texture}
          uvs={p.uvs}
          data={p.data}
          context={polyContext}
        />
      ))}
      {children}
    </div>
  );
}

export const PolyScene = memo(PolySceneInner);
