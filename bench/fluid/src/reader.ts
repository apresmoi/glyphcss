// The speed reader in a real browser. Live: `createGlyphFluidReader` on a round 412 px
// host with the real worker. Capture (`__reader.capture(word, steps)`): the same target
// and core stepped deterministically, plain-encoded, plus where the ORP accent landed.
import { createGlyphFluidReader, tokenizeGlyphReaderText } from "@glyphcss/fluid/reader";
import { GlyphFluidCore, createGlyphFluidTargetFrame } from "@glyphcss/fluid";
import { GlyphFluidReaderTarget } from "../../../packages/fluid/src/reader/target";

const q = new URLSearchParams(location.search);
const reader = createGlyphFluidReader(document.getElementById("live")!, {
  text: q.get("text") ?? "Molty reads one word at a time, out of the fluid.",
  wpm: Number(q.get("wpm") ?? 250),
  loop: 2600,
  shape: "circle",
  ...(q.get("cols") ? { grid: { targetCols: Number(q.get("cols")), maxCols: Number(q.get("cols")) } } : {}),
  worker: q.get("worker") === "0" ? false : () => new Worker("fluid-worker.bundle.js", { type: "module" }),
});
const words: string[] = [];
reader.clock.subscribe((e) => e.type === "word" && words.push(e.token.word));

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function capture(sentence: string, steps: number) {
  const cols = 52, rows = 32, cw = 8, ch = 12.8;
  const host = document.getElementById("cap")!;
  const r = host.getBoundingClientRect();
  const core = new GlyphFluidCore({
    cols, rows, cellW: cw, cellH: ch, fieldColor: [0x6f / 255, 0x8f / 255, 0x82 / 255], fieldLevel: 0.18,
    tuning: { relaxUp: 7, relaxDown: 2.4 }, encoding: "plain", monoColor: "#6f8f82", shape: "circle",
  });
  const target = new GlyphFluidReaderTarget(host, [0.95, 0.96, 1]);
  target.measure({ cw, ch, originX: r.left, originY: r.top });
  const toks = tokenizeGlyphReaderText(sentence);
  target.setSentence(toks);
  target.setWord(toks[0]!);
  let text = "";
  for (let s = 0; s < steps; s++) {
    const f = createGlyphFluidTargetFrame(cols, rows);
    f.BGM.fill(1);
    target.update(1 / 60);
    target.write(f, 0);
    const t = (s + 1) / 60;
    const ops = s === 0 ? ([["kick", 1.2], ["impulse", 0, 0, 0.6, 0.06]] as const) : [];
    text = core.step({ ops: ops as never, params: { t, breath: 0.5, dt: 1 / 60, hold: smooth((t - 0.4) / 1) }, targets: f.packed, shimmer: 0 }).text;
  }
  const { acc } = core.sim;
  let a = 0, ax = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (acc[j * cols + i]! > 0.3) ((a += 1), (ax += i + 0.5));
  return { text, orp: toks[0]!.orp, accentCells: a, accentCentreCol: a ? ax / a : -1 };
}

(window as unknown as Record<string, unknown>).__reader = { reader, words, capture, ready: reader.ready.then(() => true) };
