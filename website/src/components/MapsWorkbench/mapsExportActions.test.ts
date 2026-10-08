import path from "node:path";
import { readCss } from "../../test/styles";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const codePanel = readFileSync(new URL("../CodePanel/CodePanel.tsx", import.meta.url), "utf8");
const workbench = readFileSync(new URL("./MapsWorkbench.tsx", import.meta.url), "utf8");
const instrumentCss = readCss(path.resolve(__dirname, "../InstrumentWorkbench/InstrumentExportBar.module.css"));
describe("standalone render exports survive the mobile breakpoint", () => {
  it("keeps render actions outside the code window", () => {
    expect(codePanel).not.toContain("actions?:");
    expect(codePanel).not.toContain("{actions}");
    expect(workbench).toMatch(/const renderExportActions = \(/);
    expect(workbench).toMatch(/<InstrumentExportBar>\s*\n\s*\{renderExportActions\}/);
    expect(workbench).not.toContain("actions={renderExportActions}");
    expect(workbench.match(/onClick=\{handleCopyAscii\}/g)).toHaveLength(1);
    expect(workbench.match(/onClick=\{handleDownloadSvg\}/g)).toHaveLength(1);
  });
  it("keeps the action row visible above the mobile tabs, hiding only the redundant Export trigger", () => {
    expect(instrumentCss).toMatch(/@media \(max-width: 1100px\)\s*\{\s*\.root\s*\{[^}]*bottom:\s*var\(--mobile-panel-bottom\)/);
    expect(instrumentCss).not.toMatch(/\.root\s*\{[^}]*display:\s*none/);
    expect(instrumentCss).toMatch(/\[data-export-trigger\]\s*\{\s*display: none/);
  });
});
