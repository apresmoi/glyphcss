// @vitest-environment node
/**
 * The editor DRIVEN, not inspected: every choice control on real sources,
 * picked the way a reader picks one, checked against the one invariant that
 * matters — a choice changes its own field and nothing else, and the source
 * still parses afterwards.
 *
 * Why a separate suite. `DiagramsSourceEditor.test.tsx` asserts pieces:
 * this class marked, that control placed there. It passed while the page
 * corrupted its own source on nearly every dropdown, twice writing an arrow
 * into the middle of a node id (USER, verbatim: "its like it puts the
 * arrows in other places... its quite obvious that its not working, maybe we
 * can do some playwright testing or some unit test cases that actually
 * exercise the use of the editor"). Nothing caught it because:
 *
 *  1. No test drove two choices in a row, and the defect needed the text to
 *     have moved once already.
 *  2. `document.execCommand` DOES NOT EXIST in happy-dom, so every existing
 *     test took the fallback write path. Chrome takes the other one. The
 *     branch the product actually runs had never executed in a test.
 *
 * So this file installs `execCommand` with Chrome's own contract — it writes
 * at the FOCUSED element's caret, takes no target, and refuses when the
 * focused element is not a text control — and focuses each `<select>` before
 * changing it, which is what a real click does. That pairing is the whole
 * point: without it the suite proves nothing about the browser.
 */
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Event", "KeyboardEvent", "InputEvent", "DataTransfer", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
  // Chrome's `insertText`, faithfully: it edits whatever is focused, at that
  // element's own selection, and reports false when nothing editable is.
  // Steering it by setting some other element's selection does not work —
  // modelling that is what makes this suite able to see the real defect.
  Object.defineProperty(window.document, "execCommand", {
    configurable: true, writable: true,
    value: (command: string, _ui?: boolean, value?: string) => {
      if (command !== "insertText") return false;
      const active = window.document.activeElement as HTMLTextAreaElement | null;
      if (!active || active.tagName !== "TEXTAREA") return false;
      const { selectionStart: from, selectionEnd: to } = active;
      const next = `${active.value.slice(0, from)}${value ?? ""}${active.value.slice(to)}`;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(active, next);
      active.setSelectionRange(from + (value ?? "").length, from + (value ?? "").length);
      active.dispatchEvent(new window.Event("input", { bubbles: true }));
      return true;
    },
  });
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glyphGraphFromJson, glyphGraphFromMermaid, parseGlyphDiagramJson } from "@glyphcss/diagrams";
import { DiagramsSourceEditor } from "./DiagramsSourceEditor";
import { diagramsSourceSlots } from "../../../features/diagrams/model/diagramsSourceSlots";
import type { DiagramsSourceDialect } from "../../../features/diagrams/model/diagramsSourceTokens";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS } from "../../../features/diagrams/model/diagramsWorkbenchState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The text with every CHOICE field blanked out — a choice is allowed to
 * rewrite those and only those. Each text is masked through its OWN slots,
 * because picking a different shape changes how long its own field is.
 * A write that lands anywhere else (a label, an id, whitespace) survives the
 * mask and shows up as a difference.
 */
function maskChoiceFields(dialect: DiagramsSourceDialect, text: string): string {
  const spans = diagramsSourceSlots("graph", dialect, text)
    .filter((slot) => slot.kind === "cycle")
    .flatMap((slot) => (slot.pair ? [{ start: slot.start, end: slot.end }, slot.pair] : [{ start: slot.start, end: slot.end }]))
    .sort((a, b) => a.start - b.start);
  let out = "", at = 0;
  for (const span of spans) {
    if (span.start < at) continue; // a nested/duplicate span is already masked
    out += `${text.slice(at, span.start)}\u241F`;
    at = span.end;
  }
  return out + text.slice(at);
}

const parses = (dialect: DiagramsSourceDialect, text: string) => {
  try {
    if (dialect === "json") glyphGraphFromJson(parseGlyphDiagramJson(text));
    else glyphGraphFromMermaid(text);
    return true;
  } catch { return false; }
};

const LANGGRAPH = GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((p) => p.id === "langgraph")!.source;

const SOURCES: readonly { readonly name: string; readonly dialect: DiagramsSourceDialect; readonly text: string }[] = [
  // The preset the defect was reported on, verbatim — tabs, a `:::class`
  // suffix, an `%%{init}%%` directive, a labelled dotted edge whose arrow is
  // NOT one of the four offered, and ids that contain the same text as their
  // own labels (`__end__`), which is what made a misplaced write readable.
  { name: "langgraph preset", dialect: "mermaid", text: LANGGRAPH },
  { name: "shapes and direction", dialect: "mermaid", text: "flowchart TD\n  a[Alpha] --> b{Beta?}\n  b --> c((Gamma))\n  c -.-> d([Delta])\n" },
  { name: "graph JSON", dialect: "json", text: '{\n  "nodes": [\n    { "id": "a", "label": "Alpha", "shape": "rect" },\n    { "id": "b", "label": "Beta", "shape": "rounded" }\n  ],\n  "edges": [\n    { "from": "a", "to": "b", "style": "solid" }\n  ],\n  "direction": "TB"\n}' },
];

describe("DiagramsSourceEditor — every choice, driven", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  const textarea = () => container.querySelector("textarea")!;
  const choiceSelects = () => Array.from(container.querySelectorAll<HTMLSelectElement>("select.diagrams-editor-choice-select"));

  async function mount(dialect: DiagramsSourceDialect, value: string) {
    let current = value;
    const render = (next: string) => root.render(
      <DiagramsSourceEditor id="ed" label="Source" form="graph" dialect={dialect} value={next} onChange={(v) => { current = v; }} commitDelayMs={150} />,
    );
    await act(async () => render(value));
    return { get current() { return current; }, rerender: (next: string) => act(async () => render(next)) };
  }

  /**
   * What a click really does, in order: the control takes focus and the menu
   * opens — then TIME PASSES while the reader reads the options, and only
   * then does the value change. That gap is not cosmetic. The page commits
   * on a 150 ms idle timer and hands the value back, so a commit lands
   * mid-interaction and re-renders every control underneath the open menu.
   * A `pick` that focuses and changes in one tick never sees any of it.
   */
  async function pick(select: HTMLSelectElement, optionIndex: number, dwellMs = 300) {
    await act(async () => { select.focus(); });
    await act(async () => { vi.advanceTimersByTime(dwellMs); });   // the menu sits open
    await act(async () => {
      select.value = select.options[optionIndex]!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  for (const source of SOURCES) {
    it(`${source.name}: every option of every choice field rewrites that field and nothing else`, async () => {
      const before = maskChoiceFields(source.dialect, source.text);
      const count = (await (async () => { await mount(source.dialect, source.text); return choiceSelects().length; })());
      expect(count).toBeGreaterThan(0);
      for (let field = 0; field < count; field++) {
        const options = choiceSelects()[field]!.options.length;
        for (let option = 0; option < options; option++) {
          await act(async () => root.unmount());
          container.remove();
          container = document.createElement("div");
          document.body.append(container);
          root = createRoot(container);
          await mount(source.dialect, source.text);
          const select = choiceSelects()[field]!;
          const label = `${source.name} field ${field} (${select.getAttribute("aria-label")}) option ${select.options[option]!.value}`;
          await pick(select, option);
          const after = textarea().value;
          expect(maskChoiceFields(source.dialect, after), label).toBe(before);
          expect(parses(source.dialect, after), `${label} must still parse`).toBe(true);
        }
      }
    });

    it(`${source.name}: a long run of choices never writes outside a choice field`, async () => {
      // The defect needed the text to have MOVED once already: a write that
      // lands correctly the first time landed in a node id the second. So
      // this drives a whole session — choice after choice, the page handing
      // each committed value back the way it really does — and re-reads the
      // controls from the DOM every time, exactly as a reader does.
      const before = maskChoiceFields(source.dialect, source.text);
      const page = await mount(source.dialect, source.text);
      let seed = 7;
      const next = (limit: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % limit;
      for (let step = 0; step < 40; step++) {
        const selects = choiceSelects();
        if (selects.length === 0) break;
        const select = selects[next(selects.length)]!;
        const option = next(select.options.length);
        const chose = `${select.getAttribute("aria-label")} -> ${select.options[option]!.value}`;
        await pick(select, option);
        const after = textarea().value;
        expect(maskChoiceFields(source.dialect, after), `step ${step}: ${chose}\n${after}`).toBe(before);
        expect(parses(source.dialect, after), `step ${step}: ${chose} must still parse\n${after}`).toBe(true);
        await page.rerender(page.current); // the page hands the committed value back
      }
    });
  }
});
