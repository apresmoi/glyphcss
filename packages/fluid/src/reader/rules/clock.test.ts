// The word clock's timing is what's under test, so it runs on an injected fake scheduler:
// every event is checked against the exact virtual time it fired at.
import { describe, expect, it } from "vitest";
import { createGlyphReaderClock, type GlyphReaderClockEvent, type GlyphReaderScheduler } from "./clock";
import { glyphReaderWordDelay, tokenizeGlyphReaderText } from "./words";

function fakeScheduler() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const sch: GlyphReaderScheduler & { advance(ms: number): void; pending(): number } = {
    now: () => now,
    setTimeout(fn, ms) {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
    pending: () => timers.size,
  };
  return sch;
}

function record(clock: ReturnType<typeof createGlyphReaderClock>, sch: { now(): number }) {
  const log: Array<[number, string]> = [];
  clock.subscribe((e: GlyphReaderClockEvent) => log.push([sch.now(), e.type === "word" ? `word:${e.token.word}` : e.type]));
  return log;
}

const TEXT = "One, two three.\n\nFour";

describe("createGlyphReaderClock", () => {
  it("lead-in, then each word for exactly its wordDelay, then end", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: TEXT, wpm: 300, scheduler: sch });
    const log = record(clock, sch);
    sch.advance(10000);
    const d = tokenizeGlyphReaderText(TEXT).map((t) => glyphReaderWordDelay(t, 300));
    expect(d).toEqual([300, 200, 500, 200]); // clause ×1.5, plain, paragraph ×2.5, plain
    expect(log).toEqual([
      [550, "word:One,"],
      [550 + 300, "word:two"],
      [550 + 500, "word:three."],
      [550 + 1000, "word:Four"],
      [550 + 1200, "end"],
    ]);
    expect(clock.playing).toBe(false);
    expect(sch.pending()).toBe(0);
  });

  it("pause keeps the remaining time of the current word; play resumes it", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: TEXT, wpm: 300, scheduler: sch });
    const log = record(clock, sch);
    sch.advance(550 + 100); // "One," has 200 of its 300 ms left
    clock.pause();
    sch.advance(5000);
    expect(log).toEqual([[550, "word:One,"]]);
    clock.play();
    sch.advance(200);
    expect(log.at(-1)).toEqual([5650 + 200, "word:two"]);
  });

  it("setWpm takes effect from the next word, not the showing one", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: "aa bb cc", wpm: 600, scheduler: sch, leadIn: 0 });
    const log = record(clock, sch);
    sch.advance(0); // aa shows for 100 ms
    clock.setWpm(60); // bb will show for 1000 ms
    sch.advance(100 + 1000 + 1000);
    expect(log).toEqual([[0, "word:aa"], [100, "word:bb"], [1100, "word:cc"], [2100, "end"]]);
  });

  it("seek shows the word now and holds it for its full delay; clamps out-of-range", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: TEXT, wpm: 300, scheduler: sch });
    const log = record(clock, sch);
    sch.advance(100);
    clock.seek(2);
    expect(clock.index).toBe(2);
    sch.advance(500);
    expect(log).toEqual([[100, "word:three."], [600, "word:Four"]]);
    clock.seek(99);
    expect(clock.index).toBe(3);
    clock.seek(-4);
    expect(clock.index).toBe(0);
  });

  it("loops after the rest, re-emitting text before the lead-in", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: "hi", wpm: 600, scheduler: sch, leadIn: 50, loop: 1000 });
    const log = record(clock, sch);
    sch.advance(50 + 100 + 1000 + 50);
    expect(log).toEqual([[50, "word:hi"], [150, "end"], [1150, "text"], [1200, "word:hi"]]);
    expect(clock.playing).toBe(true);
  });

  it("play after a finished reading starts over; setText restarts; autoplay false waits", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: "hi", wpm: 600, scheduler: sch, leadIn: 0, autoplay: false });
    const log = record(clock, sch);
    sch.advance(1000);
    expect(log).toEqual([]);
    clock.play();
    sch.advance(1000);
    clock.play();
    sch.advance(0);
    expect(log.map((e) => e[1])).toEqual(["word:hi", "end", "text", "word:hi"]);
    clock.setText("new words");
    expect(clock.index).toBe(-1);
    expect(log.at(-1)![1]).toBe("text");
  });

  it("a word listener's setText wins: the new text gets its own lead-in", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: "aa bb", wpm: 600, scheduler: sch, leadIn: 50 });
    const log = record(clock, sch);
    let once = true;
    clock.subscribe((e) => e.type === "word" && once && ((once = false), clock.setText("cc dd")));
    sch.advance(50 + 50);
    expect(log).toEqual([[50, "word:aa"], [50, "text"], [100, "word:cc"]]);
  });

  it("a word listener's seek holds the sought word for its own delay at the new wpm", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: "aa bb cc", wpm: 600, scheduler: sch, leadIn: 0 });
    const log = record(clock, sch);
    let once = true;
    clock.subscribe((e) => {
      if (e.type === "word" && once) {
        once = false;
        clock.setWpm(60);
        clock.seek(1);
      }
    });
    sch.advance(0 + 999);
    expect(log).toEqual([[0, "word:aa"], [0, "word:bb"]]);
    sch.advance(1);
    expect(log.at(-1)).toEqual([1000, "word:cc"]);
  });

  it("an end listener's setText leaves a stopped clock stopped, with no stray timer", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: "aa", wpm: 600, scheduler: sch, leadIn: 0 });
    const log = record(clock, sch);
    clock.subscribe((e) => e.type === "end" && clock.setText("bb"));
    sch.advance(5000);
    expect(log.map((e) => e[1])).toEqual(["word:aa", "end", "text"]);
    expect(clock.playing).toBe(false);
    expect(sch.pending()).toBe(0);
    clock.play();
    sch.advance(0);
    expect(log.at(-1)![1]).toBe("word:bb");
  });

  it("a transition in an earlier listener supersedes the event for later listeners", () => {
    for (const nested of ["seek", "setText", "destroy"] as const) {
      const sch = fakeScheduler();
      const clock = createGlyphReaderClock({ text: "aa bb", wpm: 600, scheduler: sch, leadIn: 0 });
      let once = true;
      clock.subscribe((e) => {
        if (e.type !== "word" || !once) return;
        once = false;
        if (nested === "seek") clock.seek(1);
        else if (nested === "setText") clock.setText("cc");
        else clock.destroy();
      });
      const seen: string[] = []; // registered SECOND: sees only what is current
      clock.subscribe((e) => seen.push(e.type === "word" ? e.token.word : e.type));
      sch.advance(0);
      expect(seen, nested).toEqual(nested === "seek" ? ["bb"] : nested === "setText" ? ["text", "cc"] : []);
    }
  });

  it("a word listener's pause keeps the full delay of that word for resume", () => {
    const sch = fakeScheduler();
    const clock = createGlyphReaderClock({ text: "aa bb", wpm: 600, scheduler: sch, leadIn: 0 });
    const log = record(clock, sch);
    let once = true;
    clock.subscribe((e) => e.type === "word" && once && ((once = false), clock.pause()));
    sch.advance(1000);
    expect(log).toEqual([[0, "word:aa"]]);
    clock.play();
    sch.advance(100);
    expect(log.at(-1)).toEqual([1100, "word:bb"]);
  });

  it("empty text never schedules; destroy cancels the pending step", () => {
    const sch = fakeScheduler();
    const empty = createGlyphReaderClock({ text: "  ", scheduler: sch });
    expect(empty.playing).toBe(false);
    expect(sch.pending()).toBe(0);
    const clock = createGlyphReaderClock({ text: TEXT, scheduler: sch });
    expect(sch.pending()).toBe(1);
    clock.destroy();
    expect(sch.pending()).toBe(0);
  });
});
