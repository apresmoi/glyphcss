// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiagramsSourceEditor } from "./DiagramsSourceEditor";
import { diagramsSourceSnippets } from "../../../features/diagrams/model/diagramsSourceAid";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FOREIGN_HEADERS = [
  "stateDiagram",
  "stateDiagram-v2",
  "sequenceDiagram",
  "classDiagram",
  "classDiagram-v2",
  "erDiagram",
  "mindmap",
  "gitGraph",
  "block",
  "block-beta",
  "architecture",
  "architecture-beta",
  "requirementDiagram",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
  "unknownDiagram",
  "",
  "%%{unfinished",
];

describe("Mermaid editor grammar boundary", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn();
  const editor = () => host.querySelector("textarea")!;
  async function render(value: string, error = false) {
    await act(async () =>
      root.render(
        <DiagramsSourceEditor
          id="source"
          label="Source"
          form="graph"
          dialect="mermaid"
          value={value}
          onChange={onChange}
          ids={[{ id: "cl" }, { id: "classDiagram" }]}
          snippets={diagramsSourceSnippets("graph", "mermaid")}
          error={error ? { code: "GLYPH_MERMAID_SYNTAX", error: "Unfinished source" } : undefined}
        />,
      ),
    );
  }
  async function input(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(editor(), value);
      editor().setSelectionRange(value.length, value.length);
      editor().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function expectPlain() {
    expect(
      host.querySelector(
        ".diagrams-editor-slot, .diagrams-editor-field, .diagrams-editor-choice-select, [role='listbox'], [role='toolbar']",
      ),
    ).toBeNull();
    expect(host.querySelector(".diagrams-editor-highlight")!.textContent).toBe(editor().value);
    expect(
      host.querySelector(".diagrams-editor-highlight span[class]:not(.diagrams-editor-line):not(.diagrams-tok-text)"),
    ).toBeNull();
    expect(editor().getAttribute("aria-autocomplete")).toBe("none");
    expect(editor().getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Editing node id");
  }
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onChange.mockClear();
    vi.useFakeTimers();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it.each(FOREIGN_HEADERS)(
    "%s stays plain even with a parse failure, permits native edits and commits",
    async (header) => {
      await render(`${header}\n class Order {\n +int count\n +submit()\n }`, true);
      expectPlain();
      await act(async () => {
        editor().setSelectionRange(1, 1);
        editor().dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      });
      expect(editor().selectionStart).toBe(1);
      for (const inputType of ["insertText", "insertLineBreak", "deleteContentBackward", "insertFromPaste"]) {
        const event = new InputEvent("beforeinput", {
          inputType,
          data: "+new()",
          cancelable: true,
          bubbles: true,
        });
        editor().dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        cancelable: true,
        bubbles: true,
      });
      editor().dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(false);
      const next = `${header}\n Order --> cl`;
      await input(next);
      expectPlain();
      await act(async () => {
        vi.advanceTimersByTime(150);
      });
      expect(onChange).toHaveBeenCalledExactlyOnceWith(next);
    },
  );

  it.each([
    "flowchart LR",
    "graph TB",
    "graph; A --> B",
    "\uFEFF---\r\ntitle: Test\r\n---\r\n%% comment\r\n%%{init: {\r\n}}%%\r\nflowchart LR",
  ])("%s retains flowchart fields", async (header) => {
    await render(`${header}\n A[Alpha] --> B[Beta]`);
    expect(host.querySelector(".diagrams-editor-slot")).not.toBeNull();
    expect(host.querySelector("[role='toolbar']")).not.toBeNull();
    expect(editor().getAttribute("aria-autocomplete")).toBe("list");
  });

  it("clears open completion on a foreign preset, then restores guided editing for a flowchart", async () => {
    await render("flowchart LR\n A --> B");
    await input("flowchart LR\n A --> c");
    expect(host.querySelector("[role='listbox']")).not.toBeNull();
    await render("%% graph LR in a comment\nclassDiagram\n class Order");
    expectPlain();
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(onChange).not.toHaveBeenCalled();
    await render("graph LR\n A --> B");
    expect(host.querySelector(".diagrams-editor-slot")).not.toBeNull();
  });

  it("switches to plain editing when the draft declaration changes", async () => {
    await render("flowchart LR\n A --> B");
    await input("classDiagram\n class Order");
    expectPlain();
    await input("graph LR\n A --> B");
    expect(host.querySelector(".diagrams-editor-slot")).not.toBeNull();
  });
});
