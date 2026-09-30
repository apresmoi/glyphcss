import type { GlyphEffectPreset } from "@glyphcss/effects";
import { useState } from "react";
import { useSynthPreview } from "../../../features/synth/hooks/useSynthPreview";
import { synthDefaults, type Params } from "../../../features/synth/model/parameters";
import { stagePreviewShape } from "../../../features/synth/model/presets";

// ── Live preset tile (flat square) ────────────────────────────────────────────
// Hover-to-animate, unconditionally (this component has no other caller —
// unlike `VoiceCard`, there's no LoadersWorkbench-style shared usage to
// preserve): the preset tray can hold a couple dozen tiles, each mounting its
// own `createGlyphScene` render loop, so animating all of them at once was
// the bulk of the perf problem this fixed.
export function PresetTile({ preset, onApply }: { preset: GlyphEffectPreset<never>; onApply: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  useSynthPreview(
    host,
    () => ({ ...synthDefaults(), ...(preset.params as Params) }),
    [host],
    undefined,
    stagePreviewShape(preset),
    hovered,
  );
  return (
    <button
      className="synth-tile"
      onClick={onApply}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      title={`Apply “${preset.name}”`}
    >
      <span className="synth-tile-scene" ref={setHost} />
      <span className="synth-tile-label">{preset.name}</span>
    </button>
  );
}
