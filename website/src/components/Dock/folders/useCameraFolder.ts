/**
 * Camera folder — projection, zoom/rotX/rotY/target sliders, drag mode
 * dropdown, and a nested FPV sub-folder with all FPV sub-options.
 *
 * The FPV sub-folder controllers are dimmed when drag mode is not "fpv" —
 * kept visible to advertise the feature, just non-interactive. The
 * "Perspective px" row is hidden when projection is orthographic.
 *
 * Ported from glyphcss useCameraFolder.ts; adapted for glyphcss types (rotX in
 * degrees 0–100, target range ±2, no auto-center axes or reset-model callback).
 */
import { useEffect, useRef } from "react";
import type { GUI } from "lil-gui";
import type { SceneOptionsState, DragMode, PerspectiveMode } from "../../GalleryWorkbench/types";
import { useButton, useFolder, useOption, useSlider, useToggle } from "../primitives";

interface PresetModelMinimal {
  zoom?: number;
  rotX?: number;
  rotY?: number;
}

export interface CameraFolderInputs {
  autoCenter: boolean;
  autoRotate: boolean;
  showAxes: boolean;
  interactive: boolean;
  dragMode: DragMode;
  fpvLook: boolean;
  fpvMove: boolean;
  fpvJump: boolean;
  fpvCrouch: boolean;
  fpvMoveSpeed: number;
  fpvJumpVelocity: number;
  fpvGravity: number;
  fpvEyeHeight: number;
  fpvCrouchHeight: number;
  fpvLookSensitivity: number;
  fpvInvertY: boolean;
  perspectiveMode: PerspectiveMode;
  perspectivePx: number;
  perspective: number | false;
  zoom: number;
  rotX: number;
  rotY: number;
  target: [number, number, number];
  selectedPreset: PresetModelMinimal;
  onUpdateScene: (partial: Partial<SceneOptionsState>) => void;
}

const DRAG_MODE_OPTIONS: Record<string, DragMode> = {
  Orbit: "orbit",
  Pan: "pan",
  FPV: "fpv",
};

const PROJECTION_OPTIONS: Record<string, PerspectiveMode> = {
  Perspective: "perspective",
  Orthographic: "orthographic",
};

const PERSPECTIVE_PX_OPTIONS: Record<string, number> = {
  "500 px": 500,
  "1000 px": 1000,
  "2000 px": 2000,
  "4000 px": 4000,
  "8000 px": 8000,
  "16000 px": 16000,
  "32000 px": 32000,
  "64000 px": 64000,
};

export function useCameraFolder(parent: GUI | null, inputs: CameraFolderInputs): void {
  const {
    autoCenter,
    autoRotate,
    showAxes,
    interactive,
    dragMode,
    fpvLook,
    fpvMove,
    fpvJump,
    fpvCrouch,
    fpvMoveSpeed,
    fpvJumpVelocity,
    fpvGravity,
    fpvEyeHeight,
    fpvCrouchHeight,
    fpvLookSensitivity,
    fpvInvertY,
    perspectiveMode,
    perspectivePx,
    perspective,
    zoom,
    rotX,
    rotY,
    target,
    selectedPreset,
    onUpdateScene,
  } = inputs;

  // Refs so the reset button and target sliders always see the latest values
  // without recreating their controllers on every render.
  const resetCtxRef = useRef({ selectedPreset, onUpdateScene });
  resetCtxRef.current = { selectedPreset, onUpdateScene };

  const targetRef = useRef<[number, number, number]>(target);
  targetRef.current = target;

  const perspectivePxRef = useRef(perspectivePx);
  perspectivePxRef.current = perspectivePx;

  const folder = useFolder(parent, "Camera", { open: false });

  useButton(folder, "Reset camera", () => {
    const { selectedPreset: p, onUpdateScene: u } = resetCtxRef.current;
    u({
      zoom: p.zoom ?? 0.35,
      rotX: p.rotX ?? 65,
      rotY: p.rotY ?? 45,
      target: [0, 0, 0],
    });
  });

  useToggle(folder, "Auto center", autoCenter, (value) => onUpdateScene({ autoCenter: value }));
  useToggle(folder, "Auto rotate", autoRotate, (value) => onUpdateScene({ autoRotate: value }));
  useToggle(folder, "Axes", showAxes, (value) => onUpdateScene({ showAxes: value }));
  useToggle(folder, "Interactive", interactive, (value) => onUpdateScene({ interactive: value }));
  useOption<DragMode>(folder, "Drag mode", DRAG_MODE_OPTIONS, dragMode, (value) =>
    onUpdateScene({ dragMode: value }),
  );

  // FPV sub-folder — nested under Camera. All controllers dimmed when not in FPV mode.
  const fpvFolder = useFolder(folder, "FPV", { open: false });

  const fpvLookCtrl = useToggle(fpvFolder, "Look", fpvLook, (value) =>
    onUpdateScene({ fpvLook: value }),
  );
  const fpvMoveCtrl = useToggle(fpvFolder, "Move", fpvMove, (value) =>
    onUpdateScene({ fpvMove: value }),
  );
  const fpvJumpCtrl = useToggle(fpvFolder, "Jump", fpvJump, (value) =>
    onUpdateScene({ fpvJump: value }),
  );
  const fpvCrouchCtrl = useToggle(fpvFolder, "Crouch", fpvCrouch, (value) =>
    onUpdateScene({ fpvCrouch: value }),
  );
  const fpvMoveSpeedCtrl = useSlider(
    fpvFolder,
    "Move speed",
    { min: 0.05, max: 20, step: 0.05 },
    fpvMoveSpeed,
    (value) => onUpdateScene({ fpvMoveSpeed: value }),
  );
  const fpvJumpVelocityCtrl = useSlider(
    fpvFolder,
    "Jump velocity",
    { min: 0.05, max: 20, step: 0.05 },
    fpvJumpVelocity,
    (value) => onUpdateScene({ fpvJumpVelocity: value }),
  );
  const fpvGravityCtrl = useSlider(
    fpvFolder,
    "Gravity",
    { min: 0.1, max: 50, step: 0.1 },
    fpvGravity,
    (value) => onUpdateScene({ fpvGravity: value }),
  );
  const fpvEyeHeightCtrl = useSlider(
    fpvFolder,
    "Eye height",
    { min: 0.02, max: 10, step: 0.02 },
    fpvEyeHeight,
    (value) => onUpdateScene({ fpvEyeHeight: value }),
  );
  const fpvCrouchHeightCtrl = useSlider(
    fpvFolder,
    "Crouch height",
    { min: 0.02, max: 10, step: 0.02 },
    fpvCrouchHeight,
    (value) => onUpdateScene({ fpvCrouchHeight: value }),
  );
  const fpvLookSensitivityCtrl = useSlider(
    fpvFolder,
    "Look sensitivity",
    { min: 0.02, max: 1, step: 0.01 },
    fpvLookSensitivity,
    (value) => onUpdateScene({ fpvLookSensitivity: value }),
  );
  const fpvInvertYCtrl = useToggle(fpvFolder, "Invert Y", fpvInvertY, (value) =>
    onUpdateScene({ fpvInvertY: value }),
  );

  useOption<PerspectiveMode>(
    folder,
    "Projection",
    PROJECTION_OPTIONS,
    perspectiveMode,
    (value) =>
      onUpdateScene({
        perspective: value === "perspective" ? perspectivePxRef.current : false,
      }),
  );
  const perspectivePxCtrl = useOption<number>(
    folder,
    "Perspective px",
    PERSPECTIVE_PX_OPTIONS,
    perspectivePx,
    (value) => onUpdateScene({ perspective: value }),
  );

  useSlider(folder, "Zoom", { min: 0.05, max: 2.5, step: 0.01 }, zoom, (value) =>
    onUpdateScene({ zoom: value }),
  );
  useSlider(folder, "Rot X", { min: 0, max: 100, step: 1 }, rotX, (value) =>
    onUpdateScene({ rotX: value }),
  );
  useSlider(folder, "Rot Y", { min: 0, max: 360, step: 1 }, rotY, (value) =>
    onUpdateScene({ rotY: value }),
  );
  useSlider(
    folder,
    "Target X",
    { min: -2, max: 2, step: 0.01 },
    target[0],
    (value) => {
      const t = targetRef.current;
      onUpdateScene({ target: [value, t[1], t[2]] });
    },
  );
  useSlider(
    folder,
    "Target Y",
    { min: -2, max: 2, step: 0.01 },
    target[1],
    (value) => {
      const t = targetRef.current;
      onUpdateScene({ target: [t[0], value, t[2]] });
    },
  );
  useSlider(
    folder,
    "Target Z",
    { min: -2, max: 2, step: 0.01 },
    target[2],
    (value) => {
      const t = targetRef.current;
      onUpdateScene({ target: [t[0], t[1], value] });
    },
  );

  // Dim every FPV controller when drag mode is not "fpv".
  useEffect(() => {
    const isFpv = dragMode === "fpv";
    fpvLookCtrl?.setEnabled(isFpv, { dim: true });
    fpvMoveCtrl?.setEnabled(isFpv, { dim: true });
    fpvJumpCtrl?.setEnabled(isFpv, { dim: true });
    fpvCrouchCtrl?.setEnabled(isFpv, { dim: true });
    fpvMoveSpeedCtrl?.setEnabled(isFpv, { dim: true });
    fpvJumpVelocityCtrl?.setEnabled(isFpv, { dim: true });
    fpvGravityCtrl?.setEnabled(isFpv, { dim: true });
    fpvEyeHeightCtrl?.setEnabled(isFpv, { dim: true });
    fpvCrouchHeightCtrl?.setEnabled(isFpv, { dim: true });
    fpvLookSensitivityCtrl?.setEnabled(isFpv, { dim: true });
    fpvInvertYCtrl?.setEnabled(isFpv, { dim: true });
  }, [
    dragMode,
    fpvLookCtrl,
    fpvMoveCtrl,
    fpvJumpCtrl,
    fpvCrouchCtrl,
    fpvMoveSpeedCtrl,
    fpvJumpVelocityCtrl,
    fpvGravityCtrl,
    fpvEyeHeightCtrl,
    fpvCrouchHeightCtrl,
    fpvLookSensitivityCtrl,
    fpvInvertYCtrl,
  ]);

  // Hide "Perspective px" when projection is orthographic.
  useEffect(() => {
    perspectivePxCtrl?.setVisible(perspective !== false);
  }, [perspectivePxCtrl, perspective]);
}
