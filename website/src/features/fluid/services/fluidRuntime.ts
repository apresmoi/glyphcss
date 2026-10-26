import { createGlyphFluid, GlyphFluidTargets, type GlyphFluid, type GlyphFluidStats } from "@glyphcss/fluid";
import { createGlyphFluidReader, type GlyphFluidReader } from "@glyphcss/fluid/reader";
// Aliased to the package's worker source: its default `new URL("./worker.js")` only
// exists next to the built dist, so the website hands it a Vite-bundled worker instead.
import FluidWorker from "@glyphcss/fluid/worker?worker";
import { fluidReaderFontFamily } from "./fluidReaderFont";
import {
  FLUID_HEADING_COLOR,
  FLUID_READER_LOOP_MS,
  type FluidReaderProgress,
  type FluidReaderSettings,
  type FluidSettings,
} from "../model/fluidWorkbench";

const STATS_INTERVAL_MS = 500;

const workerOption = (on: boolean) => (on ? () => new FluidWorker() : false);

export interface FluidFieldMount {
  readonly fluid: GlyphFluid;
  destroy(): void;
}

/** A host-filling fluid with `heading`'s own text condensing out of it. */
export function mountFluidField(
  host: HTMLElement,
  heading: HTMLElement,
  settings: FluidSettings,
  onStats?: (stats: GlyphFluidStats) => void,
): FluidFieldMount {
  const fluid = createGlyphFluid(host, {
    field: { color: settings.fieldColor, level: settings.fieldLevel },
    encoding: settings.encoding,
    fps: settings.fps,
    worker: workerOption(settings.worker),
    pointer: "host",
  });
  fluid.addTarget(GlyphFluidTargets.text(heading, { color: FLUID_HEADING_COLOR }));
  const timer = onStats ? window.setInterval(() => onStats(fluid.stats()), STATS_INTERVAL_MS) : 0;
  return {
    fluid,
    destroy() {
      window.clearInterval(timer);
      fluid.destroy();
    },
  };
}

export interface FluidReaderMount {
  readonly reader: GlyphFluidReader;
  setPlaying(playing: boolean): void;
  setWpm(wpm: number): void;
  setText(text: string): void;
  destroy(): void;
}

/** molty's round speed reader on its own small fluid; reports word progress. */
export function mountFluidReader(
  host: HTMLElement,
  reader: FluidReaderSettings,
  settings: Pick<FluidSettings, "encoding" | "fps" | "worker">,
  onProgress?: (progress: FluidReaderProgress) => void,
): FluidReaderMount {
  const handle = createGlyphFluidReader(host, {
    text: reader.text,
    wpm: reader.wpm,
    loop: reader.loop ? FLUID_READER_LOOP_MS : false,
    shape: "circle",
    encoding: settings.encoding,
    fps: settings.fps,
    worker: workerOption(settings.worker),
    // The plain letters use the site's render font, like every glyph <pre>.
    font: fluidReaderFontFamily("render"),
  });
  const { clock } = handle;
  let destroyed = false;
  const report = () => {
    if (!destroyed) onProgress?.({ index: clock.index, total: clock.tokens.length, playing: clock.playing });
  };
  const unsubscribe = clock.subscribe(report);
  // Autoplay starts once the fluid is ready, without a clock event.
  void handle.ready.then(report);
  report();
  return {
    reader: handle,
    // The clock emits no play/pause events, so toggling reports the new state itself.
    setPlaying(playing) {
      if (playing) clock.play();
      else clock.pause();
      report();
    },
    setWpm(wpm) {
      clock.setWpm(wpm);
    },
    setText(text) {
      clock.setText(text);
    },
    destroy() {
      destroyed = true;
      unsubscribe();
      handle.destroy();
    },
  };
}
