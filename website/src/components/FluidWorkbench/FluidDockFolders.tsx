import type { GUI } from "lil-gui";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  FLUID_INERT_TUNING,
  FLUID_RANGES,
  FLUID_TUNABLE_KEYS,
  FLUID_TUNING_RANGES,
  type FluidConfig,
  type FluidConfigKey,
  type FluidExample,
  type FluidNumberKey,
  type FluidTunableKey,
} from "../../features/fluid/model/fluidExamples";
import {
  formatFluidReaderProgress,
  type FluidReaderProgress,
  type FluidStatsReadout,
} from "../../features/fluid/model/fluidWorkbench";
import {
  useColor,
  useDockGui,
  useFolder,
  useFolderTitleReset,
  useOption,
  useReadonlyText,
  useSlider,
  useDockSlot,
  useText,
  useToggle,
  type DockController,
} from "../Dock";
import { ChoiceButton } from "../IconToggle";

type Update = (partial: Partial<FluidConfig>) => void;

/** A row's tooltip, and whether it applies; unavailable rows dim with the reason. */
function useNote(ctrl: DockController<unknown> | null, title: string, enabled = true) {
  useEffect(() => {
    if (!ctrl) return;
    ctrl.setEnabled(enabled, { dim: true });
    ctrl.raw.$name.title = title;
  }, [ctrl, title, enabled]);
}

interface RowProps {
  folder: GUI | null;
  label: string;
  title: string;
  enabled?: boolean;
}

function Slider({
  folder,
  label,
  title,
  enabled,
  range,
  value,
  onChange,
}: RowProps & { range: { min: number; max: number; step: number }; value: number; onChange: (v: number) => void }) {
  useNote(useSlider(folder, label, range, value, onChange) as DockController<unknown> | null, title, enabled);
  return null;
}

/** A slider over one numeric config key, ranged by `FLUID_RANGES`. */
function ConfigSlider({
  k,
  config,
  update,
  ...row
}: RowProps & { k: FluidNumberKey; config: FluidConfig; update: Update }) {
  return <Slider {...row} range={FLUID_RANGES[k]} value={config[k]} onChange={(v) => update({ [k]: v })} />;
}

function Choice<T extends string | number>({
  folder,
  label,
  title,
  enabled,
  options,
  value,
  onChange,
  select = false,
}: RowProps & { options: Record<string, T>; value: T; onChange: (v: T) => void; select?: boolean }) {
  const ctrl = useOption(folder, label, options, value, onChange, select ? "select" : "choices");
  useNote(ctrl as DockController<unknown> | null, title, enabled);
  return null;
}

function Toggle({
  folder,
  label,
  title,
  enabled,
  value,
  onChange,
}: RowProps & { value: boolean; onChange: (v: boolean) => void }) {
  useNote(useToggle(folder, label, value, onChange) as DockController<unknown> | null, title, enabled);
  return null;
}

function Color({ folder, label, title, value, onChange }: RowProps & { value: string; onChange: (v: string) => void }) {
  useNote(useColor(folder, label, value, onChange) as DockController<unknown> | null, title);
  return null;
}

function Readout({ folder, label, title, enabled = true, value }: RowProps & { value: string }) {
  const ctrl = useReadonlyText(folder, label, value);
  useEffect(() => {
    if (!ctrl) return;
    // A read-only row is already disabled undimmed, and lil-gui skips a repeat disable().
    if (!enabled) {
      ctrl.setEnabled(true);
      ctrl.setEnabled(false, { dim: true });
    }
    ctrl.raw.$name.title = title;
  }, [ctrl, title, enabled]);
  return null;
}

/** An action row in the folder, as /charts' camera reset: a label and one bracketed button. */
function Button({
  folder,
  label,
  title,
  enabled = true,
  action,
  onClick,
}: RowProps & { action: string; onClick: () => void }) {
  const slot = useDockSlot(folder, { position: "bottom", className: "dock-toggle-row-slot" });
  return (
    slot &&
    createPortal(
      <div className="dock-toggle-row">
        <span className="dock-toggle-row-label" title={title}>
          {label}
        </span>
        <ChoiceButton
          type="button"
          className="gx-toggle-btn gx-toggle-text"
          title={title}
          aria-label={`${label}: ${action}`}
          disabled={!enabled}
          onClick={onClick}
        >
          {action}
        </ChoiceButton>
      </div>,
      slot,
    )
  );
}

/** Commits on Enter / blur, not per keystroke: every commit restarts the reader's sentence. */
function TextField({
  folder,
  label,
  title,
  value,
  onCommit,
}: RowProps & { value: string; onCommit: (v: string) => void }) {
  const ctrl = useText(folder, label, value, () => {});
  useNote(ctrl as DockController<unknown> | null, title);
  useEffect(() => {
    if (!ctrl) return;
    ctrl.raw.onFinishChange((next: string) => {
      if (next.trim()) onCommit(next.trim());
      else ctrl.setValue(value);
    });
  }, [ctrl, value, onCommit]);
  return null;
}

const SHOWN_KEYS = ["delay", "visibility", "condensed"] as const satisfies readonly FluidConfigKey[];

function ShownRows({ folder, config, update }: { folder: GUI | null; config: FluidConfig; update: Update }) {
  return (
    <>
      <ConfigSlider
        folder={folder}
        k="delay"
        label="Delay s"
        title="Seconds after the fluid starts before the target first condenses (delay)"
        config={config}
        update={update}
      />
      <Choice
        folder={folder}
        label="Visibility"
        title="always, or only while its middle is between 7 % and 95 % of the viewport height (visibility)"
        options={{ Always: "always", Viewport: "viewport" }}
        value={config.visibility}
        onChange={(visibility) => update({ visibility })}
      />
      <Toggle
        folder={folder}
        label="Condensed"
        title="condense() flows the target in; melt() flows it back out into the field"
        value={config.condensed}
        onChange={(condensed) => update({ condensed })}
      />
    </>
  );
}

const TARGET_TITLES: Record<FluidExample["kind"], string> = {
  text: "Text target",
  image: "Image target",
  mesh: "Mesh target",
  zones: "Zone",
  reader: "Reader",
};

const TARGET_KEYS: Record<FluidExample["kind"], readonly FluidConfigKey[]> = {
  text: ["color", ...SHOWN_KEYS],
  image: ["ink", ...SHOWN_KEYS],
  mesh: ["meshRotX", "meshRotY", "meshSpin", "meshExtent", "meshAmbient", "meshFeatures", "meshSwell", ...SHOWN_KEYS],
  zones: ["zoneKind", "zoneLevel"],
  reader: ["text", "wpm", "loop", "look", "font", "ripple", "readerColor", "leadIn", "ariaLive"],
};

function TargetFolder({
  example,
  config,
  update,
  reset,
  progress,
  onTogglePlaying,
}: {
  example: FluidExample;
  config: FluidConfig;
  update: Update;
  reset: (keys: readonly FluidConfigKey[]) => void;
  progress: FluidReaderProgress;
  onTogglePlaying: () => void;
}) {
  const folder = useFolder(useDockGui(), "Target", { open: true });
  const title = TARGET_TITLES[example.kind];
  useEffect(() => void folder?.title(title), [folder, title]);
  useFolderTitleReset(folder, `Reset the ${title.toLowerCase()} options to this example's defaults`, () =>
    reset(TARGET_KEYS[example.kind]),
  );
  const row = { folder, config, update };
  switch (example.kind) {
    case "text":
      return (
        <>
          <Color
            folder={folder}
            label="Color"
            title="Ink colour of the condensed text (color)"
            value={config.color}
            onChange={(color) => update({ color })}
          />
          <ShownRows {...row} />
        </>
      );
    case "image":
      return (
        <>
          <Choice
            folder={folder}
            label="Ink"
            title="luminance: bright, opaque pixels pull the most ink; alpha: coverage alone (ink)"
            options={{ Luminance: "luminance", Alpha: "alpha" }}
            value={config.ink}
            onChange={(ink) => update({ ink })}
          />
          <ShownRows {...row} />
        </>
      );
    case "mesh":
      return (
        <>
          <ConfigSlider {...row} k="meshRotX" label="Rot X °" title="Camera pitch (camera.rotX)" />
          <ConfigSlider
            {...row}
            k="meshRotY"
            label="Rot Y °"
            title="Camera yaw at the start of the spin (camera.rotY)"
          />
          <ConfigSlider
            {...row}
            k="meshSpin"
            label="Spin °/s"
            title="Turns the camera around the model each frame; 0 holds the pose"
          />
          <ConfigSlider
            {...row}
            k="meshExtent"
            label="Extent ×"
            title="World units across the target box, as a multiple of the model's size (extent)"
          />
          <ConfigSlider {...row} k="meshAmbient" label="Ambient" title="Ambient term of the shading pass (ambient)" />
          <Toggle
            folder={folder}
            label="Features"
            title="Dark covered cells (eyes, mouths) become solid feature blocks (features)"
            value={config.meshFeatures}
            onChange={(meshFeatures) => update({ meshFeatures })}
          />
          <Toggle
            folder={folder}
            label="Swell"
            title="Breathe with the background field (swell)"
            value={config.meshSwell}
            onChange={(meshSwell) => update({ meshSwell })}
          />
          <ShownRows {...row} />
        </>
      );
    case "zones":
      return (
        <>
          <Choice
            folder={folder}
            label="Kind"
            title="quiet dims the field under the prose; pool deepens it into an elliptical well (kind)"
            options={{ Quiet: "quiet", Pool: "pool" }}
            value={config.zoneKind}
            onChange={(zoneKind) => update({ zoneKind })}
          />
          <ConfigSlider {...row} k="zoneLevel" label="Level" title="Floor multiplier inside the zone (level)" />
        </>
      );
    case "reader":
      return <ReaderRows {...row} progress={progress} onTogglePlaying={onTogglePlaying} />;
  }
}

function ReaderRows({
  folder,
  config,
  update,
  progress,
  onTogglePlaying,
}: {
  folder: GUI | null;
  config: FluidConfig;
  update: Update;
  progress: FluidReaderProgress;
  onTogglePlaying: () => void;
}) {
  const row = { folder, config, update };
  return (
    <>
      <TextField
        folder={folder}
        label="Text"
        title="The sentence, one word at a time; Enter applies it (clock.setText)"
        value={config.text}
        onCommit={(text) => update({ text })}
      />
      <ConfigSlider {...row} k="wpm" label="WPM" title="Words per minute, from the next word (clock.setWpm)" />
      <Toggle
        folder={folder}
        label="Playing"
        title="clock.play() / clock.pause()"
        enabled={progress.total > 0}
        value={progress.playing}
        onChange={onTogglePlaying}
      />
      <Readout
        folder={folder}
        label="Word"
        title="The word on the reader, out of the sentence's words"
        value={formatFluidReaderProgress(progress)}
      />
      <Toggle
        folder={folder}
        label="Loop"
        title="Read again after a rest at the end (loop)"
        value={config.loop}
        onChange={(loop) => update({ loop })}
      />
      <Choice
        folder={folder}
        label="Look"
        title="plain: real DOM letters condense out of a pooled band; glyph: braille letters drawn by the fluid (look)"
        options={{ Plain: "plain", Glyph: "glyph" }}
        value={config.look}
        onChange={(look) => update({ look })}
      />
      <Choice
        folder={folder}
        label="Font"
        title={
          config.look === "plain"
            ? "The plain letters' CSS font-family (font)"
            : "Font sets the plain look's letters — switch Look to Plain to use it."
        }
        enabled={config.look === "plain"}
        options={{ "Render mono": "render", "UI mono": "ui", Prose: "prose", molty: "molty" }}
        value={config.font}
        onChange={(font) => update({ font })}
        select
      />
      <ConfigSlider
        {...row}
        k="ripple"
        label="Ripple"
        title="Strength of the ring each word after the first sends out; 0 for none (ripple)"
      />
      <Color
        folder={folder}
        label="Color"
        title="Letter colour; the ORP accent stays the fluid's orange (color)"
        value={config.readerColor}
        onChange={(readerColor) => update({ readerColor })}
      />
      <ConfigSlider
        {...row}
        k="leadIn"
        label="Lead-in ms"
        title="ms before the first word, while the ink gathers (leadIn)"
      />
      <Choice
        folder={folder}
        label="ARIA live"
        title="polite announces each word to screen readers; off keeps the sentence as one label (ariaLive)"
        options={{ Off: "off", Polite: "polite" }}
        value={config.ariaLive}
        onChange={(ariaLive) => update({ ariaLive })}
      />
    </>
  );
}

const FLUID_KEYS = [
  "glue",
  "shape",
  "encoding",
  "face",
  "fps",
  "fpsFallback",
  "worker",
  "clock",
  "reducedMotion",
  "pointer",
  "shimmer",
  "fieldColor",
  "fieldLevel",
] as const satisfies readonly FluidConfigKey[];
const GRID_KEYS = [
  "cellAspect",
  "targetCols",
  "minCellPx",
  "maxCellPx",
  "maxCols",
] as const satisfies readonly FluidConfigKey[];

function FluidFolder({
  example,
  config,
  update,
  reset,
  onStep,
}: {
  example: FluidExample;
  config: FluidConfig;
  update: Update;
  reset: (keys: readonly FluidConfigKey[]) => void;
  onStep: () => void;
}) {
  const folder = useFolder(useDockGui(), "Fluid", { open: true });
  useFolderTitleReset(folder, "Reset the fluid options to this example's defaults", () => reset(FLUID_KEYS));
  const reader = example.kind === "reader";
  const row = { folder, config, update };
  return (
    <>
      <Choice
        folder={folder}
        label="Glue"
        title={
          reader
            ? 'The reader always fills its own host (glue: "host").'
            : "host fills the host box; document glues the fluid to the page and scrolls by whole rows (glue)"
        }
        enabled={!reader}
        options={{ Host: "host", Document: "document" }}
        value={config.glue}
        onChange={(glue) => update({ glue })}
      />
      <Choice
        folder={folder}
        label="Shape"
        title="rect fills the host; circle is molty's round screen inscribed in it (shape)"
        options={{ Rect: "rect", Circle: "circle" }}
        value={config.shape}
        onChange={(shape) => update({ shape })}
      />
      <Choice
        folder={folder}
        label="Encoding"
        title="atlas: per-cell colour through the atlas font's pooled palette; mono: the field colour only (encoding)"
        options={{ Atlas: "atlas", Mono: "mono" }}
        value={config.encoding}
        onChange={(encoding) => update({ encoding })}
      />
      <Choice
        folder={folder}
        label="Face"
        title="dots: molty's dot rectangles; universal: glyphcss's universal atlas, rows bunch across cells (face)"
        options={{ Dots: "dots", Universal: "universal" }}
        value={config.face}
        onChange={(face) => update({ face })}
      />
      <Choice
        folder={folder}
        label="FPS"
        title="Frame cap (fps)"
        options={{ "60": 60, "30": 30 }}
        value={config.fps}
        onChange={(fps) => update({ fps: fps as FluidConfig["fps"] })}
      />
      <Toggle
        folder={folder}
        label="FPS fallback"
        title={
          config.fps === 60
            ? "Drop to 30 fps for the session when frames keep missing (fpsFallback)"
            : "Only a 60 fps cap can drop to 30 — set FPS to 60 to use it."
        }
        enabled={config.fps === 60}
        value={config.fpsFallback}
        onChange={(fpsFallback) => update({ fpsFallback })}
      />
      <Choice
        folder={folder}
        label="Pipeline"
        title="Worker: sim, cells and encode run in a Web Worker; Main: on the page's thread (worker)"
        options={{ Worker: "worker", Main: "main" }}
        value={config.worker ? "worker" : "main"}
        onChange={(v) => update({ worker: v === "worker" })}
      />
      <Choice
        folder={folder}
        label="Clock"
        title="auto draws on requestAnimationFrame; manual draws only on step(dt) (clock)"
        options={{ Auto: "auto", Manual: "manual" }}
        value={config.clock}
        onChange={(clock) => update({ clock })}
      />
      <Button
        folder={folder}
        label="Step"
        action="Frame"
        title={
          config.clock === "manual"
            ? "fluid.step(1 / fps): advance one frame and draw"
            : "The auto clock draws every frame — set Clock to Manual to step by hand."
        }
        enabled={config.clock === "manual"}
        onClick={onStep}
      />
      <Choice
        folder={folder}
        label="Reduced motion"
        title="Under prefers-reduced-motion: settle draws still, settled frames; animate ignores it (reducedMotion)"
        options={{ Settle: "settle", Animate: "animate" }}
        value={config.reducedMotion}
        onChange={(reducedMotion) => update({ reducedMotion })}
      />
      <Choice
        folder={folder}
        label="Pointer"
        title="Where pointer moves stir the fluid and clicks ripple it (pointer)"
        options={{ Host: "host", Window: "window", None: "none" }}
        value={config.pointer}
        onChange={(pointer) => update({ pointer })}
        select
      />
      <ConfigSlider {...row} k="shimmer" label="Shimmer" title="Dither shimmer amplitude (shimmer)" />
      <Color
        folder={folder}
        label="Field color"
        title="The dim field's colour, the ink the fluid rests in (field.color)"
        value={config.fieldColor}
        onChange={(fieldColor) => update({ fieldColor })}
      />
      <ConfigSlider
        {...row}
        k="fieldLevel"
        label="Field level"
        title="Floor level of the dim field; 0 leaves only stirred ink (field.level)"
      />
    </>
  );
}

function GridFolder({
  config,
  update,
  reset,
}: {
  config: FluidConfig;
  update: Update;
  reset: (keys: readonly FluidConfigKey[]) => void;
}) {
  const folder = useFolder(useDockGui(), "Grid", { open: false });
  useFolderTitleReset(folder, "Reset the grid to this example's defaults", () => reset(GRID_KEYS));
  const row = { folder, config, update };
  return (
    <>
      <ConfigSlider
        {...row}
        k="cellAspect"
        label="Cell aspect"
        title="Cell height / width; the dots face is exact at 1.6 (grid.cellAspect)"
      />
      <ConfigSlider {...row} k="targetCols" label="Target cols" title="Columns the grid aims for (grid.targetCols)" />
      <ConfigSlider {...row} k="minCellPx" label="Min cell px" title="Narrowest cell in CSS px (grid.minCellPx)" />
      <ConfigSlider {...row} k="maxCellPx" label="Max cell px" title="Widest cell in CSS px (grid.maxCellPx)" />
      <ConfigSlider {...row} k="maxCols" label="Max cols" title="Column cap (grid.maxCols)" />
    </>
  );
}

function ImpulseFolder({
  config,
  update,
  reset,
  onRipple,
}: {
  config: FluidConfig;
  update: Update;
  reset: (keys: readonly FluidConfigKey[]) => void;
  onRipple: () => void;
}) {
  const folder = useFolder(useDockGui(), "Impulse", { open: false });
  useFolderTitleReset(folder, "Reset the impulse to the package's defaults", () =>
    reset(["impulseStrength", "impulseRadius"]),
  );
  const row = { folder, config, update };
  return (
    <>
      <ConfigSlider {...row} k="impulseStrength" label="Strength" title="Ring strength (impulse opts.strength)" />
      <ConfigSlider
        {...row}
        k="impulseRadius"
        label="Radius"
        title="Ring radius in stage units (impulse opts.radius)"
      />
      <Button
        folder={folder}
        label="Ripple"
        action="Send"
        title="fluid.impulse() at the centre with this strength and radius"
        onClick={onRipple}
      />
    </>
  );
}

function SimFolder({
  config,
  values,
  defaults,
  onTuning,
  onReset,
}: {
  config: FluidConfig;
  values: Record<FluidTunableKey, number>;
  defaults: Record<FluidTunableKey, number>;
  onTuning: (key: FluidTunableKey, value: number) => void;
  onReset: () => void;
}) {
  const folder = useFolder(useDockGui(), "Sim", { open: false });
  useFolderTitleReset(folder, "Reset the sim to molty's tuning", onReset);
  const inert: Record<string, string> = {
    tintRate: "3 + 9·hold",
    hold: "0 → 1",
    bgRim: "0.78",
    bgLevel: config.fieldLevel.toFixed(2),
    bgColor: config.fieldColor,
  };
  return (
    <>
      {FLUID_TUNABLE_KEYS.map((key) => (
        <Slider
          key={key}
          folder={folder}
          label={key}
          title={`${key} (tuning.${key}); molty's value is ${defaults[key]}${key === "bgFreq" || key === "swirlFreq" ? ", scaled with the fluid's width until you set it" : ""}`}
          range={FLUID_TUNING_RANGES[key]}
          value={values[key]}
          onChange={(v) => onTuning(key, v)}
        />
      ))}
      {FLUID_INERT_TUNING.map(({ key, reason }) => (
        <Readout key={key} folder={folder} label={key} title={reason} enabled={false} value={inert[key]!} />
      ))}
    </>
  );
}

function PipelineFolder({ stats, lit }: { stats: FluidStatsReadout; lit: string }) {
  const folder = useFolder(useDockGui(), "Pipeline", { open: true });
  useReadonlyText(folder, "fps", stats.fps);
  useReadonlyText(folder, "pipeline", stats.pipeline);
  useReadonlyText(folder, "cols × rows", stats.grid);
  useReadonlyText(folder, "step ms", stats.stepMs);
  useReadonlyText(folder, "lit", lit);
  return null;
}

/** Every option of the active example as Dock folders, plus the live pipeline readouts. */
export function FluidDockFolders(props: {
  example: FluidExample;
  config: FluidConfig;
  update: Update;
  reset: (keys: readonly FluidConfigKey[]) => void;
  tuningValues: Record<FluidTunableKey, number>;
  tuningDefaults: Record<FluidTunableKey, number>;
  onTuning: (key: FluidTunableKey, value: number) => void;
  onResetTuning: () => void;
  progress: FluidReaderProgress;
  onTogglePlaying: () => void;
  onRipple: () => void;
  onStep: () => void;
  stats: FluidStatsReadout;
  lit: string;
}) {
  const { example, config, update, reset } = props;
  return (
    <>
      <TargetFolder
        example={example}
        config={config}
        update={update}
        reset={reset}
        progress={props.progress}
        onTogglePlaying={props.onTogglePlaying}
      />
      <FluidFolder example={example} config={config} update={update} reset={reset} onStep={props.onStep} />
      <GridFolder config={config} update={update} reset={reset} />
      <ImpulseFolder config={config} update={update} reset={reset} onRipple={props.onRipple} />
      <SimFolder
        config={config}
        values={props.tuningValues}
        defaults={props.tuningDefaults}
        onTuning={props.onTuning}
        onReset={props.onResetTuning}
      />
      <PipelineFolder stats={props.stats} lit={props.lit} />
    </>
  );
}
