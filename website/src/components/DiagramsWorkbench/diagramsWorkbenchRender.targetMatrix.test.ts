// Unit-level pins for `diagramsWorkbenchRender.ts`'s own two fixes
// (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C2/C4, mirrored from
// `chartsWorkbenchRender.targetMatrix.test.ts`) — the render RESULT object
// directly (`isHtml`/`charsetDowngraded`/`text`), not what `TargetPreview`
// does with it.
import { describe, expect, it } from "vitest";
import { createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchControls, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchRender";

const BRAILLE_RANGE = /[⠀-⣿]/;

function withControls(target: "chat" | "terminal" | "web", charset: "ascii" | "box" | "blocks" | "braille", color: "none" | "ansi16" | "ansi256" | "truecolor" | "css"): GlyphDiagramsWorkbenchState {
  const state = createGlyphDiagramsWorkbenchState();
  const controls = reduceGlyphDiagramsWorkbenchControls({ target, overrides: { charset, color } }, { type: "target", value: target });
  return { ...state, controls };
}

describe("renderGlyphDiagramsWorkbenchState — target matrix fixes", () => {
  it("C2: color: css produces isHtml on every target", async () => {
    for (const target of ["web", "terminal", "chat"] as const) {
      const result = await renderGlyphDiagramsWorkbenchState(withControls(target, "box", "css"));
      expect(result.ok, `target=${target}`).toBe(true);
      if (result.ok) expect(result.isHtml, `target=${target}`).toBe(true);
    }
  });

  it("C4: chat + braille downgrades to box and reports charsetDowngraded", async () => {
    const result = await renderGlyphDiagramsWorkbenchState(withControls("chat", "braille", "none"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charsetDowngraded).toBe(true);
    expect(BRAILLE_RANGE.test(result.text)).toBe(false);
  });

  it("C4 does not fire for chat + blocks", async () => {
    const result = await renderGlyphDiagramsWorkbenchState(withControls("chat", "blocks", "none"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charsetDowngraded).toBeUndefined();
  });

  it("C4 does not fire for braille on web/terminal", async () => {
    for (const target of ["web", "terminal"] as const) {
      const result = await renderGlyphDiagramsWorkbenchState(withControls(target, "braille", "none"));
      expect(result.ok, `target=${target}`).toBe(true);
      if (result.ok) expect(result.charsetDowngraded, `target=${target}`).toBeUndefined();
    }
  });
});
