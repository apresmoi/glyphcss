// @vitest-environment node
//
// Unit-level pins for `renderChartsWorkbenchRender.ts`'s own two fixes
// (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C2/C4), independent of the
// DOM-level matrix in `chartsWorkbenchTargetMatrix.test.tsx` — this checks
// the render RESULT object directly (`isHtml`/`charsetDowngraded`/`text`),
// not what `TargetPreview` does with it.
import { describe, expect, it } from "vitest";
import { renderChartsWorkbenchSpec } from "./chartsWorkbenchRender";

const SPEC = JSON.stringify({ marks: [{ type: "line", data: [{ t: 0, v: 3 }, { t: 1, v: 5 }], channels: { x: "t", y: "v" } }], title: "t" });
const BRAILLE_RANGE = /[⠀-⣿]/;

describe("renderChartsWorkbenchSpec — target matrix fixes", () => {
  it("C2: color: css produces isHtml on every target, not just web", () => {
    for (const target of ["web", "terminal", "chat"] as const) {
      const result = renderChartsWorkbenchSpec(SPEC, { target, charset: "box", color: "css", width: 40, height: 12 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.isHtml, `target=${target}`).toBe(true);
    }
  });

  it("C4: chat + braille downgrades to box and reports charsetDowngraded", () => {
    const result = renderChartsWorkbenchSpec(SPEC, { target: "chat", charset: "braille", color: "none", width: 40, height: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charsetDowngraded).toBe(true);
    expect(BRAILLE_RANGE.test(result.text)).toBe(false);
  });

  it("C4 does not fire for chat + blocks (present in every chat-stack font)", () => {
    const result = renderChartsWorkbenchSpec(SPEC, { target: "chat", charset: "blocks", color: "none", width: 40, height: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charsetDowngraded).toBeUndefined();
  });

  it("C4 does not fire for braille on web/terminal", () => {
    for (const target of ["web", "terminal"] as const) {
      const result = renderChartsWorkbenchSpec(SPEC, { target, charset: "braille", color: "none", width: 40, height: 12 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.charsetDowngraded, `target=${target}`).toBeUndefined();
    }
  });

  it("a byte-identical render for color: none/target: chat/charset: box (the library default) never sets charsetDowngraded", () => {
    const result = renderChartsWorkbenchSpec(SPEC, { target: "chat", charset: "box", color: "none", width: 40, height: 12 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.charsetDowngraded).toBeUndefined();
  });
});
