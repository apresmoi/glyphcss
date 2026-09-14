// Packet D3 — the target x charset x colour matrix, extended to the 3D
// render path (mirrors `diagramsWorkbenchRender.targetMatrix.test.ts`'s own
// unit-level shape: the render RESULT object directly, not what
// `TargetPreview` does with it — a full 60-cell DOM sweep already exists
// for 2D in `diagramsWorkbenchTargetMatrix.test.tsx`; this stays at the
// pure-function level, cheap enough to run every cell). Every cell must
// WORK (never throw/reject) — `blocks`/`braille` faithfully DOWNGRADE
// (`charsetDowngraded: true`, never a silent misrender), matching AGENTS.md's
// "Targets and page" export-boundary discipline this page mirrors for 3D.
import { describe, expect, it } from "vitest";
import { createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchControls, reduceGlyphDiagramsWorkbenchState, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState3d } from "./diagramsWorkbenchRender";

const TARGETS = ["chat", "terminal", "web"] as const;
const CHARSETS = ["ascii", "box", "blocks", "braille"] as const;
const COLORS = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;
const BRAILLE_RANGE = /[⠀-⣿]/;

function withControls(target: (typeof TARGETS)[number], charset: (typeof CHARSETS)[number], color: (typeof COLORS)[number]): GlyphDiagramsWorkbenchState {
  const base = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "set-view", view: "3d" });
  const controls = reduceGlyphDiagramsWorkbenchControls({ target, overrides: { charset, color } }, { type: "target", value: target });
  return { ...base, controls };
}

describe("renderGlyphDiagramsWorkbenchState3d — target x charset x colour matrix", () => {
  for (const target of TARGETS) for (const charset of CHARSETS) for (const color of COLORS) {
    it(`${target} / ${charset} / ${color} renders (never throws, never silently blank)`, async () => {
      const result = await renderGlyphDiagramsWorkbenchState3d(withControls(target, charset, color));
      expect(result.ok, `target=${target} charset=${charset} color=${color}`).toBe(true);
      if (!result.ok) return;
      expect(result.text.replace(/[\s\n]/g, "").length, `target=${target} charset=${charset} color=${color}`).toBeGreaterThan(0);
    }, 15_000);
  }

  // Mutation: drop `ledger3dCharsetDegraded` in `render3d.ts`'s `resolveCharset` → this reddens on every target.
  it("braille always degrades to wireframe in 3D and reports charsetDowngraded", async () => {
    for (const target of TARGETS) {
      const result = await renderGlyphDiagramsWorkbenchState3d(withControls(target, "braille", "none"));
      expect(result.ok, `target=${target}`).toBe(true);
      if (!result.ok) return;
      expect(result.charsetDowngraded, `target=${target}`).toBe(true);
    }
  }, 20_000);

  // Solid->wireframe (the library's own degrade) still draws REAL braille
  // dot glyphs — that IS the charset, unlike 2D's chat-only font concern.
  // `chat` gets a SECOND, page-level downgrade on top of it (no chat
  // client's fenced-code font carries the braille block), which is the one
  // thing that actually removes braille glyphs from the text.
  // Mutation: drop `chatCharsetDowngrade3d` in `diagramsWorkbenchRender.ts` → this reddens.
  it("chat + braille additionally strips actual braille glyphs from the text (page-level, on top of the library's own degrade)", async () => {
    const chat = await renderGlyphDiagramsWorkbenchState3d(withControls("chat", "braille", "none"));
    expect(chat.ok).toBe(true);
    if (!chat.ok) return;
    expect(BRAILLE_RANGE.test(chat.text)).toBe(false);

    const terminal = await renderGlyphDiagramsWorkbenchState3d(withControls("terminal", "braille", "none"));
    expect(terminal.ok).toBe(true);
    if (!terminal.ok) return;
    expect(BRAILLE_RANGE.test(terminal.text)).toBe(true);
  });

  it("blocks always degrades to solid ASCII in 3D and reports charsetDowngraded", async () => {
    const result = await renderGlyphDiagramsWorkbenchState3d(withControls("web", "blocks", "none"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charsetDowngraded).toBe(true);
  });

  it("ascii/box never degrade", async () => {
    for (const charset of ["ascii", "box"] as const) {
      const result = await renderGlyphDiagramsWorkbenchState3d(withControls("web", charset, "none"));
      expect(result.ok, charset).toBe(true);
      if (!result.ok) return;
      expect(result.charsetDowngraded, charset).toBeUndefined();
    }
  });

  it("color: css produces html on every target", async () => {
    for (const target of TARGETS) {
      const result = await renderGlyphDiagramsWorkbenchState3d(withControls(target, "box", "css"));
      expect(result.ok, `target=${target}`).toBe(true);
      if (result.ok) expect(result.html, `target=${target}`).toBeDefined();
    }
  }, 15_000);
});
