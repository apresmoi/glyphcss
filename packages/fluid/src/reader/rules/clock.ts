// The word clock: which word is showing and when the next one is due. Renderer-agnostic;
// it only emits events. Paced like the reference's speed reader (website speedReader.ts): a
// lead-in before the first word so the ink can gather, each word for its
// `glyphReaderWordDelay`, and after the last word an optional rest before reading again.
import { glyphReaderWordDelay, tokenizeGlyphReaderText, type GlyphReaderToken } from "./words";

/** The timer the clock runs on. Defaults to `performance.now` / `setTimeout`. */
export interface GlyphReaderScheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type GlyphReaderClockEvent =
  /** A reading (re)starts: the sentence's tokens, no word shown yet (lead-in). */
  | { type: "text"; tokens: readonly GlyphReaderToken[] }
  /** `token` is now showing for `ms`. */
  | { type: "word"; token: GlyphReaderToken; index: number; ms: number }
  /** The last word has been shown. */
  | { type: "end" };

export interface GlyphReaderClockOptions {
  text?: string;
  /** Words per minute. Default 250. */
  wpm?: number;
  /** ms before the first word. Default 550. */
  leadIn?: number;
  /** ms after the last word before reading again; `false` (default) stops at the end. */
  loop?: number | false;
  /** Start reading immediately. Default true. */
  autoplay?: boolean;
  scheduler?: GlyphReaderScheduler;
}

export interface GlyphReaderClock {
  readonly tokens: readonly GlyphReaderToken[];
  /** The showing word, or −1 during the lead-in. `tokens.length` once ended. */
  readonly index: number;
  readonly playing: boolean;
  readonly wpm: number;
  play(): void;
  pause(): void;
  /** Show word `index` now (clamped); while playing it stays for its full delay. */
  seek(index: number): void;
  /** Takes effect from the next word, as the reference's reader does. */
  setWpm(wpm: number): void;
  /** Replace the text and start over from the lead-in (playing state is kept). */
  setText(text: string): void;
  /** Listen to events; returns an unsubscribe. */
  subscribe(fn: (e: GlyphReaderClockEvent) => void): () => void;
  destroy(): void;
}

const defaultScheduler = (): GlyphReaderScheduler => ({
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
});

export function createGlyphReaderClock(opts: GlyphReaderClockOptions = {}): GlyphReaderClock {
  const sch = opts.scheduler ?? defaultScheduler();
  const leadIn = opts.leadIn ?? 550;
  const loop = opts.loop ?? false;
  let wpm = opts.wpm ?? 250;
  let tokens = tokenizeGlyphReaderText(opts.text ?? "");
  let index = -1;
  let playing = false;
  let destroyed = false;
  let timer: unknown = null;
  let due = 0;
  /** ms left on the current step while paused. */
  let remaining = leadIn;
  const listeners = new Set<(e: GlyphReaderClockEvent) => void>();
  /** Bumped by every dispatch: a transition made inside a listener supersedes the event
   *  being delivered, so later listeners never see an event older than the clock state. */
  let dispatch = 0;
  const emit = (e: GlyphReaderClockEvent) => {
    const id = ++dispatch;
    for (const fn of [...listeners]) {
      if (destroyed || id !== dispatch) return;
      fn(e);
    }
  };

  function cancel(): void {
    if (timer !== null) sch.clearTimeout(timer);
    timer = null;
  }

  function arm(ms: number): void {
    cancel();
    remaining = ms;
    if (!playing) return;
    due = sch.now() + ms;
    timer = sch.setTimeout(step, ms);
  }

  // Every transition settles its state and timer BEFORE notifying: a listener may call
  // back into the clock (setText, seek, pause…), and its change must be the last word.

  /** Back to the lead-in of the current text. */
  function restart(): void {
    index = -1;
    arm(tokens.length ? leadIn : 0);
    emit({ type: "text", tokens });
  }

  function show(i: number): void {
    index = i;
    const token = tokens[i]!;
    const ms = glyphReaderWordDelay(token, wpm);
    arm(ms);
    emit({ type: "word", token, index: i, ms });
  }

  function step(): void {
    timer = null;
    if (!playing) return;
    if (!tokens.length) {
      playing = false;
      return;
    }
    if (index >= tokens.length) return restart();
    if (index + 1 < tokens.length) return show(index + 1);
    index = tokens.length;
    if (loop === false) {
      playing = false;
      remaining = 0;
    } else arm(loop);
    emit({ type: "end" });
  }

  const clock: GlyphReaderClock = {
    get tokens() { return tokens; },
    get index() { return index; },
    get playing() { return playing; },
    get wpm() { return wpm; },
    play() {
      if (destroyed || playing || !tokens.length) return;
      playing = true;
      // replaying a finished, non-looping reading starts over
      if (index >= tokens.length && loop === false) return restart();
      arm(remaining);
    },
    pause() {
      if (!playing) return;
      const left = Math.max(0, due - sch.now());
      playing = false;
      cancel();
      remaining = left;
    },
    seek(i) {
      if (destroyed || !tokens.length) return;
      show(Math.max(0, Math.min(tokens.length - 1, Math.floor(i))));
    },
    setWpm(v) {
      wpm = v;
    },
    setText(text) {
      if (destroyed) return;
      tokens = tokenizeGlyphReaderText(text);
      if (!tokens.length) playing = false;
      restart();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      destroyed = true;
      playing = false;
      cancel();
      listeners.clear();
    },
  };
  if (opts.autoplay ?? true) clock.play();
  return clock;
}
