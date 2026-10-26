// A speed reader drawn by the fluid: the word clock (rules layer) drives one word target
// on a small fluid of its own, paced like molty's website reader (speedReader.ts): the
// ink gathers during the lead-in, each word condenses with its ORP letter accented, every
// word change sends a soft ring out from the centre, and after the last word the letters
// melt back into the field.
import { createGlyphFluid, type GlyphFluid, type GlyphFluidOptions } from "../runtime/createGlyphFluid";
import { parseHexColor } from "../targets/types";
import { createGlyphReaderClock, type GlyphReaderClock, type GlyphReaderScheduler } from "./rules/clock";
import { GlyphFluidReaderTarget } from "./target";

export interface GlyphFluidReaderOptions extends Omit<GlyphFluidOptions, "glue"> {
  text?: string;
  /** Words per minute. Default 250. */
  wpm?: number;
  /** ms before the first word, while the ink gathers. Default 550. */
  leadIn?: number;
  /** ms after the last word before reading again; `false` (default) stops at the end. */
  loop?: number | false;
  /** Start reading as soon as the fluid is ready. Default true. */
  autoplay?: boolean;
  /** Letter colour, `#rrggbb`. Default `#f2f5ff` (molty's). The ORP accent is the fluid's accent orange. */
  color?: string;
  /**
   * Strength of the ring each word after the first sends out. Default 0.63; 0 for none.
   * The first word condensing and the last melting stir the fluid like any target change.
   */
  ripple?: number;
  /** The word clock's timer (tests, or a host-driven clock). Default `performance.now` / `setTimeout`. */
  scheduler?: GlyphReaderScheduler;
}

export interface GlyphFluidReader {
  /** Resolves once the fluid is ready (font loaded, first layout done). */
  readonly ready: Promise<void>;
  /** The word clock: play / pause / seek / setWpm / setText, and its events. */
  readonly clock: GlyphReaderClock;
  /** The underlying fluid (stats, impulses). */
  readonly fluid: GlyphFluid;
  destroy(): void;
}

/** molty's text relax rates: words snap in fast and drain slower. */
const TEXT_TUNING = { relaxUp: 7, relaxDown: 2.4 };

export function createGlyphFluidReader(host: HTMLElement, options: GlyphFluidReaderOptions = {}): GlyphFluidReader {
  const { text, wpm, leadIn, loop, autoplay, color, ripple, scheduler, ...fluidOptions } = options;
  const rgb = parseHexColor(color ?? "#f2f5ff", "reader color");
  const fluid = createGlyphFluid(host, {
    pointer: "host",
    ...fluidOptions,
    glue: "host",
    grid: { targetCols: 52, maxCols: 52, minCellPx: 2, maxCellPx: 24, ...fluidOptions.grid },
    tuning: { ...TEXT_TUNING, ...fluidOptions.tuning },
  });
  const target = new GlyphFluidReaderTarget(host, rgb);
  const live = fluid.addTarget({ kind: "reader", create: () => target });
  live.melt();
  const clock = createGlyphReaderClock({ text, wpm, leadIn, loop, scheduler, autoplay: false });
  const ring = ripple ?? 0.63;

  const unsubscribe = clock.subscribe((e) => {
    if (e.type === "text") live.melt();
    else if (e.type === "word") {
      target.setWord(e.token);
      if (!live.enabled) live.condense();
      else if (ring > 0) {
        const r = host.getBoundingClientRect();
        fluid.impulse(r.left + r.width / 2, r.top + r.height / 2, { strength: ring, radius: 0.12 });
      }
    } else live.melt();
  });

  let destroyed = false;
  const ready = fluid.ready.then(() => {
    if (!destroyed && (autoplay ?? true)) clock.play();
  });

  return {
    ready,
    clock,
    fluid,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      clock.destroy();
      fluid.destroy();
    },
  };
}
