/**
 * Camera folder — extracted from the legacy Dock.tsx mega-effect.
 *
 * Largest of the per-folder hooks: ~25 controllers split across the top-level
 * "Camera" folder and a nested "FPV" sub-folder. The whole thing starts closed
 * because most users never touch it, and the FPV sub-folder is gated by the
 * Drag mode dropdown — when Drag isn't "fpv", every FPV row is dimmed (kept
 * visible to advertise the feature, just non-interactive) and the
 * "Perspective px" row is hidden whenever projection is orthographic.
 */
import { useEffect, useRef } from "react";
import type { GUI } from "lil-gui";
import type { Vec3 } from "@layoutit/polycss-react";

import {
  useButton,
  useFolder,
  useOption,
  useSlider,
  useToggle,
} from "../primitives";
import type { DragMode, PerspectiveMode, SceneOptionsState } from "../../types";

interface PresetModelMinimal {
  zoom?: number;
  rotX?: number;
  rotY?: number;
}

interface LoadedModelMinimal {
  rawPolygons: Array<{ vertices: [number, number, number][] }>;
}

export interface CameraFolderInputs {
  autoCenter: boolean;
  showAxes: boolean;
  animate: boolean;
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
  fpvRenderDistance: number;
  perspectiveMode: PerspectiveMode;
  perspectivePx: number;
  perspective: number | false;
  zoom: number;
  rotX: number;
  rotY: number;
  target: Vec3;
  /** For the Reset button: derives the reset zoom from the loaded model. */
  loaded: LoadedModelMinimal | null;
  selectedPreset: PresetModelMinimal;
  defaultZoomForModel: (
    preset: PresetModelMinimal,
    rawPolygons: LoadedModelMinimal["rawPolygons"],
  ) => number;
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
    showAxes,
    animate,
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
    fpvRenderDistance,
    perspectiveMode,
    perspectivePx,
    perspective,
    zoom,
    rotX,
    rotY,
    target,
    loaded,
    selectedPreset,
    defaultZoomForModel,
    onUpdateScene,
  } = inputs;

  // Reset-camera closure must always read the latest preset + loaded model
  // without re-creating the button (which would also re-mount the lil-gui row,
  // shuffling controller order). Keep these in a single ref bag and read
  // through it in the click handler.
  const resetCtxRef = useRef({ loaded, selectedPreset, defaultZoomForModel, onUpdateScene });
  resetCtxRef.current = { loaded, selectedPreset, defaultZoomForModel, onUpdateScene };

  // Target moves three sliders at once — keep the latest tuple in a ref so each
  // slider's onChange can splat the other two axes without forcing the hook to
  // re-create the controllers when `target` reference changes.
  const targetRef = useRef<Vec3>(target);
  targetRef.current = target;

  // Same story for perspectivePx: the Projection dropdown reads it when
  // flipping from orthographic → perspective.
  const perspectivePxRef = useRef(perspectivePx);
  perspectivePxRef.current = perspectivePx;

  const folder = useFolder(parent, "Camera", { open: false });

  useButton(folder, "Reset camera", () => {
    const { loaded: l, selectedPreset: p, defaultZoomForModel: f, onUpdateScene: u } =
      resetCtxRef.current;
    const resetZoom = l ? f(p, l.rawPolygons) : p.zoom ?? 0.35;
    u({
      zoom: resetZoom,
      rotX: p.rotX ?? 65,
      rotY: p.rotY ?? 45,
      target: [0, 0, 0],
    });
  });

  useToggle(folder, "Auto center", autoCenter, (value) =>
    onUpdateScene({ autoCenter: value }),
  );
  useToggle(folder, "Axes", showAxes, (value) => onUpdateScene({ showAxes: value }));
  useToggle(folder, "Auto rotate", animate, (value) => onUpdateScene({ animate: value }));
  useOption<DragMode>(folder, "Drag", DRAG_MODE_OPTIONS, dragMode, (value) =>
    onUpdateScene({ dragMode: value }),
  );

  // FPV sub-folder — nested directly under the Camera folder. All 11
  // controllers below are dimmed when Drag isn't "fpv" (see effect at end).
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
    { min: 1, max: 300, step: 1 },
    fpvMoveSpeed,
    (value) => onUpdateScene({ fpvMoveSpeed: value }),
  );
  const fpvJumpVelocityCtrl = useSlider(
    fpvFolder,
    "Jump velocity",
    { min: 1, max: 200, step: 1 },
    fpvJumpVelocity,
    (value) => onUpdateScene({ fpvJumpVelocity: value }),
  );
  const fpvGravityCtrl = useSlider(
    fpvFolder,
    "Gravity",
    { min: 1, max: 500, step: 1 },
    fpvGravity,
    (value) => onUpdateScene({ fpvGravity: value }),
  );
  const fpvEyeHeightCtrl = useSlider(
    fpvFolder,
    "Eye height",
    { min: 0.1, max: 100, step: 0.5 },
    fpvEyeHeight,
    (value) => onUpdateScene({ fpvEyeHeight: value }),
  );
  const fpvCrouchHeightCtrl = useSlider(
    fpvFolder,
    "Crouch height",
    { min: 0.1, max: 100, step: 0.5 },
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
  const fpvRenderDistanceCtrl = useSlider(
    fpvFolder,
    "Render distance",
    { min: 0, max: 200, step: 1 },
    fpvRenderDistance,
    (value) => onUpdateScene({ fpvRenderDistance: value }),
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
    { min: -50, max: 50, step: 0.1 },
    target[0],
    (value) => {
      const t = targetRef.current;
      onUpdateScene({ target: [value, t[1], t[2]] });
    },
  );
  useSlider(
    folder,
    "Target Y",
    { min: -50, max: 50, step: 0.1 },
    target[1],
    (value) => {
      const t = targetRef.current;
      onUpdateScene({ target: [t[0], value, t[2]] });
    },
  );
  useSlider(
    folder,
    "Target Z",
    { min: -50, max: 50, step: 0.1 },
    target[2],
    (value) => {
      const t = targetRef.current;
      onUpdateScene({ target: [t[0], t[1], value] });
    },
  );

  // FPV enable/disable: dim every FPV row when not in FPV drag mode. Keeping
  // the rows visible (rather than hiding the folder) preserves muscle memory
  // and signals the feature exists.
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

  // Perspective-px row only makes sense in perspective projection; hide it
  // outright when projection is orthographic (`perspective === false`).
  useEffect(() => {
    perspectivePxCtrl?.setVisible(perspective !== false);
  }, [perspectivePxCtrl, perspective]);
}
