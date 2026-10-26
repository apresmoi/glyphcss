// A speed reader drawn by the fluid: the word clock (rules layer) drives one word target
// on a small fluid of its own, paced like molty's website reader (speedReader.ts): the
// ink gathers during the lead-in, each word condenses with its ORP letter accented, every
// word change sends a soft ring out from the centre, and after the last word the letters
// melt back into the field. The look is molty's: real letters condensing out of a pooled
// band ("plain", default) or the fluid taking the letter shapes ("glyph").
import { createGlyphFluid, type GlyphFluid, type GlyphFluidOptions } from "../runtime/createGlyphFluid";
import { parseHexColor } from "../targets/types";
import { createGlyphReaderClock, type GlyphReaderClock, type GlyphReaderScheduler } from "./rules/clock";
import type { GlyphReaderToken } from "./rules/words";
import { GlyphFluidReaderTarget, type GlyphFluidReaderLook } from "./target";
import { GLYPH_FLUID_READER_FONT } from "./letters";

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
  /**
   * `"plain"` (default, molty's website look): the fluid pools into a band and real DOM
   * letters condense out of it. `"glyph"`: the fluid itself takes the letter shapes.
   */
  look?: GlyphFluidReaderLook;
  /** `look: "plain"`: the letters' CSS font-family (drawn bold). Default molty's `ui-monospace, Menlo, Consolas, monospace`. */
  font?: string;
  /**
   * The showing word is kept in a visually hidden element for assistive tech. `"off"`
   * (default): readable on demand, not announced (a word every 240 ms would flood a
   * screen reader); `"polite"` announces each word.
   */
  ariaLive?: "off" | "polite";
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
  const { text, wpm, leadIn, loop, autoplay, color, ripple, scheduler, look, font, ariaLive, ...fluidOptions } = options;
  const rgb = parseHexColor(color ?? "#f2f5ff", "reader color");
  // the same test the fluid makes: reduced motion shows plain letters settled
  const reduced =
    (fluidOptions.reducedMotion ?? "settle") === "settle" &&
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fluid = createGlyphFluid(host, {
    pointer: "host",
    ...fluidOptions,
    glue: "host",
    grid: { targetCols: 52, maxCols: 52, minCellPx: 2, maxCellPx: 24, ...fluidOptions.grid },
    tuning: { ...TEXT_TUNING, ...fluidOptions.tuning },
  });
  const target = new GlyphFluidReaderTarget(host, rgb, look ?? "plain", font ?? GLYPH_FLUID_READER_FONT, reduced);
  const live = fluid.addTarget({ kind: "reader", create: () => target });
  const clock = createGlyphReaderClock({ text, wpm, leadIn, loop, scheduler, autoplay: false });
  const ring = ripple ?? 0.63;
  const said = document.createElement("span");
  said.setAttribute("aria-live", ariaLive ?? "off");
  said.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;";
  host.append(said);
  const melt = () => {
    live.melt();
    target.melt();
    said.textContent = "";
  };
  // molty's lead-in: the first word is the target from the start of a reading, so its ink
  // gathers (and its plain letters scramble in) before the clock shows it
  const begin = (tokens: readonly GlyphReaderToken[]) => {
    target.setSentence(tokens);
    said.textContent = "";
    if (!tokens.length) return melt();
    target.setWord(tokens[0]!);
    live.condense();
  };
  begin(clock.tokens);

  const unsubscribe = clock.subscribe((e) => {
    if (e.type === "text") begin(e.tokens);
    else if (e.type === "word") {
      target.setWord(e.token);
      said.textContent = e.token.word;
      if (!live.enabled) live.condense();
      else if (ring > 0 && e.index > 0) {
        const r = host.getBoundingClientRect();
        fluid.impulse(r.left + r.width / 2, r.top + r.height / 2, { strength: ring, radius: 0.12 });
      }
    } else melt();
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
      said.remove();
    },
  };
}
