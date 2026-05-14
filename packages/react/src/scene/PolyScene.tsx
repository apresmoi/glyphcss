import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  Polygon,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
} from "@layoutit/polycss-core";
import { createIsometricCamera, parseHexColor } from "@layoutit/polycss-core";
import { useCameraContext } from "../camera/context";
import { usePolySceneContext } from "./useSceneContext";
import { injectPolyBaseStyles } from "../styles/styles";
import type { TransformProps } from "../shapes/types";
import {
  buildSharedEdgeSets,
  computeTextureAtlasPlan,
  isSolidTrianglePlan,
  type AtlasScale,
  type PolyRenderStrategiesOption,
  TextureBorderShapePoly,
  TextureAtlasPoly,
  TextureTrianglePoly,
  useTextureAtlas,
} from "./textureAtlas";
import { PolySceneContext } from "./sceneContext";

export interface PolySceneProps extends TransformProps {
  /** Polygons to render. Composes additively with `children`. */
  polygons?: Polygon[];
  /**
   * Polygons used ONLY for the `autoCenter` bbox computation. When provided,
   * the autoCenter translate is derived from this list instead of `polygons`.
   *
   * Use this when the scene's renderable polygons live inside a child
   * `<PolyMesh>` (e.g. in selection mode) rather than in `polygons`. Passing
   * the full mesh polygon list here ensures the autoCenter wrapper shifts
   * all children — including helpers like `<PolyAxesHelper>` — by the same
   * -bboxCenter amount as the vanilla renderer's `centerWrapper`. Without it,
   * `autoCenter` computes its bbox from an empty `polygons=[]` and produces
   * no shift, so helpers stay at world origin while the mesh is recentered by
   * PolyMesh's own `autoCenter`.
   */
  centerPolygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  /** Textured polygon lighting mode. Defaults to "baked". */
  textureLighting?: PolyTextureLightingMode;
  /** Raster scale for generated atlas pages. `"auto"` reduces large atlases. */
  atlasScale?: AtlasScale;
  /**
   * Render strategy overrides. Use `{ disable: ["u"] }` to force solid
   * triangles through the atlas path (`<s>`), or `{ disable: ["b", "i", "u"] }`
   * to force every polygon through the atlas. Mirrors the same option on
   * `renderPolygonsWithTextureAtlas` in `@layoutit/polycss`.
   */
  strategies?: PolyRenderStrategiesOption;
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
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;

  // Debug toggles. Cube-only `debugShowOccluded` was removed in Phase 4.
  debugShowLabels?: boolean;
  debugShowBackfaces?: boolean;
}

function PolySceneInner({
  polygons: polygonsProp,
  centerPolygons: centerPolygonsProp,
  perspective: _perspective,
  rotX: _rotX,
  rotY: _rotY,
  zoom: _zoom,
  directionalLight,
  ambientLight,
  textureLighting = "baked",
  atlasScale,
  strategies,
  autoCenter = false,
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

  // Read camera state fresh on every render. The store is kept in sync with
  // cameraRef by useCamera's prop-sync effect AND by controls (PolyOrbitControls,
  // PolyMapControls call store.updateCameraFromRef on every move). So whenever
  // PolyScene re-renders, getState().cameraState is the current truth.
  //
  // This prevents the on-release flicker that happened when PolyScene cached
  // the initial state: a re-render after a drag would apply the stale initial
  // transform inline, snap the scene back, and then useCamera's effect would
  // jump it forward again the next frame.
  const cameraState = store.getState().cameraState;

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
      injectPolyBaseStyles(document);
      injectedRef.current = true;
    }
  }, []);

  // Resolve polygons input. Empty array if none provided so useSceneContext
  // still computes a sane (empty) sceneBbox.
  const inputPolygons = useMemo(() => polygonsProp ?? [], [polygonsProp]);

  // centerPolygons, if provided, is used ONLY for the autoCenter bbox.
  // This lets the caller put the renderable polygons inside a child PolyMesh
  // (for selection interactivity) while still centering all children — including
  // helpers like <PolyAxesHelper> — around the correct bbox.
  const centerInputPolygons = useMemo(
    () => centerPolygonsProp ?? null,
    [centerPolygonsProp],
  );

  // Run mesh post-processing pipeline (normalize + automatic merge).
  const { polygons, sceneBbox: renderSceneBbox } = usePolySceneContext(inputPolygons, {
    directionalLight,
  });

  // Bbox for autoCenter: prefer centerPolygons (if provided) over the render
  // polygon bbox. centerPolygons are NOT normalized/merged here — they're used
  // raw for bbox so the shift matches the vanilla renderer (which also uses
  // raw merged polygons, not normalized ones, for its centerWrapper calc).
  const { sceneBbox: centerSceneBbox } = usePolySceneContext(
    centerInputPolygons ?? inputPolygons,
    { directionalLight },
  );
  const sceneBbox = centerInputPolygons ? centerSceneBbox : renderSceneBbox;

  // Scene element is a 0×0 anchor at world (0,0,0). Pinning to top:50%/
  // left:50% places that point at the visible center of .polycss-camera
  // — flex centering is unreliable for position:absolute children with no
  // flow box. transform-origin defaults to the element's own (0,0,0),
  // so rotations pivot around world origin (Three.js convention). Polygons
  // render around the anchor via their own matrix3d translations.
  const sceneStyle = useMemo(() => {
    const handle = createIsometricCamera(cameraState);
    const cameraStyle = handle.getStyle();
    return {
      ["--scene-transform" as string]: cameraStyle.transform,
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
    () => {
      const sharedEdges = buildSharedEdgeSets(polygons);
      return polygons.map((p, i) => computeTextureAtlasPlan(p, i, {
        ...polyContext,
        seamEdges: sharedEdges[i],
      }));
    },
    [polygons, polyContext],
  );
  const textureAtlas = useTextureAtlas(textureAtlasPlans, textureLighting, atlasScale, strategies);

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
      ["--plx" as string]: lx.toFixed(4),
      ["--ply" as string]: ly.toFixed(4),
      ["--plz" as string]: lz.toFixed(4),
      ["--plr" as string]: ch(lightRgb[0]),
      ["--plg" as string]: ch(lightRgb[1]),
      ["--plb" as string]: ch(lightRgb[2]),
      ["--pli" as string]: lightIntensity.toFixed(4),
      ["--par" as string]: ch(ambRgb[0]),
      ["--pag" as string]: ch(ambRgb[1]),
      ["--pab" as string]: ch(ambRgb[2]),
      ["--pai" as string]: ambientIntensity.toFixed(4),
    };
  }, [textureLighting, directionalLight, ambientLight]);

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

  const disabledStrategies = useMemo(
    () => strategies?.disable?.length ? new Set(strategies.disable) : undefined,
    [strategies],
  );

  const polyChildren = textureAtlas.entries.map((entry, index) => {
    if (entry) {
      return (
        <TextureAtlasPoly
          key={entry.index}
          entry={entry}
          page={textureAtlas.pages[entry.pageIndex]}
          textureLighting={textureLighting}
        />
      );
    }

    const plan = textureAtlasPlans[index];
    if (!plan || plan.texture) return null;
    // Solid triangles go through <u> only when that strategy is active.
    // When "u" is disabled they fall to <i> (border-shape, if supported) or
    // <s> (atlas). The atlas path is handled above via packed.entries; the <i>
    // fallback lands here via TextureBorderShapePoly (same as non-rect solids).
    const useU = !disabledStrategies?.has("u");
    return (useU && isSolidTrianglePlan(plan))
      ? <TextureTrianglePoly key={plan.index} entry={plan} textureLighting={textureLighting} />
      : <TextureBorderShapePoly key={plan.index} entry={plan} disabledStrategies={disabledStrategies} />;
  });

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
        data-polycss-lighting={textureLighting}
        aria-hidden="true"
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
          <div className="polycss-offset" style={{ ["--offset-transform" as string]: autoCenterTransform } as CSSProperties}>
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
