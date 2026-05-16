import { useEffect, useRef } from "react";
import { GUI, type Controller } from "lil-gui";
import type { MeshResolution, PolyRenderStrategy, PolyTextureLightingMode } from "@layoutit/polycss-react";
import type { ParseAnimationController } from "@layoutit/polycss-react";
import type { GizmoMode, SceneOptionsState, DomMetrics, DragMode, PerspectiveMode } from "../types";

// Internal type — not exported as it's an implementation detail of the GUI instance.
type GuiControllerMap = Record<string, any>;
type TextureMode = "disabled" | PolyTextureLightingMode;

function textureModeForScene(sceneOptions: SceneOptionsState): TextureMode {
  return sceneOptions.solidMaterials ? "disabled" : sceneOptions.textureLighting;
}

function disableWithoutDisabledClass<T extends Controller>(controller: T): T {
  controller.disable();
  controller.domElement.classList.remove("disabled");
  return controller;
}

const DEBUG_SHAPE_LABELS = {
  rectangle: "Quads <b>",
  triangle: "Triangles <u>",
  irregular: "Polygons <i>",
};

interface LoadedModelMinimal {
  label: string;
  kind: string;
  rawPolygons: Array<{ vertices: [number, number, number][] }>;
  sourcePolygons: number;
  animation?: ParseAnimationController;
}

interface PresetModelMinimal {
  zoom?: number;
  rotX?: number;
  rotY?: number;
}

export interface DockProps {
  // Scene state
  sceneOptions: SceneOptionsState;
  metrics: DomMetrics;
  hasSpriteLeaves: boolean;
  selectedAnimation: string;
  selectedPreset: PresetModelMinimal;
  loaded: LoadedModelMinimal | null;
  animationOptions: Record<string, string>;
  animationClipCount: number;
  hasActiveAnimation: boolean;
  activeAnimation: boolean;
  perspectivePx: number;
  perspectiveMode: PerspectiveMode;
  gizmoMode: GizmoMode;
  defaultZoomForModel: (preset: PresetModelMinimal, rawPolygons: Array<{ vertices: [number, number, number][] }>) => number;

  // Callbacks
  onUpdateScene: (partial: Partial<SceneOptionsState>) => void;
  onAnimationChange: (value: string) => void;
  onResetAnimatedPolygons: () => void;
  onGizmoModeChange: (mode: GizmoMode) => void;
  onSelectAnimationClear: () => void;

  // Loading state
  loading: boolean;
  loadError: string | null;
}

export function Dock({
  sceneOptions,
  metrics,
  hasSpriteLeaves,
  selectedAnimation,
  selectedPreset,
  loaded,
  animationOptions,
  animationClipCount,
  hasActiveAnimation,
  activeAnimation,
  perspectivePx,
  perspectiveMode,
  gizmoMode,
  defaultZoomForModel,
  onUpdateScene,
  onAnimationChange,
  onResetAnimatedPolygons,
  onGizmoModeChange,
  onSelectAnimationClear,
  loading,
  loadError,
}: DockProps) {
  const guiHostRef = useRef<HTMLDivElement | null>(null);
  const guiRef = useRef<GUI | null>(null);
  const guiControllersRef = useRef<GuiControllerMap>({});
  // Keep a ref to disableStrategies so the checkbox onChange closure always
  // reads the current value without recreating the GUI.
  const disableStrategiesRef = useRef(sceneOptions.disableStrategies);
  disableStrategiesRef.current = sceneOptions.disableStrategies;

  // Setup effect — runs once, builds the lil-gui tree.
  useEffect(() => {
    const host = guiHostRef.current;
    if (!host || guiRef.current) return;

    const gui = new GUI({ autoPlace: false, container: host, width: 360, closeFolders: true });
    gui.open();
    guiRef.current = gui;

    const modelState = {
      meshResolution: sceneOptions.meshResolution,
      meshInteriorFill: sceneOptions.meshInteriorFill,
      domCount: 0,
      sprites: 0,
      shapeRectangle: 0,
      shapeTriangle: 0,
      shapeIrregular: 0,
      // The Texture Quality row binds the slider to `textureQualityValue`
      // and the Auto toggle to `textureQualityAuto`. The effective option
      // passed to the scene is "auto" when textureQualityAuto is true, else
      // textureQualityValue (clamped to 0.1..1). Keeping them as two fields
      // lets the slider preserve its last numeric value while Auto is on.
      textureQualityValue: typeof sceneOptions.textureQuality === "number"
        ? sceneOptions.textureQuality
        : 1,
      textureQualityAuto: sceneOptions.textureQuality === "auto",
      textureMode: textureModeForScene(sceneOptions),
    };

    const animationState = {
      animation: selectedAnimation,
      animationPaused: sceneOptions.animationPaused,
      animationTimeScale: sceneOptions.animationTimeScale,
    };

    const interactionState = {
      interactive: sceneOptions.interactive,
      selection: sceneOptions.selection,
      hoverEffects: sceneOptions.hoverEffects,
      gizmoMode,
    };

    const cameraState = {
      autoRotate: sceneOptions.animate,
      autoCenter: sceneOptions.autoCenter,
      showAxes: sceneOptions.showAxes,
      dragMode: sceneOptions.dragMode,
      fpvLook: sceneOptions.fpvLook,
      fpvMove: sceneOptions.fpvMove,
      fpvJump: sceneOptions.fpvJump,
      fpvCrouch: sceneOptions.fpvCrouch,
      fpvMoveSpeed: sceneOptions.fpvMoveSpeed,
      fpvJumpVelocity: sceneOptions.fpvJumpVelocity,
      fpvGravity: sceneOptions.fpvGravity,
      fpvEyeHeight: sceneOptions.fpvEyeHeight,
      fpvCrouchHeight: sceneOptions.fpvCrouchHeight,
      fpvLookSensitivity: sceneOptions.fpvLookSensitivity,
      fpvInvertY: sceneOptions.fpvInvertY,
      projection: perspectiveMode,
      perspectivePx,
      zoom: sceneOptions.zoom,
      rotX: sceneOptions.rotX,
      rotY: sceneOptions.rotY,
      targetX: sceneOptions.target[0],
      targetY: sceneOptions.target[1],
      targetZ: sceneOptions.target[2],
    };

    const lightState = {
      showLight: sceneOptions.showLight,
      lightAzimuth: sceneOptions.lightAzimuth,
      lightElevation: sceneOptions.lightElevation,
      lightIntensity: sceneOptions.lightIntensity,
      lightColor: sceneOptions.lightColor,
      ambientIntensity: sceneOptions.ambientIntensity,
      ambientColor: sceneOptions.ambientColor,
      castShadow: sceneOptions.castShadow,
      showGround: sceneOptions.showGround,
    };

    const model = gui.addFolder("Model");
    model.open();
    const domCountController = disableWithoutDisabledClass(
      model.add(modelState, "domCount").name("DOM nodes"),
    );
    const spritesController = disableWithoutDisabledClass(
      model.add(modelState, "sprites").name("Sprites <s>"),
    );
    const shapeRectangleController = disableWithoutDisabledClass(
      model.add(modelState, "shapeRectangle").name(DEBUG_SHAPE_LABELS.rectangle),
    );
    const shapeTriangleController = disableWithoutDisabledClass(
      model.add(modelState, "shapeTriangle").name(DEBUG_SHAPE_LABELS.triangle),
    );
    const shapeIrregularController = disableWithoutDisabledClass(
      model.add(modelState, "shapeIrregular").name(DEBUG_SHAPE_LABELS.irregular),
    );

    function injectStrategyCheckbox(
      controller: { domElement?: HTMLElement } | undefined | null,
      strategy: PolyRenderStrategy,
    ): HTMLInputElement | null {
      const dom = controller?.domElement;
      const widget = dom?.querySelector?.<HTMLElement>(".widget");
      if (!widget) return null;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "dn-strategy-toggle";
      checkbox.checked = !disableStrategiesRef.current.includes(strategy);
      checkbox.addEventListener("change", () => {
        const current = disableStrategiesRef.current;
        onUpdateScene({
          disableStrategies: checkbox.checked
            ? current.filter((s) => s !== strategy)
            : [...current.filter((s) => s !== strategy), strategy],
        });
      });
      widget.appendChild(checkbox);
      return checkbox;
    }

    const bToggle = injectStrategyCheckbox(shapeRectangleController, "b");
    const uToggle = injectStrategyCheckbox(shapeTriangleController, "u");
    const iToggle = injectStrategyCheckbox(shapeIrregularController, "i");

    const rendering = gui.addFolder("Rendering");
    rendering.open();
    const meshResolutionController = rendering
      .add(modelState, "meshResolution", { Lossless: "lossless", Lossy: "lossy" })
      .name("Mesh resolution")
      .onChange((value: MeshResolution) => onUpdateScene({ meshResolution: value }));
    const meshInteriorFillController = rendering
      .add(modelState, "meshInteriorFill")
      .name("Interior fill")
      .onChange((value: boolean) => onUpdateScene({ meshInteriorFill: value }));
    const textureModeController = rendering
      .add(modelState, "textureMode", { disabled: "disabled", baked: "baked", dynamic: "dynamic" })
      .name("Texture")
      .onChange((value: TextureMode) => {
        if (value === "disabled") {
          onUpdateScene({ solidMaterials: true });
          return;
        }
        onUpdateScene({ solidMaterials: false, textureLighting: value });
      });

    const textureQualityController = rendering
      .add(modelState, "textureQualityValue", 0.1, 1, 0.05)
      .name("Texture quality")
      .onChange((value: number) => {
        // Touching the slider switches off Auto and commits the numeric value.
        modelState.textureQualityAuto = false;
        if (textureQualityAutoCheckbox) textureQualityAutoCheckbox.checked = false;
        onUpdateScene({ textureQuality: value });
      });

    let textureQualityAutoCheckbox: HTMLInputElement | null = null;
    function injectAutoToggle(
      controller: { domElement?: HTMLElement } | undefined | null,
    ): HTMLInputElement | null {
      const dom = controller?.domElement;
      const widget = dom?.querySelector?.<HTMLElement>(".widget");
      if (!widget) return null;
      // Layout matches the slider rows above (Azimuth / Elev / Key / Ambient):
      // [Texture quality (label)] [checkbox Auto] [slider] [number]. The
      // checkbox + label are injected at the START of the widget; lil-gui's
      // slider + value input occupy the rest of the row.
      const wrap = document.createElement("label");
      wrap.className = "dn-auto-toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = modelState.textureQualityAuto;
      const lbl = document.createElement("span");
      lbl.textContent = "Auto";
      wrap.appendChild(cb);
      wrap.appendChild(lbl);
      cb.addEventListener("change", () => {
        modelState.textureQualityAuto = cb.checked;
        if (cb.checked) {
          disableWithoutDisabledClass(textureQualityController);
          onUpdateScene({ textureQuality: "auto" });
        } else {
          textureQualityController.enable();
          onUpdateScene({ textureQuality: modelState.textureQualityValue });
        }
      });
      widget.insertBefore(wrap, widget.firstChild);
      if (modelState.textureQualityAuto) disableWithoutDisabledClass(textureQualityController);
      return cb;
    }
    textureQualityAutoCheckbox = injectAutoToggle(textureQualityController);
    if (!hasSpriteLeaves) {
      textureModeController.hide();
      textureQualityController.hide();
    }

    const animation = gui.addFolder("Animation");
    animation.open();
    const animationController = animation
      .add(animationState, "animation", animationOptions)
      .name("Sequence")
      .onChange((value: string) => {
        onAnimationChange(value);
        onResetAnimatedPolygons();
      });
    const animationPausedController = animation
      .add(animationState, "animationPaused")
      .name("Paused")
      .onChange((value: boolean) => onUpdateScene({ animationPaused: value }));
    const animationTimeScaleController = animation
      .add(animationState, "animationTimeScale", -3, 3, 0.05)
      .name("Playback speed")
      .onChange((value: number) => onUpdateScene({ animationTimeScale: value }));

    const interaction = gui.addFolder("Interaction");
    const interactiveController = interaction
      .add(interactionState, "interactive")
      .name("Scene interactive")
      .onChange((value: boolean) => onUpdateScene({ interactive: value }));
    const hoverController = interaction
      .add(interactionState, "hoverEffects")
      .name("Mesh hover")
      .onChange((value: boolean) => onUpdateScene({ hoverEffects: value }));
    const selectionController = interaction
      .add(interactionState, "selection")
      .name("Mesh selection")
      .onChange((value: boolean) => onUpdateScene({ selection: value }));
    const gizmoController = interaction
      .add(interactionState, "gizmoMode", { translate: "translate", rotate: "rotate" })
      .name("Gizmo")
      .onChange((value: GizmoMode) => onGizmoModeChange(value));

    const camera = gui.addFolder("Camera");
    camera.close();
    camera
      .add({ resetCamera: () => {
        const resetZoom = loaded ? defaultZoomForModel(selectedPreset, loaded.rawPolygons) : selectedPreset.zoom ?? 0.35;
        onUpdateScene({
          zoom: resetZoom,
          rotX: selectedPreset.rotX ?? 65,
          rotY: selectedPreset.rotY ?? 45,
          target: [0, 0, 0],
        });
      } }, "resetCamera")
      .name("Reset camera");
    const autoCenterController = camera
      .add(cameraState, "autoCenter")
      .name("Auto center")
      .onChange((value: boolean) => onUpdateScene({ autoCenter: value }));
    const axesController = camera
      .add(cameraState, "showAxes")
      .name("Axes")
      .onChange((value: boolean) => onUpdateScene({ showAxes: value }));
    const autoRotateController = camera
      .add(cameraState, "autoRotate")
      .name("Auto rotate")
      .onChange((value: boolean) => onUpdateScene({ animate: value }));
    const dragModeController = camera
      .add(cameraState, "dragMode", { Orbit: "orbit", Pan: "pan", FPV: "fpv" })
      .name("Drag")
      .onChange((value: DragMode) => onUpdateScene({ dragMode: value }));
    const fpvFolder = camera.addFolder("FPV");
    fpvFolder.close();
    const fpvLookController = fpvFolder
      .add(cameraState, "fpvLook")
      .name("Look")
      .onChange((value: boolean) => onUpdateScene({ fpvLook: value }));
    const fpvMoveController = fpvFolder
      .add(cameraState, "fpvMove")
      .name("Move")
      .onChange((value: boolean) => onUpdateScene({ fpvMove: value }));
    const fpvJumpController = fpvFolder
      .add(cameraState, "fpvJump")
      .name("Jump")
      .onChange((value: boolean) => onUpdateScene({ fpvJump: value }));
    const fpvCrouchController = fpvFolder
      .add(cameraState, "fpvCrouch")
      .name("Crouch")
      .onChange((value: boolean) => onUpdateScene({ fpvCrouch: value }));
    const fpvMoveSpeedController = fpvFolder
      .add(cameraState, "fpvMoveSpeed", 1, 300, 1)
      .name("Move speed")
      .onChange((value: number) => onUpdateScene({ fpvMoveSpeed: value }));
    const fpvJumpVelocityController = fpvFolder
      .add(cameraState, "fpvJumpVelocity", 1, 200, 1)
      .name("Jump velocity")
      .onChange((value: number) => onUpdateScene({ fpvJumpVelocity: value }));
    const fpvGravityController = fpvFolder
      .add(cameraState, "fpvGravity", 1, 500, 1)
      .name("Gravity")
      .onChange((value: number) => onUpdateScene({ fpvGravity: value }));
    const fpvEyeHeightController = fpvFolder
      .add(cameraState, "fpvEyeHeight", 0.1, 100, 0.5)
      .name("Eye height")
      .onChange((value: number) => onUpdateScene({ fpvEyeHeight: value }));
    const fpvCrouchHeightController = fpvFolder
      .add(cameraState, "fpvCrouchHeight", 0.1, 100, 0.5)
      .name("Crouch height")
      .onChange((value: number) => onUpdateScene({ fpvCrouchHeight: value }));
    const fpvLookSensitivityController = fpvFolder
      .add(cameraState, "fpvLookSensitivity", 0.02, 1, 0.01)
      .name("Look sensitivity")
      .onChange((value: number) => onUpdateScene({ fpvLookSensitivity: value }));
    const fpvInvertYController = fpvFolder
      .add(cameraState, "fpvInvertY")
      .name("Invert Y")
      .onChange((value: boolean) => onUpdateScene({ fpvInvertY: value }));
    const projectionController = camera
      .add(cameraState, "projection", { Perspective: "perspective", Orthographic: "orthographic" })
      .name("Projection")
      .onChange((value: PerspectiveMode) => {
        onUpdateScene({ perspective: value === "perspective" ? cameraState.perspectivePx : false });
      });
    const perspectivePxController = camera
      .add(cameraState, "perspectivePx", {
        "500 px": 500,
        "1000 px": 1000,
        "2000 px": 2000,
        "4000 px": 4000,
        "8000 px": 8000,
        "16000 px": 16000,
        "32000 px": 32000,
        "64000 px": 64000,
      })
      .name("Perspective px")
      .onChange((value: number) => onUpdateScene({ perspective: value }));
    const zoomController = camera
      .add(cameraState, "zoom", 0.05, 2.5, 0.01)
      .name("Zoom")
      .onChange((value: number) => onUpdateScene({ zoom: value }));
    const rotXController = camera
      .add(cameraState, "rotX", 0, 100, 1)
      .name("Rot X")
      .onChange((value: number) => onUpdateScene({ rotX: value }));
    const rotYController = camera
      .add(cameraState, "rotY", 0, 360, 1)
      .name("Rot Y")
      .onChange((value: number) => onUpdateScene({ rotY: value }));
    const targetXController = camera
      .add(cameraState, "targetX", -50, 50, 0.1)
      .name("Target X")
      .onChange((value: number) => onUpdateScene({ target: [value, cameraState.targetY, cameraState.targetZ] }));
    const targetYController = camera
      .add(cameraState, "targetY", -50, 50, 0.1)
      .name("Target Y")
      .onChange((value: number) => onUpdateScene({ target: [cameraState.targetX, value, cameraState.targetZ] }));
    const targetZController = camera
      .add(cameraState, "targetZ", -50, 50, 0.1)
      .name("Target Z")
      .onChange((value: number) => onUpdateScene({ target: [cameraState.targetX, cameraState.targetY, value] }));

    const lights = gui.addFolder("Lighting");
    lights.open();
    const castShadowController = lights
      .add(lightState, "castShadow")
      .name("Cast shadow")
      .onChange((value: boolean) => onUpdateScene({ castShadow: value }));
    const showGroundController = lights
      .add(lightState, "showGround")
      .name("Show ground")
      .onChange((value: boolean) => onUpdateScene({ showGround: value }));
    const lightController = lights
      .add(lightState, "showLight")
      .name("Light helper")
      .onChange((value: boolean) => onUpdateScene({ showLight: value }));
    const azimuthController = lights
      .add(lightState, "lightAzimuth", 0, 360, 1)
      .name("Azimuth")
      .onChange((value: number) => onUpdateScene({ lightAzimuth: value }));
    const elevationController = lights
      .add(lightState, "lightElevation", -90, 90, 1)
      .name("Elev.")
      .onChange((value: number) => onUpdateScene({ lightElevation: value }));
    const intensityController = lights
      .add(lightState, "lightIntensity", 0, 2, 0.05)
      .name("Key")
      .onChange((value: number) => onUpdateScene({ lightIntensity: value }));
    const keyColorController = lights
      .addColor(lightState, "lightColor")
      .name("Key color")
      .onChange((value: string) => onUpdateScene({ lightColor: value }));
    const ambientIntensityController = lights
      .add(lightState, "ambientIntensity", 0, 2, 0.05)
      .name("Ambient")
      .onChange((value: number) => onUpdateScene({ ambientIntensity: value }));
    const ambientColorController = lights
      .addColor(lightState, "ambientColor")
      .name("Amb. color")
      .onChange((value: string) => onUpdateScene({ ambientColor: value }));

    if (sceneOptions.perspective === false) {
      perspectivePxController.hide();
    }
    if (activeAnimation) {
      meshResolutionController.disable();
      meshInteriorFillController.disable();
    }
    if (!sceneOptions.selection) {
      gizmoController.disable();
    }
    if (animationClipCount === 0) {
      animation.hide();
      animationController.disable();
      animationPausedController.disable();
      animationTimeScaleController.disable();
    }

    guiControllersRef.current = {
      animation: animationController,
      animationPaused: animationPausedController,
      animationTimeScale: animationTimeScaleController,
      domCount: domCountController,
      sprites: spritesController,
      shapeRectangle: shapeRectangleController,
      shapeTriangle: shapeTriangleController,
      shapeIrregular: shapeIrregularController,
      bToggle,
      uToggle,
      iToggle,
      meshResolution: meshResolutionController,
      meshInteriorFill: meshInteriorFillController,
      textureQuality: textureQualityController,
      textureQualityAutoCheckbox,
      interactive: interactiveController,
      autoRotate: autoRotateController,
      selection: selectionController,
      hoverEffects: hoverController,
      gizmoMode: gizmoController,
      textureMode: textureModeController,
      autoCenter: autoCenterController,
      showAxes: axesController,
      dragMode: dragModeController,
      fpvLook: fpvLookController,
      fpvMove: fpvMoveController,
      fpvJump: fpvJumpController,
      fpvCrouch: fpvCrouchController,
      fpvMoveSpeed: fpvMoveSpeedController,
      fpvJumpVelocity: fpvJumpVelocityController,
      fpvGravity: fpvGravityController,
      fpvEyeHeight: fpvEyeHeightController,
      fpvCrouchHeight: fpvCrouchHeightController,
      fpvLookSensitivity: fpvLookSensitivityController,
      fpvInvertY: fpvInvertYController,
      fpvFolder,
      projection: projectionController,
      perspectivePx: perspectivePxController,
      zoom: zoomController,
      rotX: rotXController,
      rotY: rotYController,
      targetX: targetXController,
      targetY: targetYController,
      targetZ: targetZController,
      castShadow: castShadowController,
      showGround: showGroundController,
      showLight: lightController,
      lightAzimuth: azimuthController,
      lightElevation: elevationController,
      lightIntensity: intensityController,
      lightColor: keyColorController,
      ambientIntensity: ambientIntensityController,
      ambientColor: ambientColorController,
      modelState,
      animationState,
      animationFolder: animation,
      interactionState,
      cameraState,
      lightState,
    };

    return () => {
      gui.destroy();
      guiRef.current = null;
      guiControllersRef.current = {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync effect — keeps lil-gui in sync with React state on every prop change.
  useEffect(() => {
    const controllers = guiControllersRef.current;
    if (!guiRef.current || !controllers.modelState) return;

    const setCtrlValue = (key: string, value: unknown) => {
      const controller = controllers[key] as { object: Record<string, unknown>; updateDisplay: () => void } | undefined;
      if (!controller?.object) return;
      const stateKey = key;
      if (controller.object[stateKey] === value) return;
      controller.object[stateKey] = value;
      controller.updateDisplay();
    };
    const setEnabled = (key: string, enabled: boolean) => {
      const controller = controllers[key] as { disable: () => void; enable: () => void } | undefined;
      if (!controller?.disable || !controller?.enable) return;
      if (enabled) controller.enable();
      else controller.disable();
    };
    const setVisible = (key: string, visible: boolean) => {
      const controller = controllers[key] as { hide: () => void; show: () => void } | undefined;
      if (!controller?.hide || !controller?.show) return;
      if (visible) controller.show();
      else controller.hide();
    };

    setCtrlValue("animation", selectedAnimation);
    setCtrlValue("animationPaused", sceneOptions.animationPaused);
    setCtrlValue("animationTimeScale", sceneOptions.animationTimeScale);
    setCtrlValue("meshResolution", sceneOptions.meshResolution);
    setCtrlValue("meshInteriorFill", sceneOptions.meshInteriorFill);
    setCtrlValue("textureMode", textureModeForScene(sceneOptions));
    setVisible("textureMode", hasSpriteLeaves);
    setVisible("textureQuality", hasSpriteLeaves);
    setCtrlValue("domCount", metrics.nodeCount);
    setCtrlValue("sprites", metrics.sprites);
    setCtrlValue("shapeRectangle", metrics.rects);
    setCtrlValue("shapeTriangle", metrics.triangles);
    setCtrlValue("shapeIrregular", metrics.irregular);
    const bToggleEl = controllers.bToggle as HTMLInputElement | undefined;
    const uToggleEl = controllers.uToggle as HTMLInputElement | undefined;
    const iToggleEl = controllers.iToggle as HTMLInputElement | undefined;
    if (bToggleEl) bToggleEl.checked = !sceneOptions.disableStrategies.includes("b");
    if (uToggleEl) uToggleEl.checked = !sceneOptions.disableStrategies.includes("u");
    if (iToggleEl) iToggleEl.checked = !sceneOptions.disableStrategies.includes("i");

    const validAnimation = Object.values(animationOptions).includes(selectedAnimation);
    const nextAnimation = validAnimation ? selectedAnimation : "";
    setCtrlValue("animation", nextAnimation);
    const animationController = controllers.animation as { options: (opts: Record<string, string>) => void } | undefined;
    animationController?.options(animationOptions);
    const animationFolder = controllers.animationFolder as { show: (show?: boolean) => void } | undefined;
    animationFolder?.show(animationClipCount > 0);
    if (animationController) {
      setEnabled("animation", animationClipCount > 0);
      setEnabled("animationPaused", animationClipCount > 0);
      setEnabled("animationTimeScale", animationClipCount > 0);
      if (!validAnimation && selectedAnimation !== "") {
        onSelectAnimationClear();
      }
    }

    setCtrlValue("interactive", sceneOptions.interactive);
    setCtrlValue("autoRotate", sceneOptions.animate);
    setCtrlValue("selection", sceneOptions.selection);
    setCtrlValue("hoverEffects", sceneOptions.hoverEffects);
    setCtrlValue("gizmoMode", gizmoMode);

    setCtrlValue("autoCenter", sceneOptions.autoCenter);
    setCtrlValue("showAxes", sceneOptions.showAxes);
    setCtrlValue("castShadow", sceneOptions.castShadow);
    setCtrlValue("showGround", sceneOptions.showGround);

    setCtrlValue("dragMode", sceneOptions.dragMode);
    setCtrlValue("fpvLook", sceneOptions.fpvLook);
    setCtrlValue("fpvMove", sceneOptions.fpvMove);
    setCtrlValue("fpvJump", sceneOptions.fpvJump);
    setCtrlValue("fpvCrouch", sceneOptions.fpvCrouch);
    setCtrlValue("fpvMoveSpeed", sceneOptions.fpvMoveSpeed);
    setCtrlValue("fpvJumpVelocity", sceneOptions.fpvJumpVelocity);
    setCtrlValue("fpvGravity", sceneOptions.fpvGravity);
    setCtrlValue("fpvEyeHeight", sceneOptions.fpvEyeHeight);
    setCtrlValue("fpvCrouchHeight", sceneOptions.fpvCrouchHeight);
    setCtrlValue("fpvLookSensitivity", sceneOptions.fpvLookSensitivity);
    setCtrlValue("fpvInvertY", sceneOptions.fpvInvertY);
    const isFpv = sceneOptions.dragMode === "fpv";
    setEnabled("fpvLook", isFpv);
    setEnabled("fpvMove", isFpv);
    setEnabled("fpvJump", isFpv);
    setEnabled("fpvCrouch", isFpv);
    setEnabled("fpvMoveSpeed", isFpv);
    setEnabled("fpvJumpVelocity", isFpv);
    setEnabled("fpvGravity", isFpv);
    setEnabled("fpvEyeHeight", isFpv);
    setEnabled("fpvCrouchHeight", isFpv);
    setEnabled("fpvLookSensitivity", isFpv);
    setEnabled("fpvInvertY", isFpv);
    setCtrlValue("projection", perspectiveMode);
    setCtrlValue("perspectivePx", perspectivePx);
    setCtrlValue("zoom", sceneOptions.zoom);
    setCtrlValue("rotX", sceneOptions.rotX);
    setCtrlValue("rotY", sceneOptions.rotY);
    setCtrlValue("targetX", sceneOptions.target[0]);
    setCtrlValue("targetY", sceneOptions.target[1]);
    setCtrlValue("targetZ", sceneOptions.target[2]);

    setCtrlValue("showLight", sceneOptions.showLight);
    setCtrlValue("lightAzimuth", sceneOptions.lightAzimuth);
    setCtrlValue("lightElevation", sceneOptions.lightElevation);
    setCtrlValue("lightIntensity", sceneOptions.lightIntensity);
    setCtrlValue("lightColor", sceneOptions.lightColor);
    setCtrlValue("ambientIntensity", sceneOptions.ambientIntensity);
    setCtrlValue("ambientColor", sceneOptions.ambientColor);

    setEnabled("meshResolution", !hasActiveAnimation);
    setEnabled("meshInteriorFill", !hasActiveAnimation);
    setEnabled("gizmoMode", sceneOptions.selection);

    if (sceneOptions.perspective === false) {
      (controllers.perspectivePx as { hide: () => void })?.hide();
    } else {
      (controllers.perspectivePx as { show: () => void })?.show();
    }

    const modelState = controllers.modelState as {
      meshResolution?: MeshResolution;
      meshInteriorFill?: boolean;
      domCount?: number;
      sprites?: number;
      shapeRectangle?: number;
      shapeTriangle?: number;
      shapeIrregular?: number;
      textureQualityValue?: number;
      textureQualityAuto?: boolean;
      textureMode?: TextureMode;
    };
    if (modelState) {
      modelState.meshResolution = sceneOptions.meshResolution;
      modelState.meshInteriorFill = sceneOptions.meshInteriorFill;
      modelState.domCount = metrics.nodeCount;
      modelState.sprites = metrics.sprites;
      modelState.shapeRectangle = metrics.rects;
      modelState.shapeTriangle = metrics.triangles;
      modelState.shapeIrregular = metrics.irregular;
      modelState.textureMode = textureModeForScene(sceneOptions);
      // Mirror external textureQuality changes back into the slider state.
      // Numeric → slider value + auto off (slider enabled); "auto" → keep
      // last numeric value, auto on (slider disabled). User unchecks Auto
      // first to drag the slider — explicit mode switch.
      const tq = sceneOptions.textureQuality;
      const nextAuto = tq === "auto";
      modelState.textureQualityAuto = nextAuto;
      if (typeof tq === "number") modelState.textureQualityValue = tq;
      const tqCb = controllers.textureQualityAutoCheckbox as HTMLInputElement | undefined;
      const tqCtl = controllers.textureQuality as Controller | undefined;
      if (tqCb) tqCb.checked = nextAuto;
      if (tqCtl) {
        if (nextAuto) disableWithoutDisabledClass(tqCtl);
        else tqCtl.enable();
      }
    }
    const animationState = controllers.animationState as {
      animation?: string;
      animationPaused?: boolean;
      animationTimeScale?: number;
    };
    if (animationState) {
      animationState.animation = nextAnimation;
      animationState.animationPaused = sceneOptions.animationPaused;
      animationState.animationTimeScale = sceneOptions.animationTimeScale;
    }
    const interactionState = controllers.interactionState as {
      interactive?: boolean;
      selection?: boolean;
      hoverEffects?: boolean;
      gizmoMode?: GizmoMode;
    };
    if (interactionState) {
      interactionState.interactive = sceneOptions.interactive;
      interactionState.selection = sceneOptions.selection;
      interactionState.hoverEffects = sceneOptions.hoverEffects;
      interactionState.gizmoMode = gizmoMode;
    }
    const cameraState = controllers.cameraState as {
      autoRotate?: boolean;
      autoCenter?: boolean;
      showAxes?: boolean;
      dragMode?: DragMode;
      fpvLook?: boolean;
      fpvMove?: boolean;
      fpvJump?: boolean;
      fpvCrouch?: boolean;
      fpvMoveSpeed?: number;
      fpvJumpVelocity?: number;
      fpvGravity?: number;
      fpvEyeHeight?: number;
      fpvCrouchHeight?: number;
      fpvLookSensitivity?: number;
      fpvInvertY?: boolean;
      projection?: PerspectiveMode;
      perspectivePx?: number;
      zoom?: number;
      rotX?: number;
      rotY?: number;
      targetX?: number;
      targetY?: number;
      targetZ?: number;
    };
    if (cameraState) {
      cameraState.autoRotate = sceneOptions.animate;
      cameraState.autoCenter = sceneOptions.autoCenter;
      cameraState.showAxes = sceneOptions.showAxes;
      cameraState.dragMode = sceneOptions.dragMode;
      cameraState.fpvLook = sceneOptions.fpvLook;
      cameraState.fpvMove = sceneOptions.fpvMove;
      cameraState.fpvJump = sceneOptions.fpvJump;
      cameraState.fpvCrouch = sceneOptions.fpvCrouch;
      cameraState.fpvMoveSpeed = sceneOptions.fpvMoveSpeed;
      cameraState.fpvJumpVelocity = sceneOptions.fpvJumpVelocity;
      cameraState.fpvGravity = sceneOptions.fpvGravity;
      cameraState.fpvEyeHeight = sceneOptions.fpvEyeHeight;
      cameraState.fpvCrouchHeight = sceneOptions.fpvCrouchHeight;
      cameraState.fpvLookSensitivity = sceneOptions.fpvLookSensitivity;
      cameraState.fpvInvertY = sceneOptions.fpvInvertY;
      cameraState.projection = perspectiveMode;
      cameraState.perspectivePx = perspectivePx;
      cameraState.zoom = sceneOptions.zoom;
      cameraState.rotX = sceneOptions.rotX;
      cameraState.rotY = sceneOptions.rotY;
      cameraState.targetX = sceneOptions.target[0];
      cameraState.targetY = sceneOptions.target[1];
      cameraState.targetZ = sceneOptions.target[2];
    }
    const lightState = controllers.lightState as {
      showLight?: boolean;
      lightAzimuth?: number;
      lightElevation?: number;
      lightIntensity?: number;
      lightColor?: string;
      ambientIntensity?: number;
      ambientColor?: string;
      castShadow?: boolean;
      showGround?: boolean;
    };
    if (lightState) {
      lightState.showLight = sceneOptions.showLight;
      lightState.lightAzimuth = sceneOptions.lightAzimuth;
      lightState.lightElevation = sceneOptions.lightElevation;
      lightState.lightIntensity = sceneOptions.lightIntensity;
      lightState.lightColor = sceneOptions.lightColor;
      lightState.ambientIntensity = sceneOptions.ambientIntensity;
      lightState.ambientColor = sceneOptions.ambientColor;
      lightState.castShadow = sceneOptions.castShadow;
      lightState.showGround = sceneOptions.showGround;
    }
  });

  return (
    <div className="dn-floating-controls">
      <div ref={guiHostRef} />
      {loading && <p className="dn-note">Loading model...</p>}
      {loadError && <p className="dn-note dn-note--error">{loadError}</p>}
    </div>
  );
}
