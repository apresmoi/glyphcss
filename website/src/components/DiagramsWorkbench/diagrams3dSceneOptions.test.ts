// D3 fix round 1, P1-1 — the target x charset x colour matrix extended to
// the LIVE viewport's own scene options (`resolveDiagrams3dSceneOptions`),
// not just the static `renderGlyphDiagram3d` path
// (`diagramsWorkbenchRender3d.targetMatrix.test.ts`). "Target" (chat/
// terminal/web) doesn't change this function's answer — the live scene
// only ever mounts on `web` — so the matrix here is charset x colour, 20
// cells, all of them pure-function cheap.
import { describe, expect, it } from "vitest";
import { resolveCharset } from "@glyphcss/diagrams/3d";
import { resolveDiagrams3dSceneOptions } from "./diagrams3dSceneOptions";

const CHARSETS = ["ascii", "box", "blocks", "braille"] as const;
const COLORS = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;

describe("resolveDiagrams3dSceneOptions — charset x colour matrix", () => {
  for (const charset of CHARSETS) for (const color of COLORS) {
    it(`${charset} / ${color} resolves without throwing`, () => {
      const result = resolveDiagrams3dSceneOptions(charset, color);
      // The page never passes `style`, so `resolveCharset` only ever answers
      // its default (`"ink"`) branch: `ink` for ascii/box/blocks, `wireframe`
      // for braille — `"solid"` is reachable only via an explicit
      // `style: "solid"` this page doesn't send.
      expect(result.mode === "ink" || result.mode === "wireframe").toBe(true);
      expect(result.charMode === "ascii" || result.charMode === "braille").toBe(true);
      expect(typeof result.useColors).toBe("boolean");
    });
  }

  // Mutation: return `mode: "ink"` unconditionally for braille → this reddens.
  // Braille is the INTENDED wireframe-braille look under the default style
  // (AGENTS.md's "Diagrams 3D" / library round D2 round 3), not a downgrade
  // from anything else — so it carries NO ledger note by itself; a note
  // appears only from the SEPARATE ansi16/ansi256 colour-depth rule below.
  it("braille resolves to wireframe mode, on every colour, with no charset-degrade note", () => {
    for (const color of COLORS) {
      const result = resolveDiagrams3dSceneOptions("braille", color);
      expect(result.mode, color).toBe("wireframe");
      expect(result.charMode, color).toBe("braille");
      const isAnsiDepth = color === "ansi16" || color === "ansi256";
      if (isAnsiDepth) {
        expect(result.note, color).toBeDefined();
        expect(result.note, color).toMatch(/colour depth/i);
      } else {
        expect(result.note, color).toBeUndefined();
      }
    }
  });

  // Mutation: return `charMode: "braille"` for blocks → this reddens (blocks
  // stays ascii ink — its sub-cell dual-color encoder can't carry the
  // stamped edge/label overlays this renderer depends on, so it genuinely
  // degrades and keeps its ledger note on every colour).
  it("blocks resolves to ink ascii mode with a downgrade note, on every colour", () => {
    for (const color of COLORS) {
      const result = resolveDiagrams3dSceneOptions("blocks", color);
      expect(result.mode, color).toBe("ink");
      expect(result.charMode, color).toBe("ascii");
      expect(result.note, color).toBeDefined();
    }
  });

  // Mutation: drop the `notes.push(LIVE_COLOR_DEPTH_NOTE)` line → this reddens on both cases.
  it("ansi16/ansi256 get a live-colour-depth note on an otherwise undegraded charset", () => {
    for (const color of ["ansi16", "ansi256"] as const) {
      for (const charset of ["ascii", "box"] as const) {
        const result = resolveDiagrams3dSceneOptions(charset, color);
        expect(result.note, `${charset}/${color}`).toBeDefined();
        expect(result.note, `${charset}/${color}`).toMatch(/colour depth/i);
      }
    }
  });

  // Mutation: fold `truecolor`/`css` into the ANSI-depth note branch too → this reddens.
  it("truecolor/css on an undegraded charset carry no note", () => {
    for (const color of ["truecolor", "css"] as const) {
      for (const charset of ["ascii", "box"] as const) {
        const result = resolveDiagrams3dSceneOptions(charset, color);
        expect(result.note, `${charset}/${color}`).toBeUndefined();
      }
    }
  });

  // Mutation: `useColors: true` unconditionally → this reddens.
  it("useColors is exactly `color !== \"none\"`", () => {
    for (const charset of CHARSETS) {
      expect(resolveDiagrams3dSceneOptions(charset, "none").useColors, charset).toBe(false);
      for (const color of ["ansi16", "ansi256", "truecolor", "css"] as const) {
        expect(resolveDiagrams3dSceneOptions(charset, color).useColors, `${charset}/${color}`).toBe(true);
      }
    }
  });

  it("ascii/box carry no note at any colour (fully representable live)", () => {
    for (const charset of ["ascii", "box"] as const) {
      for (const color of ["none", "truecolor", "css"] as const) {
        expect(resolveDiagrams3dSceneOptions(charset, color).note, `${charset}/${color}`).toBeUndefined();
      }
    }
  });

  // Fix round 2, P1-1 — `canvasTier`/`boxOutline` must be `resolveCharset`'s
  // OWN values, verbatim, for every charset x colour cell: colour never
  // affects the object's own build (only `useColors`/scene-level `mode` do),
  // and the live object must match the static frame's `glyphDiagramObject`
  // call (`{ tier: canvasTier, boxOutline }`) at every charset. Mutation:
  // hard-coding `canvasTier: "box"` or `boxOutline: true` reddens this on
  // any charset that disagrees.
  it("canvasTier/boxOutline are resolveCharset's own values, independent of colour", () => {
    for (const charset of CHARSETS) {
      const expected = resolveCharset(charset);
      for (const color of COLORS) {
        const result = resolveDiagrams3dSceneOptions(charset, color);
        expect(result.canvasTier, `${charset}/${color}`).toBe(expected.canvasTier);
        expect(result.boxOutline, `${charset}/${color}`).toBe(expected.boxOutline);
      }
    }
  });
});
