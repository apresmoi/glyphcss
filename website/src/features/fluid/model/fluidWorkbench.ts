import type { GlyphFluidStats } from "@glyphcss/fluid";

export type FluidEncoding = "atlas" | "mono";
export type FluidFps = 60 | 30;

/** Everything that needs a new `createGlyphFluid` (the runtime has no setters for these). */
export interface FluidSettings {
  readonly fieldColor: string;
  readonly fieldLevel: number;
  readonly encoding: FluidEncoding;
  readonly fps: FluidFps;
  readonly worker: boolean;
}

export interface FluidReaderSettings {
  readonly text: string;
  readonly wpm: number;
  readonly loop: boolean;
}

export const FLUID_DEFAULTS: FluidSettings = {
  fieldColor: "#6f8f82",
  fieldLevel: 0.18,
  encoding: "atlas",
  fps: 60,
  worker: true,
};

export const FLUID_LEVEL_RANGE = { min: 0, max: 0.6, step: 0.01 } as const;
export const FLUID_WPM_CHOICES = [250, 400, 600] as const;
/** Rest after the last word before the reader starts over. */
export const FLUID_READER_LOOP_MS = 1400;

export const FLUID_READER_DEFAULTS: FluidReaderSettings = {
  text: "Words condense out of a living braille fluid, one at a time, and melt back into it.",
  wpm: 400,
  loop: true,
};

/** The heading the viewport's fluid condenses; also the static snapshot's word. */
export const FLUID_HEADING = "fluid";
export const FLUID_HEADING_COLOR = "#f2f5ff";

export interface FluidReaderProgress {
  /** Showing word, −1 during the lead-in; `total` once ended. */
  readonly index: number;
  readonly total: number;
  readonly playing: boolean;
}

export const FLUID_READER_IDLE: FluidReaderProgress = { index: -1, total: 0, playing: false };

export function formatFluidReaderProgress({ index, total }: FluidReaderProgress): string {
  if (total === 0) return "–";
  return `${Math.min(total, Math.max(0, index + 1))} / ${total}`;
}

export interface FluidStatsReadout {
  readonly fps: string;
  readonly pipeline: string;
  readonly grid: string;
  readonly stepMs: string;
}

export const FLUID_STATS_PENDING: FluidStatsReadout = { fps: "–", pipeline: "–", grid: "–", stepMs: "–" };

export function formatFluidStats(stats: GlyphFluidStats): FluidStatsReadout {
  return {
    fps: String(stats.fps),
    pipeline: stats.pipeline,
    grid: stats.cols ? `${stats.cols} × ${stats.rows}` : "–",
    stepMs: stats.stepMs.toFixed(2),
  };
}
