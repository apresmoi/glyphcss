import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  Polygon,
  DirectionalLight,
  AmbientLight,
  AutoRotateOption,
  TextureLightingMode,
} from "@polycss/core";
import { createIsometricCamera, parseHexColor } from "@polycss/core";
import { useCameraContext } from "../camera/context";
import { useSceneContext } from "./useSceneContext";
import { injectBaseStyles } from "../styles/styles";
import type { TransformProps } from "../shapes/types";
import {
  computeTextureAtlasPlan,
  type AtlasScale,
  TextureAtlasPoly,
  useTextureAtlas,
} from "./textureAtlas";
import { PolySceneContext } from "./sceneContext";

export interface PolySceneProps extends TransformProps {
  /** Polygons to render. Composes additively with `children`. */
  polygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: DirectionalLight;
  ambientLight?: AmbientLight;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: TextureLightingMode;
  /** Raster scale for generated atlas pages. `"auto"` reduces large atlases. */
  atlasScale?: AtlasScale;
  /** Mesh post-processing — `"auto"` runs `mergePolygons`, `"off"` passes through. */
  merge?: "off" | "auto";
  /**
   * When `true`, rotation pivots around the mesh's bbox center instead of
   * world (0,0,0). Polygon data is not mutated — the scene element's
   * `transform-origin` is moved to the bbox center in CSS. Equivalent to
   * setting Three.js's `OrbitControls.target` to the mesh centroid. Off
   * by default to match Three.js: meshes load at their authored origin
   * unless the user opts in. Use this for loaded OBJ/GLB assets whose
   * origin is at a corner / feet / arbitrary point.
   */
  autoCenter?: boolean;
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

function PolySceneInner({
  polygons: polygonsProp,
  perspective: _perspective,
  rotX: _rotX,
  rotY: _rotY,
  zoom: _zoom,
  directionalLight,
  ambientLight,
  textureLighting = "baked",
  atlasScale,
  merge = "off",
  autoCenter = false,
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

  // Retain the debug class for external tooling. The atlas renderer no longer
  // emits separate backface elements.
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

  // Run mesh post-processing pipeline (normalize + optional merge).
  const { polygons, sceneBbox } = useSceneContext(inputPolygons, {
    merge,
    directionalLight,
  });

  // Scene element is a 0×0 anchor at world (0,0,0). Pinning to top:50%/
  // left:50% places that point at the visible center of .polycss-camera
  // — flex centering is unreliable for position:absolute children with no
  // flow box. transform-origin defaults to the element's own (0,0,0),
  // so rotations pivot around world origin (Three.js convention). Polygons
  // render around the anchor via their own matrix3d translations.
  const sceneStyle = useMemo(() => {
    const handle = createIsometricCamera(cameraState);
    return {
      ...handle.getStyle(),
      top: "50%",
      left: "50%",
    };
  }, [cameraState]);

  const computedClassName = `polycss-scene${className ? ` ${className}` : ""}`;

  // Per-polygon context: lighting + scene units. In dynamic mode the
  // atlas is light-independent (CSS does the shading), so we deliberately
  // drop both lights from the plan inputs — that prevents the atlas from
  // rebuilding (and the polygons from blanking) every time the user moves
  // a light slider.
  const directionalForAtlas = textureLighting === "dynamic" ? undefined : directionalLight;
  const ambientForAtlas = textureLighting === "dynamic" ? undefined : ambientLight;
  const polyContext = useMemo(() => {
    const tileSize = 50;
    return {
      tileSize,
      layerElevation: tileSize,
      directionalLight: directionalForAtlas,
      ambientLight: ambientForAtlas,
      textureLighting,
    };
  }, [directionalForAtlas, ambientForAtlas, textureLighting]);

  const textureAtlasPlans = useMemo(
    () => polygons.map((p, i) => computeTextureAtlasPlan(p, i, polyContext)),
    [polygons, polyContext],
  );
  const textureAtlas = useTextureAtlas(textureAtlasPlans, textureLighting, atlasScale);

  // Dynamic mode plumbing: emit normalized light direction + light/ambient
  // color/intensity as CSS custom properties on the scene root. They
  // cascade into every polygon, where a per-element calc resolves the
  // Lambert dot product and tints via background-blend-mode.
  const dynamicLightVars = useMemo<CSSProperties | null>(() => {
    if (textureLighting !== "dynamic") return null;
    const dir = directionalLight?.direction ?? [0.4, -0.7, 0.59];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len;
    const lightRgb = parseHexColor(directionalLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const ambRgb = parseHexColor(ambientLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
    const lightIntensity = directionalLight?.intensity ?? 1;
    const ambientIntensity = ambientLight?.intensity ?? 0.4;
    const ch = (n: number) => (n / 255).toFixed(4);
    return {
      ["--polycss-lx" as string]: lx.toFixed(4),
      ["--polycss-ly" as string]: ly.toFixed(4),
      ["--polycss-lz" as string]: lz.toFixed(4),
      ["--polycss-lr" as string]: ch(lightRgb[0]),
      ["--polycss-lg" as string]: ch(lightRgb[1]),
      ["--polycss-lb" as string]: ch(lightRgb[2]),
      ["--polycss-li" as string]: lightIntensity.toFixed(4),
      ["--polycss-ar" as string]: ch(ambRgb[0]),
      ["--polycss-ag" as string]: ch(ambRgb[1]),
      ["--polycss-ab" as string]: ch(ambRgb[2]),
      ["--polycss-ai" as string]: ambientIntensity.toFixed(4),
    };
  }, [textureLighting, directionalLight, ambientLight]);

  // depthOffset was a voxcss-era hack that pushed the cube grid down so
  // the tilted camera could see its floor. Centered meshes don't need it
  // — their centroid already sits at viewport center. Set 0 so useCamera
  // doesn't reapply a stale offset on rotation/zoom updates.
  const depthOffset = 0;

  // autoCenter wrapper transform: translate3d that brings the mesh's
  // bbox center to the scene element's own (0,0,0). The scene then rotates
  // around (0,0,0) which now coincides with the visual centroid — Three.js
  // Group-wrapper trick (mesh.position = -bboxCenter, rotate the parent).
  // Lives on a child div so useCamera can keep mutating the scene
  // element's transform on drag/zoom without clobbering the centering.
  // Polygon data is not mutated. World axes remap to CSS as in Poly.tsx
  // (world-Y → CSS-x, world-X → CSS-y, world-Z → CSS-z).
  const autoCenterTransform = useMemo(() => {
    if (!autoCenter) return undefined;
    const cssX = ((sceneBbox.min[1] + sceneBbox.max[1]) / 2) * polyContext.tileSize;
    const cssY = ((sceneBbox.min[0] + sceneBbox.max[0]) / 2) * polyContext.tileSize;
    const cssZ = ((sceneBbox.min[2] + sceneBbox.max[2]) / 2) * polyContext.layerElevation;
    return `translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
  }, [autoCenter, sceneBbox, polyContext.tileSize, polyContext.layerElevation]);

  const polyChildren = textureAtlas.entries.map((entry) =>
    entry ? (
      <TextureAtlasPoly
        key={entry.index}
        entry={entry}
        page={textureAtlas.pages[entry.pageIndex]}
        textureLighting={textureLighting}
      />
    ) : (
      null
    )
  );

  // Propagate scene-level rendering options to descendants (PolyMesh /
  // helpers) so they pick up the same dynamic mode + lights as the scene.
  // Without this, a helper PolyMesh would default to baked rendering
  // while the scene's global CSS rule paints over it with the dynamic
  // calc — producing corrupt tints.
  const sceneCtxValue = useMemo(
    () => ({ textureLighting, directionalLight, ambientLight }),
    [textureLighting, directionalLight, ambientLight],
  );

  return (
    <PolySceneContext.Provider value={sceneCtxValue}>
      <div
        ref={localSceneRef}
        className={computedClassName}
        data-polycss-depth-offset={String(depthOffset)}
        data-polycss-lighting={textureLighting}
        style={
          {
            ...sceneStyle,
            ...(dynamicLightVars ?? null),
            ...style,
            // No more --polycss-rows / --polycss-cols — CSS Grid was dropped
            // in Phase 4 (per §Design.4a).
          } as CSSProperties
        }
      >
        {autoCenterTransform ? (
          <div style={{ transform: autoCenterTransform, transformStyle: "preserve-3d" }}>
            {polyChildren}
            {children}
          </div>
        ) : (
          <>
            {polyChildren}
            {children}
          </>
        )}
      </div>
    </PolySceneContext.Provider>
  );
}

export const PolyScene = memo(PolySceneInner);
