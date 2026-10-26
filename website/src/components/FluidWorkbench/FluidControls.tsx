import { useState, type CSSProperties } from "react";
import {
  FLUID_LEVEL_RANGE,
  FLUID_WPM_CHOICES,
  formatFluidReaderProgress,
  type FluidEncoding,
  type FluidFps,
  type FluidReaderProgress,
  type FluidReaderSettings,
  type FluidSettings,
} from "../../features/fluid/model/fluidWorkbench";
import { ActionButton } from "../ActionButton";
import { ColorSwatch } from "../ColorSwatch";
import { ControlSection } from "../ControlSection";
import { EditableReadout } from "../EditableReadout";
import { IconToggle } from "../IconToggle";
import { InstrumentSectionHeading } from "../InstrumentWorkbench";
import { SliderRow, SliderTrack } from "../SliderRow";

const ENCODING_OPTIONS = [
  { value: "atlas", icon: "atlas", label: "Atlas", desc: "per-cell colour through the atlas font's pooled palette" },
  { value: "mono", icon: "mono", label: "Mono", desc: "the atlas glyphs in the field colour only" },
];
const FPS_OPTIONS = [
  { value: "60", icon: "60", label: "60 fps", desc: "drops to 30 for the session when frames keep missing" },
  { value: "30", icon: "30", label: "30 fps", desc: "half the steps; the cap for slow devices" },
];
const WORKER_OPTIONS = [
  { value: "on", icon: "worker", label: "Worker", desc: "sim, cells and encode run in a Web Worker" },
  { value: "off", icon: "main", label: "Main thread", desc: "everything runs on the page's own thread" },
];
const WPM_OPTIONS = FLUID_WPM_CHOICES.map((wpm) => ({ value: String(wpm), icon: String(wpm), label: `${wpm} wpm` }));

const fill = (value: number, min: number, max: number) =>
  ({ ["--fill" as string]: `${((value - min) / (max - min)) * 100}%` }) as CSSProperties;

export function FluidControls({
  settings,
  onSettings,
  reader,
  onText,
  onWpm,
  onLoop,
  progress,
  onTogglePlaying,
}: {
  settings: FluidSettings;
  onSettings: (partial: Partial<FluidSettings>) => void;
  reader: FluidReaderSettings;
  onText: (text: string) => void;
  onWpm: (wpm: number) => void;
  onLoop: (loop: boolean) => void;
  progress: FluidReaderProgress;
  onTogglePlaying: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { min, max, step } = FLUID_LEVEL_RANGE;
  return (
    <>
      <ControlSection className="fluid-section">
        <InstrumentSectionHeading>Fluid</InstrumentSectionHeading>
        <ColorSwatch
          label="field color"
          value={settings.fieldColor}
          onChange={(fieldColor) => onSettings({ fieldColor })}
          title="The dim field's colour — the ink the fluid rests in between targets"
        />
        <SliderRow className="fluid-row" title="Floor level of the dim field; 0 leaves only stirred ink">
          <span>field level</span>
          <SliderTrack>
            <input
              type="range"
              aria-label="Field level"
              min={min}
              max={max}
              step={step}
              value={settings.fieldLevel}
              style={fill(settings.fieldLevel, min, max)}
              onChange={(e) => onSettings({ fieldLevel: +e.target.value })}
            />
          </SliderTrack>
          <EditableReadout
            value={settings.fieldLevel}
            min={min}
            max={max}
            format={(v) => v.toFixed(2)}
            onCommit={(fieldLevel) => onSettings({ fieldLevel })}
          />
        </SliderRow>
        <div className="fluid-row fluid-row--choices">
          <span>encoding</span>
          <IconToggle
            groupLabel="Encoding"
            options={ENCODING_OPTIONS}
            value={settings.encoding}
            onChange={(encoding) => onSettings({ encoding: encoding as FluidEncoding })}
          />
        </div>
        <div className="fluid-row fluid-row--choices">
          <span>fps</span>
          <IconToggle
            groupLabel="Frame cap"
            options={FPS_OPTIONS}
            value={String(settings.fps)}
            onChange={(fps) => onSettings({ fps: Number(fps) as FluidFps })}
          />
        </div>
        <div className="fluid-row fluid-row--choices">
          <span>pipeline</span>
          <IconToggle
            groupLabel="Pipeline"
            options={WORKER_OPTIONS}
            value={settings.worker ? "on" : "off"}
            onChange={(v) => onSettings({ worker: v === "on" })}
          />
        </div>
      </ControlSection>
      <ControlSection className="fluid-section">
        <InstrumentSectionHeading
          action={
            <ActionButton
              compact
              onClick={onTogglePlaying}
              disabled={progress.total === 0}
              aria-label={progress.playing ? "Pause the reader" : "Play the reader"}
            >
              {progress.playing ? "Pause" : "Play"}
            </ActionButton>
          }
        >
          Reader
        </InstrumentSectionHeading>
        <label className="fluid-text" title="The sentence the round reader shows one word at a time. Enter applies it.">
          <span>text</span>
          <textarea
            rows={3}
            spellCheck={false}
            value={draft ?? reader.text}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null) onText(draft);
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setDraft(null);
              }
            }}
          />
        </label>
        <div className="fluid-row fluid-row--choices">
          <span>wpm</span>
          <IconToggle
            groupLabel="Words per minute"
            options={WPM_OPTIONS}
            value={String(reader.wpm)}
            onChange={(wpm) => onWpm(Number(wpm))}
          />
        </div>
        <label className="fluid-row fluid-row--check" title="Start over after the last word">
          <span>loop</span>
          <input type="checkbox" checked={reader.loop} onChange={(e) => onLoop(e.target.checked)} />
        </label>
        <div className="fluid-row fluid-row--info" title="The word on the reader, out of the sentence's words">
          <span>word</span>
          <output data-fluid-reader-word={progress.index}>{formatFluidReaderProgress(progress)}</output>
        </div>
      </ControlSection>
    </>
  );
}
