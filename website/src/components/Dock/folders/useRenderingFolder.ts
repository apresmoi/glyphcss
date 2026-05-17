/**
 * "Rendering" folder of the Dock GUI.
 *
 * Mesh resolution + Interior fill toggles, plus a single "Texture mode"
 * dropdown that collapses the old separate Solid-materials toggle and
 * Texture-lighting selector into one row (disabled | baked | dynamic).
 *
 * Texture quality is a slider with an Auto checkbox injected inside the
 * slider's `.widget`. Auto handling: the React-side `textureQuality` value
 * is either the string `"auto"` or a number in [0.1, 1]. The slider always
 * needs *some* numeric value to display, so we remember the last numeric
 * value in a ref and use that whenever the effective value is `"auto"`.
 * Touching the slider commits the number (implicitly clears Auto).
 *
 * Texture mode + quality are both hidden when `hasSpriteLeaves` is false —
 * a model with no atlas leaves has nothing for these controls to affect.
 */
import { useEffect, useRef } from "react";
import type { GUI } from "lil-gui";
import type { MeshResolution, PolyTextureLightingMode } from "@layoutit/polycss-react";

import { useFolder, useOption, useSlider, useToggle } from "../primitives";

export type TextureMode = "disabled" | PolyTextureLightingMode;

export interface RenderingFolderInputs {
  meshResolution: MeshResolution;
  meshInteriorFill: boolean;
  solidMaterials: boolean;
  textureLighting: PolyTextureLightingMode;
  /** Either "auto" or a number in [0.1, 1]. */
  textureQuality: "auto" | number;
  hasActiveAnimation: boolean;
  hasSpriteLeaves: boolean;
  onUpdateScene: (partial: {
    meshResolution?: MeshResolution;
    meshInteriorFill?: boolean;
    solidMaterials?: boolean;
    textureLighting?: PolyTextureLightingMode;
    textureQuality?: "auto" | number;
  }) => void;
}

const MESH_RESOLUTION_OPTIONS: Record<string, MeshResolution> = {
  Lossless: "lossless",
  Lossy: "lossy",
};

const TEXTURE_MODE_OPTIONS: Record<string, TextureMode> = {
  disabled: "disabled",
  baked: "baked",
  dynamic: "dynamic",
};

function textureModeFor(solidMaterials: boolean, textureLighting: PolyTextureLightingMode): TextureMode {
  return solidMaterials ? "disabled" : textureLighting;
}

export function useRenderingFolder(parent: GUI | null, inputs: RenderingFolderInputs): void {
  const {
    meshResolution,
    meshInteriorFill,
    solidMaterials,
    textureLighting,
    textureQuality,
    hasActiveAnimation,
    hasSpriteLeaves,
    onUpdateScene,
  } = inputs;

  const folder = useFolder(parent, "Rendering");

  const isAuto = textureQuality === "auto";

  const lastNumericRef = useRef<number>(typeof textureQuality === "number" ? textureQuality : 1);
  if (typeof textureQuality === "number") lastNumericRef.current = textureQuality;
  const sliderValue = typeof textureQuality === "number" ? textureQuality : lastNumericRef.current;

  const meshResolutionCtrl = useOption(
    folder,
    "Mesh resolution",
    MESH_RESOLUTION_OPTIONS,
    meshResolution,
    (value) => onUpdateScene({ meshResolution: value }),
  );

  const meshInteriorFillCtrl = useToggle(folder, "Interior fill", meshInteriorFill, (value) =>
    onUpdateScene({ meshInteriorFill: value }),
  );

  const textureMode = textureModeFor(solidMaterials, textureLighting);
  const textureModeCtrl = useOption<TextureMode>(
    folder,
    "Texture mode",
    TEXTURE_MODE_OPTIONS,
    textureMode,
    (value) => {
      if (value === "disabled") {
        onUpdateScene({ solidMaterials: true });
        return;
      }
      onUpdateScene({ solidMaterials: false, textureLighting: value });
    },
  );

  const textureQualityCtrl = useSlider(
    folder,
    "Texture quality",
    { min: 0.1, max: 1, step: 0.05 },
    sliderValue,
    (value) => {
      lastNumericRef.current = value;
      onUpdateScene({ textureQuality: value });
    },
  );

  const onUpdateSceneRef = useRef(onUpdateScene);
  onUpdateSceneRef.current = onUpdateScene;

  useEffect(() => {
    meshResolutionCtrl?.setEnabled(!hasActiveAnimation);
    meshInteriorFillCtrl?.setEnabled(!hasActiveAnimation);
  }, [meshResolutionCtrl, meshInteriorFillCtrl, hasActiveAnimation]);

  useEffect(() => {
    textureModeCtrl?.setVisible(hasSpriteLeaves);
    textureQualityCtrl?.setVisible(hasSpriteLeaves);
  }, [textureModeCtrl, textureQualityCtrl, hasSpriteLeaves]);

  const autoCheckboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!textureQualityCtrl) return;
    const widget = textureQualityCtrl.raw.domElement.querySelector<HTMLElement>(".widget");
    if (!widget) return;

    const wrap = document.createElement("label");
    wrap.className = "dn-auto-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    const lbl = document.createElement("span");
    lbl.textContent = "Auto";
    wrap.appendChild(cb);
    wrap.appendChild(lbl);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        onUpdateSceneRef.current({ textureQuality: "auto" });
      } else {
        onUpdateSceneRef.current({ textureQuality: lastNumericRef.current });
      }
    });
    widget.insertBefore(wrap, widget.firstChild);
    autoCheckboxRef.current = cb;

    return () => {
      wrap.remove();
      autoCheckboxRef.current = null;
    };
  }, [textureQualityCtrl]);

  useEffect(() => {
    if (autoCheckboxRef.current) autoCheckboxRef.current.checked = isAuto;
    textureQualityCtrl?.setEnabled(!isAuto, { dim: false });
  }, [textureQualityCtrl, isAuto]);
}
