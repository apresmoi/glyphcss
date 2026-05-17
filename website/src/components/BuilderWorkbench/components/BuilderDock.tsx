import type { ReactNode } from "react";
import {
  Dock,
  DockScene,
  DockRendering,
  DockCamera,
  DockLighting,
} from "../../Dock";
import { defaultZoomForModel } from "../../GalleryWorkbench/helpers/smartDefaults";
import type { PresetModel } from "../../GalleryWorkbench/types";
import type { Polygon } from "@layoutit/polycss-react";
import type { SceneOptionsState, PerspectiveMode } from "../../types";
import type { PlacedItem } from "../types";
import { DockGrid } from "../slots/DockGrid";

export interface BuilderDockProps {
  sceneOptions: SceneOptionsState;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  placedItems: PlacedItem[];
  selectedId: string | null;
  selectedScale: number;
  onScaleChange: (scale: number) => void;
  perspectiveMode: PerspectiveMode;
  perspectivePx: number | false;
  sceneFolderContent: ReactNode;
}

export function BuilderDock({
  sceneOptions,
  updateScene,
  selectedId,
  selectedScale,
  onScaleChange,
  perspectiveMode,
  perspectivePx,
  sceneFolderContent,
}: BuilderDockProps) {
  const stubPreset = { zoom: sceneOptions.zoom, rotX: sceneOptions.rotX, rotY: sceneOptions.rotY };

  return (
    <Dock>
      <DockScene
        content={sceneFolderContent}
        selectedId={selectedId}
        selectedScale={selectedScale}
        onScaleChange={onScaleChange}
      />
      <DockGrid
        showGround={sceneOptions.showGround}
        snapToGrid={sceneOptions.snapToGrid}
        gridResolution={sceneOptions.gridResolution}
        onUpdateScene={updateScene}
      />
      <DockRendering
        meshResolution={sceneOptions.meshResolution}
        meshInteriorFill={sceneOptions.meshInteriorFill}
        solidMaterials={sceneOptions.solidMaterials}
        textureLighting={sceneOptions.textureLighting}
        textureQuality={sceneOptions.textureQuality}
        hasActiveAnimation={false}
        hasSpriteLeaves={false}
        onUpdateScene={updateScene}
      />
      <DockCamera
        autoCenter={sceneOptions.autoCenter}
        showAxes={sceneOptions.showAxes}
        animate={sceneOptions.animate}
        dragMode={sceneOptions.dragMode}
        fpvLook={sceneOptions.fpvLook}
        fpvMove={sceneOptions.fpvMove}
        fpvJump={sceneOptions.fpvJump}
        fpvCrouch={sceneOptions.fpvCrouch}
        fpvMoveSpeed={sceneOptions.fpvMoveSpeed}
        fpvJumpVelocity={sceneOptions.fpvJumpVelocity}
        fpvGravity={sceneOptions.fpvGravity}
        fpvEyeHeight={sceneOptions.fpvEyeHeight}
        fpvCrouchHeight={sceneOptions.fpvCrouchHeight}
        fpvLookSensitivity={sceneOptions.fpvLookSensitivity}
        fpvInvertY={sceneOptions.fpvInvertY}
        fpvRenderDistance={sceneOptions.fpvRenderDistance}
        perspectiveMode={perspectiveMode}
        perspectivePx={perspectivePx}
        perspective={sceneOptions.perspective}
        zoom={sceneOptions.zoom}
        rotX={sceneOptions.rotX}
        rotY={sceneOptions.rotY}
        target={sceneOptions.target}
        loaded={null}
        selectedPreset={stubPreset}
        defaultZoomForModel={(preset, polys) => defaultZoomForModel(preset as PresetModel, polys as Polygon[])}
        onUpdateScene={updateScene}
      />
      <DockLighting
        castShadow={sceneOptions.castShadow}
        showGround={sceneOptions.showGround}
        showLight={sceneOptions.showLight}
        lightAzimuth={sceneOptions.lightAzimuth}
        lightElevation={sceneOptions.lightElevation}
        lightIntensity={sceneOptions.lightIntensity}
        lightColor={sceneOptions.lightColor}
        ambientIntensity={sceneOptions.ambientIntensity}
        ambientColor={sceneOptions.ambientColor}
        onUpdateScene={updateScene}
      />
    </Dock>
  );
}
