import {
  PolyAxesHelper,
  PolyDirectionalLightHelper,
  PolyFirstPersonControls,
  PolyMapControls,
  PolyMesh,
  PolyOrbitControls,
  PolyOrthographicCamera,
  PolyPerspectiveCamera,
  PolyScene,
  PolySelect,
  PolyTransformControls,
} from "@layoutit/polycss-react";
import type {
  PolyAmbientLight,
  PolyDirectionalLight,
  PolyFirstPersonControlsHandle,
  PolyMeshHandle,
  PolyTransformControlsObjectChangeEvent,
  Polygon,
} from "@layoutit/polycss-react";
import { type RefObject } from "react";
import type { SceneOptionsState, GizmoMode } from "../../types";
import type { PlacedItem } from "../types";

export interface BuilderSceneProps {
  sceneOptions: SceneOptionsState;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  directionalLight: PolyDirectionalLight;
  ambientLight: PolyAmbientLight;
  /** Unified floor grid — also carries the terrain elevation. Lines
   *  bend at raised vertices instead of passing flat through hills. */
  gridPolygons: Polygon[];
  ghostPolygons: Polygon[];
  /** Single-quad outline showing the vertex the terrain-tool cursor is
   *  currently over. Empty when no terrain tool is active. */
  terrainHoverPolygons: Polygon[];
  placementDraft: boolean;
  renderItems: Array<PlacedItem & { rawPolygons: Polygon[] }>;
  renderedPolygonsById: Map<string, Polygon[]>;
  selectedId: string | null;
  gizmoMode: GizmoMode;
  gizmoDragging: boolean;
  meshHandlesRef: RefObject<Map<string, PolyMeshHandle>>;
  getMeshRefCallback: (id: string) => (h: PolyMeshHandle | null) => void;
  fpvControlsRef: RefObject<PolyFirstPersonControlsHandle | null>;
  onSelectionChange: (handles: PolyMeshHandle[]) => void;
  onGizmoDraggingChanged: (dragging: boolean) => void;
  onGizmoObjectChange: (event: PolyTransformControlsObjectChangeEvent) => void;
  selected: PlacedItem | null;
}

export function BuilderScene({
  sceneOptions,
  updateScene,
  directionalLight,
  ambientLight,
  gridPolygons,
  ghostPolygons,
  terrainHoverPolygons,
  placementDraft,
  renderItems,
  renderedPolygonsById,
  selectedId,
  gizmoMode,
  gizmoDragging,
  meshHandlesRef,
  getMeshRefCallback,
  fpvControlsRef,
  onSelectionChange,
  onGizmoDraggingChanged,
  onGizmoObjectChange,
  selected,
}: BuilderSceneProps) {
  const Cam = sceneOptions.perspective === false ? PolyOrthographicCamera : PolyPerspectiveCamera;
  const camProps = sceneOptions.perspective === false
    ? { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target }
    : { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY, target: sceneOptions.target, perspective: sceneOptions.perspective };

  return (
    <Cam {...camProps}>
      {sceneOptions.dragMode === "pan" ? (
        <PolyMapControls
          drag={sceneOptions.interactive && !gizmoDragging}
          wheel={sceneOptions.interactive && !gizmoDragging}
          animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
          onInteractionEnd={(cam) => updateScene({
            rotX: cam.rotX,
            rotY: cam.rotY,
            zoom: cam.zoom,
            ...(cam.target ? { target: cam.target } : {}),
          })}
        />
      ) : sceneOptions.dragMode === "fpv" ? (
        <PolyFirstPersonControls
          ref={fpvControlsRef}
          lookEnabled={sceneOptions.fpvLook}
          moveEnabled={sceneOptions.fpvMove}
          jumpEnabled={sceneOptions.fpvJump}
          crouchEnabled={sceneOptions.fpvCrouch}
          moveSpeed={sceneOptions.fpvMoveSpeed}
          jumpVelocity={sceneOptions.fpvJumpVelocity}
          gravity={sceneOptions.fpvGravity}
          eyeHeight={sceneOptions.fpvEyeHeight}
          crouchHeight={sceneOptions.fpvCrouchHeight}
          lookSensitivity={sceneOptions.fpvLookSensitivity}
          invertY={sceneOptions.fpvInvertY}
        />
      ) : (
        <PolyOrbitControls
          drag={sceneOptions.interactive && !gizmoDragging}
          wheel={sceneOptions.interactive && !gizmoDragging}
          animate={sceneOptions.animate ? { speed: 0.35, axis: "y", pauseOnInteraction: true } : false}
          onInteractionEnd={(cam) => updateScene({
            rotX: cam.rotX,
            rotY: cam.rotY,
            zoom: cam.zoom,
            ...(cam.target ? { target: cam.target } : {}),
          })}
        />
      )}
      <PolyScene
        polygons={[]}
        autoCenter={sceneOptions.autoCenter}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
        textureLighting={sceneOptions.textureLighting}
        textureQuality={sceneOptions.textureQuality}
        strategies={{ disable: sceneOptions.disableStrategies }}
      >
        {/* Unified floor + terrain grid — the gridlines themselves
            carry the heightmap elevation, so raised vertices bend the
            grid rather than peeking out from under a separate fill. */}
        {sceneOptions.showGround && <PolyMesh polygons={gridPolygons} />}
        {/* Terrain hover ghost — small cyan marker over the vertex the
            next click will modify. */}
        {terrainHoverPolygons.length > 0 && (
          <PolyMesh polygons={terrainHoverPolygons} className="builder-terrain-hover" />
        )}
        {sceneOptions.showAxes && <PolyAxesHelper size={3} />}
        {sceneOptions.showLight && (
          <PolyDirectionalLightHelper
            light={directionalLight}
            target={[0, 0, 0]}
            distance={10}
            size={0.6}
          />
        )}
        {/* Placement-mode ghost wireframe — bbox edges of the
            preset, positioned with its bottom face touching the
            floor at the cursor's projected ground point. Pointer
            events that drive the cursor + commit live on the
            viewport DOM — no catcher mesh. */}
        {placementDraft && (
          <PolyMesh
            polygons={ghostPolygons}
            className="builder-ghost"
          />
        )}
        <PolySelect onChange={onSelectionChange} clearOnMiss={true}>
          {renderItems.map((it) => (
            <PolyMesh
              key={it.id}
              ref={getMeshRefCallback(it.id)}
              id={it.id}
              polygons={renderedPolygonsById.get(it.id) ?? it.rawPolygons}
              position={it.position}
              rotation={it.rotation}
              scale={it.fitScale * it.scale}
              castShadow={sceneOptions.castShadow}
              style={{ cursor: "pointer" }}
              className={`builder-placed${it.id === selectedId ? " is-selected" : ""}`}
            />
          ))}
        </PolySelect>
        {selected && (
          <PolyTransformControls
            object={meshHandlesRef.current.get(selected.id) ?? null}
            mode={gizmoMode}
            size={selected.fitScale * selected.scale}
            onObjectChange={onGizmoObjectChange}
            onDraggingChanged={onGizmoDraggingChanged}
          />
        )}
      </PolyScene>
    </Cam>
  );
}
