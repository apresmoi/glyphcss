import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * "Copy ASCII" and "Download SVG" must stay reachable on a phone.
 *
 * Below 760px `.synth-export-bar` is `display: none` (it duplicates the
 * mobile tab bar's Export/Code tab), so an action that lives only there is
 * stranded — /synth closed that hole by mounting the same two actions inside
 * its own `SynthCodePanel`. /maps uses the SHARED gallery `CodePanel`, so the
 * slot had to be added there and fed from both places.
 *
 * `CodePanel.tsx` cannot be mounted in this vitest config (it imports
 * `@glyphcss/core`, which is not a website dependency — the same reason no
 * CodePanel test exists), and `MapsWorkbench.tsx` cannot be mounted either.
 * So this asserts the wiring as checked-in source, the technique
 * `maps-workbench.rowWidths.test.ts` already uses on this page's stylesheet.
 */
const codePanel = readFileSync(new URL("../GalleryWorkbench/CodePanel.tsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("./MapsWorkbench.tsx", import.meta.url), "utf8");
const instrumentCss = readFileSync(
  new URL("../InstrumentWorkbench/instrument-workbench.css", import.meta.url),
  "utf8",
);

describe("the render exports survive the mobile breakpoint", () => {
  it("the shared CodePanel takes an actions slot and renders it in its action row", () => {
    expect(codePanel).toMatch(/actions\?:\s*ReactNode/);
    expect(codePanel).toMatch(/className="gw-code-panel__actions">\s*\n\s*\{actions\}/);
  });

  it("/maps feeds ONE definition of the two actions to both mounts", () => {
    // One element…
    expect(workbench).toMatch(/const renderExportActions = \(/);
    expect(workbench).toMatch(/onClick=\{handleCopyAscii\}/);
    expect(workbench).toMatch(/onClick=\{handleDownloadSvg\}/);
    // …rendered in the desktop bar AND handed to the code window.
    expect(workbench).toMatch(/className="synth-export-bar">\s*\n\s*\{renderExportActions\}/);
    expect(workbench).toMatch(/actions=\{renderExportActions\}/);
    // Exactly one definition of each handler's button, so the pair cannot drift.
    expect(workbench.match(/onClick=\{handleCopyAscii\}/g)).toHaveLength(1);
    expect(workbench.match(/onClick=\{handleDownloadSvg\}/g)).toHaveLength(1);
  });

  // The premise: without this, the bar really is hidden and there is nowhere
  // else for the two actions to be.
  it("is needed because the export bar is hidden below 760px", () => {
    expect(instrumentCss).toMatch(
      /:is\(\.dn-root--synth, \.dn-root--generative\) \.synth-export-bar \{ display: none; \}/,
    );
  });
});
