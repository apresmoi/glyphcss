import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartCell, glyphChartDot, glyphChartLine, glyphChartRect, glyphChartRule, glyphChartText } from "./spec";
import type { GlyphChartMark, GlyphChartRenderOptions, GlyphChartSpec } from "./types";

export const categoricalSeriesData = [{ x: 0, y: 1, s: "A" }, { x: 1, y: 2, s: "A" }, { x: 0, y: 8, s: "B" }, { x: 1, y: 9, s: "B" }];
export const stackedArea = { ...glyphChartArea([{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 3 }, { x: 1, y: 3 }], { x: "x", y: "y" }), transform: { kind: "stack" as const } };
export const signedCells = glyphChartCell([{ x: "a", y: "v", v: -10 }, { x: "b", y: "v", v: 0 }, { x: "c", y: "v", v: 10 }], { x: "x", y: "y", fill: "v" });
export const longBands = glyphChartBar([{ x: "abcdefghijklmnopqrstuvwx123456", y: 1 }, { x: "second-category-very-long", y: 2 }], { x: "x", y: "y" });
export const hourlyLine = glyphChartLine([{ x: "2026-01-01T00:00:00Z", y: 1 }, { x: "2026-01-01T02:00:00Z", y: 2 }], { x: "x", y: "y" });
export const categoricalDots = glyphChartDot([{ x: 0, y: "low" }, { x: 1, y: "high" }], { x: "x", y: "y" });
export const browserShares = [{ browser: "Chrome", share: 65 }, { browser: "Safari", share: 20 }, { browser: "Firefox", share: 15 }];
export const markFactories = [glyphChartLine, glyphChartArea, glyphChartBar, glyphChartDot, glyphChartRect, glyphChartCell, glyphChartArc, glyphChartText, glyphChartRule];
const spec = (mark: GlyphChartMark): GlyphChartSpec => ({ marks: [mark] });
export const goodSpecs: GlyphChartSpec[] = [
  ...markFactories.map((fn) => spec(fn([-1, 1]))),
  spec(glyphChartLine([3, 5, 2, 8])), spec(glyphChartBar([0, 0, 0])), spec(glyphChartArc([0, 0, 0])),
  spec(glyphChartLine(categoricalSeriesData, { x: "x", y: "y", fill: "s" })),
  spec(stackedArea), spec(signedCells), spec(longBands), spec(categoricalDots),
  // Mutation: put arc back in XY_MARK_TYPES/schema's x+y clause -> this exact review input rejects.
  spec(glyphChartArc(browserShares, { fill: "browser", y: "share" })),
  spec(glyphChartArc(browserShares, { label: "browser", y: "share" })),
  spec(glyphChartArc(browserShares, { y: "share" })),
  { marks: [hourlyLine], scales: { x: { type: "time", domain: ["2026-01-01", "2026-01-02"] } } },
  { marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" } } },
  { marks: [glyphChartDot([0, 1, 4])], scales: { y: { type: "sqrt" } } },
  { marks: [glyphChartLine([1, 2]), glyphChartDot([1, 2]), glyphChartRule([0])], title: "<b>&x" },
  ...(["bin", "stack", "group", "normalize", "window"] as const).map((kind) => spec({ ...glyphChartBar([1, 2, 4]), transform: { kind } })),
];

// Literal expected IDs are independent of the implementation's rule table.
// Mutation: delete any rule from the table OR its runtime check -> red.
export const badSpecs: { id: string; spec: GlyphChartSpec; options?: GlyphChartRenderOptions }[] = [
  { id: "empty-marks", spec: { marks: [] } },
  { id: "unknown-mark-type", spec: { marks: [null as never] } },
  { id: "unknown-mark-type", spec: spec({ type: "scatter3d", data: [1], channels: {} } as never) },
  { id: "empty-data", spec: spec(glyphChartLine([])) },
  { id: "missing-xy-channels", spec: spec(glyphChartLine([{ v: 1 }], { x: "v" })) },
  // Mutation: omit the arc value requirement, rule entry, hint, or schema clause -> Ajv/runtime parity goes red.
  { id: "arc-missing-value", spec: spec(glyphChartArc(browserShares, { fill: "browser" })) },
  { id: "unknown-transform", spec: spec({ ...glyphChartLine([1, 2]), transform: { kind: "bogus" } as never }) },
  { id: "invalid-transform-n", spec: spec({ ...glyphChartLine([1, 2]), transform: { kind: "bin", n: 0 } }) },
  { id: "invalid-inner-radius", spec: spec(glyphChartArc([1, 2], {}, { innerRadius: 1.5 })) },
  { id: "invalid-rule-axis", spec: spec(glyphChartRule([0], { axis: "z" as never })) },
  { id: "bad-size", spec: spec(glyphChartLine([1, 2])), options: { width: 20.5, height: 6 } },
  { id: "non-finite-data", spec: spec(glyphChartLine([NaN, Infinity])) },
  { id: "non-finite-data", spec: spec(glyphChartLine([{ x: 1, y: Infinity }], { x: "x", y: "y" })) },
  { id: "bad-channels", spec: spec(glyphChartDot([1, 2], { size: [1, 2] } as never)) },
  { id: "bad-channels", spec: spec(glyphChartDot([1, 2], { shape: ["o", "x"] } as never)) },
  { id: "bad-options", spec: spec(glyphChartLine([1, 2], {}, { curve: "basis" } as never)) },
  { id: "bad-scale", spec: { marks: [glyphChartLine([1, 2])], scales: { y: { type: "bogus" } as never } } },
  { id: "log-domain", spec: { marks: [glyphChartBar([1, 10])], scales: { y: { type: "log" } } } },
  { id: "bad-scale", spec: { marks: [glyphChartBar([1, 2])], scales: { y: { type: "band", domain: ["a", "b"] } } } },
  ...([[0, 100], [-1, 1]] as const).map((domain) => ({ id: "log-domain", spec: { marks: [glyphChartDot([1, 10, 100])], scales: { y: { type: "log" as const, domain } } } })),
  ...([glyphChartBar, glyphChartRect] as const).map((fn) => ({ id: "bar-domain-excludes-zero", spec: { marks: [fn([5, 10])], scales: { y: { domain: [5, 10] } } } })),
  ...["2026-02-30", "2026-99-01", "2026-01-01T25:00:00Z"].map((date) => ({ id: "bad-time-domain", spec: { marks: [hourlyLine], scales: { x: { type: "time" as const, domain: [date, "2026-01-02"] } } } })),
  { id: "bad-time-domain", spec: { marks: [hourlyLine], scales: { x: { type: "time", domain: ["invalid", "2026-01-02"] } } } },
];
