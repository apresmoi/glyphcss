import { useEffect, type ReactNode } from "react";
import type { GUI } from "lil-gui";
import type { GlyphEffectId } from "@glyphcss/effects";
import type {
  GalleryEffectDefinition,
  GalleryEffectNumberParamSpec,
  GalleryEffectParamSpec,
} from "../../GalleryWorkbench/effects";
import { galleryEffectParamsAreValid } from "../../GalleryWorkbench/effects";
import type {
  GalleryEffectBlend,
  GalleryEffectParamValue,
  GalleryEffectState,
} from "../../GalleryWorkbench/types";
import {
  useColor,
  useFolder,
  useOption,
  useSlider,
  useText,
  useToggle,
} from "../primitives";

export interface EffectsFolderInputs {
  effectState: GalleryEffectState;
  definition: GalleryEffectDefinition | null;
  effectOptions: Record<string, string>;
  onEffectChange: (effectId: GlyphEffectId | null) => void;
  onUpdateSettings: (partial: Partial<Pick<GalleryEffectState, "blend" | "paused" | "timeScale">>) => void;
  onUpdateParams: (partial: Record<string, GalleryEffectParamValue>) => void;
}

const BLEND_OPTIONS: Record<string, GalleryEffectBlend> = {
  "Full texture": "replace",
  Overlay: "over",
};

function paramLabel(name: string, spec: GalleryEffectParamSpec): string {
  if (spec.label) return spec.label;
  const label = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
  return spec.kind === "number" && spec.unit ? `${label} (${spec.unit})` : label;
}

function numberRange(spec: GalleryEffectNumberParamSpec): { min: number; max: number; step: number } {
  const magnitude = Math.max(Math.abs(spec.default), 1);
  const min = Number.isFinite(spec.min) ? spec.min! : Math.min(0, spec.default - magnitude * 2);
  const max = Number.isFinite(spec.max) ? spec.max! : Math.max(1, spec.default + magnitude * 2);
  const span = Math.max(max - min, 0.001);
  return { min, max, step: spec.step ?? span / 100 };
}

function NumberParamControl({
  folder,
  name,
  spec,
  value,
  onUpdate,
}: {
  folder: GUI | null;
  name: string;
  spec: GalleryEffectNumberParamSpec;
  value: number;
  onUpdate: (value: GalleryEffectParamValue) => void;
}): null {
  useSlider(folder, paramLabel(name, spec), numberRange(spec), value, onUpdate);
  return null;
}

function BooleanParamControl({
  folder,
  name,
  spec,
  value,
  onUpdate,
}: {
  folder: GUI | null;
  name: string;
  spec: Extract<GalleryEffectParamSpec, { kind: "boolean" }>;
  value: boolean;
  onUpdate: (value: GalleryEffectParamValue) => void;
}): null {
  useToggle(folder, paramLabel(name, spec), value, onUpdate);
  return null;
}

function ColorParamControl({
  folder,
  name,
  spec,
  value,
  onUpdate,
}: {
  folder: GUI | null;
  name: string;
  spec: Extract<GalleryEffectParamSpec, { kind: "color" }>;
  value: string;
  onUpdate: (value: GalleryEffectParamValue) => void;
}): null {
  useColor(folder, paramLabel(name, spec), value, onUpdate);
  return null;
}

function TextParamControl({
  folder,
  name,
  spec,
  value,
  onUpdate,
  isValid,
}: {
  folder: GUI | null;
  name: string;
  spec: Extract<GalleryEffectParamSpec, { kind: "string" }>;
  value: string;
  onUpdate: (value: GalleryEffectParamValue) => void;
  isValid: (value: string) => boolean;
}): null {
  useText(folder, paramLabel(name, spec), value, onUpdate, isValid);
  return null;
}

function EnumParamControl({
  folder,
  name,
  spec,
  value,
  onUpdate,
}: {
  folder: GUI | null;
  name: string;
  spec: Extract<GalleryEffectParamSpec, { kind: "string" }>;
  value: string;
  onUpdate: (value: GalleryEffectParamValue) => void;
}): null {
  const values = Object.fromEntries((spec.values ?? []).map((option) => [option, option]));
  useOption(folder, paramLabel(name, spec), values, value, onUpdate);
  return null;
}

function EffectParamControl({
  folder,
  effectId,
  name,
  spec,
  value,
  definition,
  params,
  onUpdateParams,
}: {
  folder: GUI | null;
  effectId: GlyphEffectId;
  name: string;
  spec: GalleryEffectParamSpec;
  value: GalleryEffectParamValue;
  definition: GalleryEffectDefinition;
  params: Readonly<Record<string, GalleryEffectParamValue>>;
  onUpdateParams: (partial: Record<string, GalleryEffectParamValue>) => void;
}): ReactNode {
  const onUpdate = (next: GalleryEffectParamValue) => onUpdateParams({ [name]: next });
  const key = `${effectId}:${name}:${spec.kind}`;
  if (spec.kind === "number") {
    return <NumberParamControl key={key} folder={folder} name={name} spec={spec} value={typeof value === "number" ? value : spec.default} onUpdate={onUpdate} />;
  }
  if (spec.kind === "boolean") {
    return <BooleanParamControl key={key} folder={folder} name={name} spec={spec} value={typeof value === "boolean" ? value : spec.default} onUpdate={onUpdate} />;
  }
  if (spec.kind === "color") {
    return <ColorParamControl key={key} folder={folder} name={name} spec={spec} value={typeof value === "string" ? value : spec.default} onUpdate={onUpdate} />;
  }
  if (spec.values?.length) {
    return <EnumParamControl key={key} folder={folder} name={name} spec={spec} value={typeof value === "string" ? value : spec.default} onUpdate={onUpdate} />;
  }
  return (
    <TextParamControl
      key={key}
      folder={folder}
      name={name}
      spec={spec}
      value={typeof value === "string" ? value : spec.default}
      onUpdate={onUpdate}
      isValid={(next) => galleryEffectParamsAreValid(definition, { ...params, [name]: next })}
    />
  );
}

export function useEffectsFolder(parent: GUI | null, inputs: EffectsFolderInputs): GUI | null {
  const {
    effectState,
    effectOptions,
    definition,
    onEffectChange,
    onUpdateSettings,
  } = inputs;
  const folder = useFolder(parent, "Effects", { open: true });
  const effectController = useOption(
    folder,
    "Effect",
    effectOptions,
    effectState.effectId ?? "",
    (value) => onEffectChange(value ? value as GlyphEffectId : null),
  );
  const blendController = useOption(folder, "Composition", BLEND_OPTIONS, effectState.blend, (blend) =>
    onUpdateSettings({ blend }),
  );
  const pausedController = useToggle(folder, "Paused", effectState.paused, (paused) =>
    onUpdateSettings({ paused }),
  );
  const speedController = useSlider(folder, "Playback speed", { min: 0.05, max: 8, step: 0.05 }, effectState.timeScale, (timeScale) =>
    onUpdateSettings({ timeScale }),
  );

  useEffect(() => {
    effectController?.setEnabled(true);
    const active = effectState.effectId !== null;
    const hasTimeline = active && !!definition && "time" in definition.parameterSchema;
    blendController?.setEnabled(active, { dim: true });
    pausedController?.setEnabled(hasTimeline, { dim: true });
    speedController?.setEnabled(hasTimeline, { dim: true });
  }, [
    effectController,
    blendController,
    pausedController,
    speedController,
    effectState.effectId,
    definition,
  ]);

  return effectController && blendController && pausedController && speedController
    ? folder
    : null;
}

export function EffectParameterControls({
  folder,
  inputs,
}: {
  folder: GUI | null;
  inputs: EffectsFolderInputs;
}): ReactNode {
  const { definition, effectState, onUpdateParams } = inputs;
  if (!definition || !effectState.effectId) return null;
  return Object.entries(definition.parameterSchema)
    .filter(([, spec]) => !spec.hidden)
    .map(([name, spec]) => (
      <EffectParamControl
        key={`${effectState.effectId}:${name}:${spec.kind}`}
        folder={folder}
        effectId={effectState.effectId!}
        name={name}
        spec={spec}
        value={effectState.params[name] ?? spec.default}
        definition={definition}
        params={effectState.params}
        onUpdateParams={onUpdateParams}
      />
    ));
}
