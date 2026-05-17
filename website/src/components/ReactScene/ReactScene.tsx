import { useMemo, type RefObject } from "react";
import {
  PolyAxesHelper,
  PolyOrthographicCamera,
  PolyPerspectiveCamera,
  PolyMapControls,
  PolyOrbitControls,
  PolyDirectionalLightHelper,
  PolyMesh,
  PolyScene,
  PolySelect,
  PolyTransformControls,
} from "@layoutit/polycss-react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyMeshHandle,
  Polygon,
  Vec3,
} from "@layoutit/polycss-react";
import {
  cameraCullNormalGroupsFromPolygons,
  isVoxelCameraCullableNormalGroups,
  polygonFacesCamera,
  type TextureQuality,
} from "@layoutit/polycss";
import type { GizmoMode, SceneOptionsState } from "../types";

function canCullCameraBackfaces(polygons: Polygon[]): boolean {
  return isVoxelCameraCullableNormalGroups(cameraCullNormalGroupsFromPolygons(polygons));
}

function cullCameraBackfaces(
  polygons: Polygon[],
  rotX: number,
  rotY: number,
  meshRotation?: Vec3,
): Polygon[] {
  return polygons.filter((polygon) => polygonFacesCamera(polygon, { rotX, rotY, meshRotation }));
}

export interface ReactSceneProps {
  rendererDebugKey: string;
  sceneOptions: SceneOptionsState;
  scenePolygons: Polygon[];
  interiorFillPolygons: Polygon[];
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  textureQuality: TextureQuality;
  gizmoDragging: boolean;
  setGizmoDragging: (v: boolean) => void;
  handleCameraChange: (cam: { rotX: number; rotY: number; zoom: number; target?: Vec3 }) => void;
  loaded: { label?: string } | null;
  selectedMeshes: PolyMeshHandle[];
  setSelectedMeshes: (meshes: PolyMeshHandle[]) => void;
  meshRef: RefObject<PolyMeshHandle | null>;
  meshPosition: Vec3;
  setMeshPosition: (pos: Vec3) => void;
  meshRotation: Vec3;
  setMeshRotation: (rot: Vec3) => void;
  hoveredMeshId: string | null;
  setHoveredMeshId: (id: string | null) => void;
  gizmoMode: GizmoMode;
  helperScale: number;
  helperTarget: [number, number, number];
}

export function ReactScene({
  rendererDebugKey,
  sceneOptions,
  scenePolygons,
  interiorFillPolygons,
  directionalLight,
  ambientLight,
  textureQuality,
  gizmoDragging,
  setGizmoDragging,
  handleCameraChange,
  loaded,
  selectedMeshes,
  setSelectedMeshes,
  meshRef,
  meshPosition,
  setMeshPosition,
  meshRotation,
  setMeshRotation,
  hoveredMeshId,
  setHoveredMeshId,
  gizmoMode,
  helperScale,
  helperTarget,
}: ReactSceneProps) {
  const Cam = sceneOptions.perspective === false ? PolyOrthographicCamera : PolyPerspectiveCamera;
  const camProps = sceneOptions.perspective === false
    ? { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target }
    : { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target, perspective: sceneOptions.perspective };
  const centerPolygons = useMemo(
    () => interiorFillPolygons.length > 0
      ? [...scenePolygons, ...interiorFillPolygons]
      : scenePolygons,
    [scenePolygons, interiorFillPolygons],
  );
  const effectiveMeshRotation = sceneOptions.selection ? meshRotation : undefined;
  const canCullScenePolygons = useMemo(
    () => canCullCameraBackfaces(scenePolygons),
    [scenePolygons],
  );
  const canCullInteriorFillPolygons = useMemo(
    () => canCullCameraBackfaces(interiorFillPolygons),
    [interiorFillPolygons],
  );
  const visibleScenePolygons = useMemo(
    () => canCullScenePolygons
      ? cullCameraBackfaces(scenePolygons, sceneOptions.rotX, sceneOptions.rotY, effectiveMeshRotation)
      : scenePolygons,
    [scenePolygons, canCullScenePolygons, sceneOptions.rotX, sceneOptions.rotY, effectiveMeshRotation],
  );
  const visibleInteriorFillPolygons = useMemo(
    () => canCullInteriorFillPolygons
      ? cullCameraBackfaces(interiorFillPolygons, sceneOptions.rotX, sceneOptions.rotY, effectiveMeshRotation)
      : interiorFillPolygons,
    [interiorFillPolygons, canCullInteriorFillPolygons, sceneOptions.rotX, sceneOptions.rotY, effectiveMeshRotation],
  );
  const fillMesh = visibleInteriorFillPolygons.length > 0 ? (
    <PolyMesh
      polygons={visibleInteriorFillPolygons}
      className="dn-interior-fill-mesh"
    />
  ) : null;
  return (
    <Cam key={rendererDebugKey} {...camProps}>
      {sceneOptions.dragMode === "pan" ? (
        <PolyMapControls
          drag={sceneOptions.interactive && !gizmoDragging}
          wheel={sceneOptions.interactive && !gizmoDragging}
          animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
          onInteractionEnd={handleCameraChange}
        />
      ) : (
        // FPV control mode is vanilla-only in this spike; the React
        // renderer keeps orbit semantics for now.
        <PolyOrbitControls
          drag={sceneOptions.interactive && !gizmoDragging}
          wheel={sceneOptions.interactive && !gizmoDragging}
          animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
          onInteractionEnd={handleCameraChange}
        />
      )}
      <PolyScene
        polygons={[]}
        centerPolygons={centerPolygons}
        autoCenter={sceneOptions.autoCenter}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
        textureLighting={sceneOptions.textureLighting}
        textureQuality={textureQuality}
        strategies={{ disable: sceneOptions.disableStrategies }}
      >
        {sceneOptions.selection ? (
          <PolySelect onChange={setSelectedMeshes} clearOnMiss={false}>
            <PolyMesh
              ref={meshRef}
              id={loaded?.label ?? "model"}
              polygons={visibleScenePolygons}
              position={meshPosition}
              rotation={meshRotation}
              className={
                sceneOptions.hoverEffects && hoveredMeshId === (loaded?.label ?? "model")
                  ? "dn-model-mesh is-hovered"
                  : "dn-model-mesh"
              }
              style={sceneOptions.hoverEffects ? { cursor: "pointer" } : undefined}
              onPointerOver={
                sceneOptions.hoverEffects
                  ? (event) => setHoveredMeshId(event.eventObject.id ?? null)
                  : undefined
              }
              onPointerOut={
                sceneOptions.hoverEffects ? () => setHoveredMeshId(null) : undefined
              }
            >
              {fillMesh}
            </PolyMesh>
          </PolySelect>
        ) : null}
        {!sceneOptions.selection ? (
          <PolyMesh
            id={loaded?.label ?? "model"}
            polygons={visibleScenePolygons}
            className="dn-model-mesh"
          >
            {fillMesh}
          </PolyMesh>
        ) : null}
        {sceneOptions.selection && selectedMeshes.length > 0 && (
          <PolyTransformControls
            object={meshRef}
            mode={gizmoMode}
            onObjectChange={(event) => {
              if (event.position) setMeshPosition(event.position);
              if (event.rotation) setMeshRotation(event.rotation);
            }}
            onDraggingChanged={setGizmoDragging}
          />
        )}
        {sceneOptions.showAxes && <PolyAxesHelper size={helperScale * 0.6} />}
        {sceneOptions.showLight && (
          <PolyDirectionalLightHelper
            light={directionalLight}
            target={helperTarget}
            distance={helperScale * 0.7}
            size={helperScale * 0.05}
          />
        )}
      </PolyScene>
    </Cam>
  );
}
