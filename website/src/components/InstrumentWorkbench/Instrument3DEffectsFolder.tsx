import { useEffect } from "react";
import type { GUI } from "lil-gui";
import { useFolder, useOption } from "../Dock/primitives";

/**
 * Shared "Effects" Dock folder for a live 3D viewport (D3 fix round 1,
 * P1-2 — PLAN-3d.md §8's Effects folder). Deliberately free of any
 * diagram/chart specifics: it takes a plain effect-id list and a plain
 * TARGETS list (one row per thing an effect can be mesh-targeted at — a
 * diagram's `node:<id>` meshes today, a chart's own named meshes later
 * when `/charts`' own C4 packet reuses this same component), and reports
 * back only `{ effectId, targetId }`. The HOST page owns:
 *  - resolving `effectId` to a real `@glyphcss/effects` definition,
 *  - mounting/retargeting/disposing the `scene.addEffectLayer` layer,
 *  - driving `time` with its own `requestAnimationFrame` loop.
 * This component is Dock UI only — it never touches a scene.
 */
export interface Instrument3DEffectTarget {
  readonly id: string;
  readonly label: string;
}
export interface Instrument3DEffectsState {
  /** `"none"` means no effect layer is mounted. */
  readonly effectId: string;
  /** `Instrument3DEffectsFolder.ALL_TARGET_ID` means scene-wide (every targetable mesh); otherwise one target's own `id`. */
  readonly targetId: string;
}

export const INSTRUMENT_3D_EFFECT_NONE = "none";
export const INSTRUMENT_3D_EFFECT_ALL_TARGET = "all";

export interface Instrument3DEffectsFolderProps {
  readonly gui: GUI | null;
  /** Effect ids offered, `"none"` first by convention (the caller's own array order is used verbatim). */
  readonly effectIds: readonly string[];
  /** Display label per id; an id with no entry falls back to itself. */
  readonly effectLabels?: Readonly<Record<string, string>>;
  /** What this effect can be mesh-targeted at, beyond the implicit "All". */
  readonly targets: readonly Instrument3DEffectTarget[];
  /**
   * Display label for the implicit scene-wide `INSTRUMENT_3D_EFFECT_ALL_TARGET`
   * option — caller-owned (fix round 2, P1-2) rather than a hard-coded "All
   * nodes", since a diagram's targets are nodes but `/charts`' own future C4
   * packet targets marks/series, which "all nodes" would misdescribe.
   */
  readonly allTargetsLabel: string;
  readonly state: Instrument3DEffectsState;
  readonly onChange: (patch: Partial<Instrument3DEffectsState>) => void;
  /** Shown only while the host view actually has a live 3D scene mounted (mirrors the "3D" layout folder's own show/hide idiom). */
  readonly visible: boolean;
}

export function Instrument3DEffectsFolder({ gui, effectIds, effectLabels, targets, allTargetsLabel, state, onChange, visible }: Instrument3DEffectsFolderProps) {
  const folder = useFolder(gui, "Effects", { open: true });

  const effectOptions: Record<string, string> = {};
  for (const id of effectIds) effectOptions[effectLabels?.[id] ?? id] = id;
  useOption(folder, "Effect", effectOptions, state.effectId, (effectId) => onChange({ effectId }));

  const targetOptions: Record<string, string> = { [allTargetsLabel]: INSTRUMENT_3D_EFFECT_ALL_TARGET };
  for (const target of targets) targetOptions[target.label] = target.id;
  const targetCtrl = useOption(folder, "Target", targetOptions, state.targetId, (targetId) => onChange({ targetId }));
  // The target LIST changes with the mounted graph/chart — `useOption`'s
  // own options table is captured once at mount (`primitives.tsx`'s own
  // doc: "value and onChange intentionally excluded" from its effect
  // deps — the options table is the same kind of thing), so a later graph
  // swap needs an explicit `setOptions` call to refresh the dropdown's own
  // choices rather than silently keeping stale node ids.
  const targetKey = `${allTargetsLabel}|${targets.map((t) => `${t.id}:${t.label}`).join("|")}`;
  useEffect(() => { targetCtrl?.setOptions(targetOptions); }, [targetCtrl, targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (folder) visible ? folder.show() : folder.hide(); }, [folder, visible]);

  return null;
}
