import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCss } from "../../test/styles";

const css = (file: string) => readCss(path.resolve(__dirname, file)).replace(/\/\*[\s\S]*?\*\//g, "");
const instrumentCss = css("../InstrumentWorkbench/InstrumentWorkbench.module.css");
const panelCss = css("../CodePanel/CodePanel.module.css");
const tabsCss = css("../InstrumentWorkbench/InstrumentMobileTabs.module.css");
const mapsCss = css("./MapsWorkbench.module.css");
const workbench = readFileSync(new URL("./MapsWorkbench.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../CodePanel/CodePanel.tsx", import.meta.url), "utf8");

// Layout dimensions and drawer/viewport containment are also asserted by e2e/workbench-layout.mjs.
describe("maps inherits the shared code window positioning", () => {
  it("uses CodePanel's own frame, without a page-specific positioning class", () => {
    expect(workbench).toMatch(/<CodePanel\s/);
    expect(panel).toMatch(/<CodePanelFrame\s/);
    expect(workbench).not.toContain("synth-code-panel");
  });
  it("opens the mobile code drawer only for its own tab", () => {
    expect(workbench).toContain('className={mobilePanel === "code" ? "is-mobile-open" : ""}');
  });
  it("anchors the desktop code window above the export footer and mobile window above the tabs", () => {
    expect(panelCss).toMatch(/bottom:\s*52px/);
    expect(panelCss).toMatch(/@media \(max-width: 1100px\)\s*\{\s*\.root\s*\{[^}]*bottom:\s*calc\(var\(--mobile-panel-bottom\)/);
  });
});
describe("maps shell reserves no absent footer strip", () => {
  it("fills the body without mounting a preset tray", () => {
    expect(workbench).toContain("<InstrumentBody>");
    expect(workbench).not.toContain("<PresetTray");
    expect(instrumentCss).toMatch(/\.synth-body\s*\{[^}]*flex:\s*1;/);
  });
  it("needs no footer-height correction in either stylesheet", () => {
    expect(mapsCss).not.toContain("--synth-footer-height");
    expect(instrumentCss).not.toContain("--synth-footer-height");
    expect(instrumentCss).toMatch(/--overlay-bottom:\s*12px/);
  });
});
describe("the mobile tab bar fits its own tab count", () => {
  it("sizes each tab to its full label without a hardcoded column count", () => {
    expect(tabsCss).toMatch(/grid-auto-flow:\s*column/);
    expect(tabsCss).toMatch(/grid-auto-columns:\s*max-content/);
    expect(tabsCss).toMatch(/justify-content:\s*space-between/);
    expect(tabsCss).not.toMatch(/grid-template-columns:\s*repeat\(\d/);
  });
  it("has no shell or maps override that could re-pin the column count", () => {
    expect(instrumentCss).not.toContain(".dn-mobile-tabs");
    expect(mapsCss).not.toContain(".dn-mobile-tabs");
  });
});
