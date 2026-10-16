// @vitest-environment happy-dom
import "../../test/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { glyphGraphFromMermaid } from "@glyphcss/diagrams";
import { createGlyphDiagramsWorkbenchState } from "../../features/diagrams/model/diagramsWorkbenchState";
import { GLYPH_MERMAID_DIAGRAM_PRESETS } from "../../features/mermaid/model/presets";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({
  CALIBRATED_PALETTE_NAME: "calibrated",
  ensureCalibratedPalette: () => {},
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("diagram Mermaid plain-source editing", () => {
  let host: HTMLDivElement;
  let root: Root;
  async function settle() {
    await vi.waitFor(
      async () => {
        await act(async () => {
          await vi.dynamicImportSettled();
        });
        expect(host.querySelector('.diagrams-preview[aria-busy="false"]')).not.toBeNull();
      },
      { timeout: 10_000, interval: 10 },
    );
  }
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<GlyphDiagramsWorkbench initialState={createGlyphDiagramsWorkbenchState()} />));
    await settle();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  it.each(GLYPH_MERMAID_DIAGRAM_PRESETS.filter((preset) => !["flowchart", "graph"].includes(preset.type)))(
    "$type has no flowchart affordances and edits update the preview",
    async (preset) => {
      await act(async () =>
        host.querySelector<HTMLButtonElement>(`[aria-label="Apply Mermaid ${preset.type}"]`)!.click(),
      );
      await settle();
      const editor = host.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor.value).toBe(preset.source);
      expect(
        host.querySelector(
          ".diagrams-editor-slot, .diagrams-editor-field, .diagrams-editor-choice-select, .diagrams-editor-completions",
        ),
      ).toBeNull();
      expect(editor.getAttribute("aria-autocomplete")).not.toBe("list");
      editor.setSelectionRange(1, 1);
      const nativeEdit = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "+new()",
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(nativeEdit);
      expect(nativeEdit.defaultPrevented).toBe(false);
      const original = preset.type === "requirementDiagram" ? "No duplicate charge" : preset.labels[0]!;
      const replacement = "Updated";
      const next = preset.source.replace(original, replacement);
      expect(next).not.toBe(preset.source);
      if (preset.type === "requirementDiagram") {
        const before = glyphGraphFromMermaid(preset.source);
        const after = glyphGraphFromMermaid(next);
        expect(after.nodes.map(node => node.id)).toEqual(before.nodes.map(node => node.id));
        expect(after.edges).toEqual(before.edges);
        expect(after.nodes.some(node => node.compartments?.flat().some(row => row.includes(replacement)))).toBe(true);
      }
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, next);
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.dispatchEvent(new Event("focusout", { bubbles: true }));
      });
      await settle();
      await vi.waitFor(
        () => {
          expect(host.querySelector(".diagrams-viewport pre.glyph-output")!.textContent).toContain(replacement);
        },
        { timeout: 10_000 },
      );
      expect(
        host.querySelector(
          ".diagrams-editor-slot, .diagrams-editor-field, .diagrams-editor-choice-select, .diagrams-editor-completions",
        ),
      ).toBeNull();
    },
  );
});
