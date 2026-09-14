// D2 round 7 — the target x charset x colour matrix extended to the LIVE
// viewport's own scene options (`resolveDiagrams3dSceneOptions`), not just
// the static `renderGlyphDiagram3d` path
// (`diagramsWorkbenchRender3d.targetMatrix.test.ts`). The live viewport
// only ever mounts on `web`, but `resolveCharset` now takes the target
// (chat degrades ascii/box to blocks, terminal/web to braille), so this
// file's own matrix runs target x charset x colour.
import { describe, expect, it } from "vitest";
import { resolveDiagrams3dSceneOptions } from "./diagrams3dSceneOptions";

const TARGETS = ["chat", "terminal", "web"] as const;
const CHARSETS = ["ascii", "box", "blocks", "braille"] as const;
const COLORS = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;

describe("resolveDiagrams3dSceneOptions — target x charset x colour matrix", () => {
  for (const target of TARGETS) for (const charset of CHARSETS) for (const color of COLORS) {
    it(`${target} / ${charset} / ${color} resolves without throwing`, () => {
      const result = resolveDiagrams3dSceneOptions(charset, color, target);
      expect(result.mode === "solid" || result.mode === "wireframe").toBe(true);
      expect(result.charMode === "braille" || result.charMode === "halfblock").toBe(true);
      expect(typeof result.useColors).toBe("boolean");
    });
  }

  // Mutation: return `mode: "solid"` unconditionally for braille → this
  // reddens. Braille is the INTENDED depth-tested wireframe look (D2
  // round 7's own "braille and blocks only" rule, AGENTS.md's "Diagrams
  // 3D") — never a downgrade from anything else, so it carries no ledger
  // note by itself on any target.
  it("braille resolves to wireframe mode on every target/colour, with no charset-degrade note", () => {
    for (const target of TARGETS) for (const color of COLORS) {
      const result = resolveDiagrams3dSceneOptions("braille", color, target);
      expect(result.mode, `${target}/${color}`).toBe("wireframe");
      expect(result.charMode, `${target}/${color}`).toBe("braille");
      const isAnsiDepth = color === "ansi16" || color === "ansi256";
      if (isAnsiDepth) {
        expect(result.note, `${target}/${color}`).toBeDefined();
        expect(result.note, `${target}/${color}`).toMatch(/colour depth/i);
      } else {
        expect(result.note, `${target}/${color}`).toBeUndefined();
      }
    }
  });

  // Mutation: return `charMode: "braille"` for blocks → this reddens.
  // blocks is the OTHER intended 3D look (a solid halfblock render), so it
  // carries no charset-degrade note either — only an ANSI-colour note when
  // the reader asked for a colour depth the dual-colour encoder has no
  // ANSI form for.
  it("blocks resolves to solid halfblock mode with no charset-degrade note, on every target", () => {
    for (const target of TARGETS) {
      const result = resolveDiagrams3dSceneOptions("blocks", "none", target);
      expect(result.mode, target).toBe("solid");
      expect(result.charMode, target).toBe("halfblock");
      expect(result.note, target).toBeUndefined();
    }
  });

  // Mutation: drop the charset-degrade ledger forwarding → this reddens.
  // ascii/box are the ONLY charsets that degrade now (box-drawing/bar
  // glyphs can't trace an edge or a box face at an angle, D2 round 7's own
  // reason) — chat degrades to blocks, terminal/web to braille.
  it("ascii/box carry a degrade note on every target, resolving to the target's own destination charset", () => {
    for (const charset of ["ascii", "box"] as const) {
      for (const target of TARGETS) {
        const result = resolveDiagrams3dSceneOptions(charset, "none", target);
        expect(result.note, `${charset}/${target}`).toBeDefined();
        if (target === "chat") { expect(result.charMode, target).toBe("halfblock"); expect(result.mode, target).toBe("solid"); }
        else { expect(result.charMode, target).toBe("braille"); expect(result.mode, target).toBe("wireframe"); }
      }
    }
  });

  // Mutation: fold `ansi256` out of the depth-note branch, or fire it for
  // `truecolor`/`css` too → this reddens.
  it("ansi16/ansi256 get a live-colour-depth note on braille; truecolor/css do not", () => {
    for (const color of ["ansi16", "ansi256"] as const) {
      const result = resolveDiagrams3dSceneOptions("braille", color, "web");
      expect(result.note, color).toMatch(/colour depth/i);
    }
    for (const color of ["truecolor", "css"] as const) {
      const result = resolveDiagrams3dSceneOptions("braille", color, "web");
      expect(result.note, color).toBeUndefined();
    }
  });

  // Mutation: drop the blocks-specific ANSI-unsupported note → this
  // reddens. `blocks` (halfblock) has NO ANSI colour form at all
  // (AGENTS.md's "Render modes" — `encodeGlyphBuffersDual` emits `<span>`
  // markup or plain text only), so every ANSI colour depth — not just
  // ansi16/ansi256 — carries its own note under this charset, distinct
  // from the generic "live colour depth" one braille gets.
  it("blocks carries a blocks-specific ANSI-unsupported note for every ANSI colour depth", () => {
    for (const color of ["ansi16", "ansi256", "truecolor"] as const) {
      const result = resolveDiagrams3dSceneOptions("blocks", color, "web");
      expect(result.note, color).toBeDefined();
      expect(result.note, color).toMatch(/ANSI colour|ANSI form/i);
    }
    expect(resolveDiagrams3dSceneOptions("blocks", "css", "web").note).toBeUndefined();
  });

  // Mutation: `useColors: true` unconditionally → this reddens.
  it("useColors is exactly `color !== \"none\"`", () => {
    for (const charset of CHARSETS) {
      expect(resolveDiagrams3dSceneOptions(charset, "none", "web").useColors, charset).toBe(false);
      for (const color of ["ansi16", "ansi256", "truecolor", "css"] as const) {
        expect(resolveDiagrams3dSceneOptions(charset, color, "web").useColors, `${charset}/${color}`).toBe(true);
      }
    }
  });
});
