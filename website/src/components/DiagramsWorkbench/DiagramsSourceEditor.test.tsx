import { readFileSync } from "node:fs";
// @vitest-environment node
// `DiagramsSourceEditor` on its own: the debounced commit (idle, blur,
// external adoption), the keyboard ergonomics (Tab/Escape+Tab, Enter
// auto-indent, bracket pairs) and the gutter/error strip. No render
// pipeline in the loop — `DiagramsWorkbench.test.tsx` covers the editor
// mounted on the real page.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "Element", "Event", "KeyboardEvent", "InputEvent", "DataTransfer", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { DiagramsSourceEditor, type DiagramsSourceEditorHandle, type DiagramsSourceEditorProps, DIAGRAMS_EDITOR_LINE_PX } from "./DiagramsSourceEditor";
import { diagramsSourceSlots } from "./diagramsSourceSlots";
import { diagramsSourceSnippets } from "./diagramsSourceAid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiagramsSourceEditor", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
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
  const handle = createRef<DiagramsSourceEditorHandle>();
  async function mount(props: Partial<DiagramsSourceEditorProps> & { readonly onChange: (value: string) => void }) {
    const render = (next: Partial<DiagramsSourceEditorProps>) => root.render(<DiagramsSourceEditor ref={handle} id="ed" label="Source" form="graph" dialect="mermaid" value="flowchart LR\n  a --> b" {...props} {...next} />);
    await act(async () => render({}));
    return (next: Partial<DiagramsSourceEditorProps>) => act(async () => render(next));
  }
  /** Types `value` with the caret at its end (the input event carries the caret the completion reads). */
  async function typeAtEnd(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), value);
      textarea().setSelectionRange(value.length, value.length);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function type(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), value);
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function key(init: KeyboardEventInit & { key: string }) {
    await act(async () => { textarea().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
  }

  it("commits once after the idle delay, never per keystroke", async () => {
    // Mutation: call `onChange` directly from the input handler -> three
    // calls before the timer, red.
    vi.useFakeTimers();
    const onChange = vi.fn();
    await mount({ onChange, commitDelayMs: 150 });
    await type("flowchart LR\n  a --> b\n  b");
    await type("flowchart LR\n  a --> b\n  b -");
    await type("flowchart LR\n  a --> b\n  b --> c");
    expect(textarea().value).toBe("flowchart LR\n  a --> b\n  b --> c");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(149); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("flowchart LR\n  a --> b\n  b --> c");
  });

  it("flushes a pending draft on blur, immediately", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    await mount({ onChange });
    await type("flowchart LR\n  a --> z");
    await act(async () => { textarea().dispatchEvent(new Event("focusout", { bubbles: true })); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("flowchart LR\n  a --> z");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(onChange).toHaveBeenCalledTimes(1); // the timer was cancelled by the flush, not fired again
  });

  it("an external value change is adopted synchronously and cancels a pending commit — the outside world wins over a draft it never saw", async () => {
    // Mutation: drop the timer cancel in the adoption branch -> the stale
    // draft commits over the preset 150ms later -> red.
    vi.useFakeTimers();
    const onChange = vi.fn();
    const rerender = await mount({ onChange });
    await type("flowchart LR\n  a --> typed");
    await rerender({ value: "flowchart TB\n  preset --> applied" });
    expect(textarea().value).toBe("flowchart TB\n  preset --> applied");
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the CSS line height equals DIAGRAMS_EDITOR_LINE_PX — the overlay and the text share ONE line height (mutation: change either) → red", () => {
    // This pairing is load-bearing and was silently broken once: the JS
    // positions every field box, hotspot anchor and error stripe at
    // `line * DIAGRAMS_EDITOR_LINE_PX`, while the CSS renders the text at
    // `--diagrams-editor-line`. When they disagreed the highlight drifted
    // further from its own text on every line down the file. Nothing caught
    // it because no test read both.
    const css = readFileSync(new URL("./diagrams-workbench.css", import.meta.url), "utf8");
    const declared = /--diagrams-editor-line:\s*(\d+)px/.exec(css);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(DIAGRAMS_EDITOR_LINE_PX);
  });

  it("renders one gutter number per line, and places a located error on its line with code, message, hint and a jump button", async () => {
    await mount({ onChange: vi.fn(), value: "flowchart LR\n  a[Alpha] --> b[Beta]\n  b --> c[Broken\n  c --> a", error: { error: 'GLYPH_MERMAID_SYNTAX: glyphcss: GLYPH_MERMAID_SYNTAX: Missing "]" in "c[Broken".', code: "GLYPH_MERMAID_SYNTAX" } });
    const numbers = Array.from(container.querySelectorAll(".diagrams-editor-gutter span")).map((s) => s.textContent);
    expect(numbers).toEqual(["1", "2", "3", "4"]);
    expect(container.querySelector(".diagrams-editor-gutter span.is-error")!.textContent).toBe("3");
    expect(container.querySelector<HTMLElement>(".diagrams-editor-errline")!.style.top).toBe(`${2 * DIAGRAMS_EDITOR_LINE_PX}px`); // line 3 (0-based 2), derived so a line-height change does not silently break this
    const strip = container.querySelector("[role='alert']")!;
    expect(strip.id).toBe("ed-error");
    expect(textarea().getAttribute("aria-describedby")).toBe("ed-error ed-help");
    expect(strip.querySelector(".diagrams-editor-code")!.textContent).toBe("GLYPH_MERMAID_SYNTAX");
    expect(strip.querySelector(".diagrams-editor-message")!.textContent).toBe('Missing "]" in "c[Broken".');
    expect(strip.querySelector(".diagrams-editor-hint")!.textContent).toMatch(/close every shape/);
    await act(async () => strip.querySelector<HTMLButtonElement>(".diagrams-editor-jump")!.click());
    expect(textarea().selectionStart).toBe("flowchart LR\n  a[Alpha] --> b[Beta]\n".length);
  });

  it("an error the locator cannot place says so — `Line unknown`, disabled jump, no gutter marker — rather than pointing at line 1", async () => {
    await mount({ onChange: vi.fn(), error: { error: "GLYPH_DIAGRAM_UNROUTABLE: no lane", code: "GLYPH_DIAGRAM_UNROUTABLE" } });
    const jump = container.querySelector<HTMLButtonElement>(".diagrams-editor-jump")!;
    expect(jump.textContent).toBe("Line unknown");
    expect(jump.disabled).toBe(true);
    expect(container.querySelector(".diagrams-editor-gutter span.is-error")).toBeNull();
    expect(container.querySelector(".diagrams-editor-errline")).toBeNull();
  });

  const IDS = [{ id: "agent", label: "Agent" }, { id: "agenda" }, { id: "tools", label: "Tools" }];

  it("completion: typing an id prefix at an edge endpoint lists the matching ids; arrows move, Enter accepts and replaces the prefix", async () => {
    const onChange = vi.fn();
    await mount({ onChange, ids: IDS });
    await typeAtEnd("flowchart LR\n  tools --> ag");
    const list = container.querySelector("[role='listbox']")!;
    expect(list).not.toBeNull();
    expect(Array.from(list.querySelectorAll("[role='option']")).map((o) => o.textContent)).toEqual(["agentAgent", "agenda"]);
    expect(textarea().getAttribute("aria-expanded")).toBe("true");
    expect(textarea().getAttribute("aria-activedescendant")).toBe("ed-completions-0");
    await key({ key: "ArrowDown" });
    expect(list.querySelector("[aria-selected='true']")!.textContent).toBe("agenda");
    await key({ key: "Enter" });
    expect(textarea().value).toBe("flowchart LR\n  tools --> agenda");
    expect(container.querySelector("[role='listbox']")).toBeNull();
    expect(textarea().selectionStart).toBe("flowchart LR\n  tools --> agenda".length);
  });

  it("completion: nothing is offered for label text, and the lone exact id is not re-offered", async () => {
    await mount({ onChange: vi.fn(), ids: IDS });
    await typeAtEnd("flowchart LR\n  a[Ag");
    expect(container.querySelector("[role='listbox']")).toBeNull();
    await typeAtEnd("flowchart LR\n  tools");
    expect(container.querySelector("[role='listbox']")).toBeNull();
  });

  it("toolbar: a snippet inserts on its own line with the placeholder selected; the shape menu carries the live previews and syntax", async () => {
    const previews = { diamond: "  /\\  \n < L >\n  \\/  " };
    await mount({ onChange: vi.fn(), value: "flowchart LR\n  a --> b", snippets: diagramsSourceSnippets("graph", "mermaid"), previews });
    textarea().setSelectionRange(textarea().value.length, textarea().value.length);
    const edge = Array.from(container.querySelectorAll<HTMLButtonElement>(".diagrams-editor-tool")).find((b) => b.textContent === "+ Edge")!;
    await act(async () => edge.click());
    expect(textarea().value).toBe("flowchart LR\n  a --> b\n  from --> to");
    expect(textarea().value.slice(textarea().selectionStart, textarea().selectionEnd)).toBe("from");
    const trigger = container.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!;
    expect(trigger.textContent).toBe("+ Node ▾");
    await act(async () => trigger.click());
    const items = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
    expect(items.map((i) => i.querySelector(".diagrams-editor-shape-syntax")!.textContent)).toEqual(["id[Label]", "id(Label)", "id{Label}", "id((Label))", "id([Label])", "id[[Label]]", "id>Label]", ]);
    expect(items[2]!.querySelector(".diagrams-editor-shape-preview")!.textContent).toBe(previews.diamond);
    await act(async () => items[2]!.click());
    expect(textarea().value).toBe("flowchart LR\n  a --> b\n  from --> to\n  id{Label}");
    expect(textarea().value.slice(textarea().selectionStart, textarea().selectionEnd)).toBe("id");
    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("jumpToLine via the handle moves the caret to that line's start and clamps past the end", async () => {
    await mount({ onChange: vi.fn(), value: "a\nbb\nccc" });
    await act(async () => handle.current!.jumpToLine(3));
    expect(textarea().selectionStart).toBe(5);
    await act(async () => handle.current!.jumpToLine(99));
    expect(textarea().selectionStart).toBe(5);
    await act(async () => handle.current!.jumpToLine(1));
    expect(textarea().selectionStart).toBe(0);
  });

  // ── Guided mode (`diagramsSourceSlots.ts`) ──────────────────────────
  /** A native, cancelable `beforeinput` — what the browser fires before every edit; the guard decides on it. */
  async function beforeInput(init: { inputType: string; data?: string; paste?: string }): Promise<boolean> {
    let event: InputEvent;
    if (init.paste !== undefined) {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", init.paste);
      event = new InputEvent("beforeinput", { inputType: init.inputType, dataTransfer, bubbles: true, cancelable: true });
    } else event = new InputEvent("beforeinput", { inputType: init.inputType, data: init.data ?? null, bubbles: true, cancelable: true });
    let allowed = true;
    await act(async () => { allowed = textarea().dispatchEvent(event); });
    return allowed;
  }
  /** Place the caret (or a selection) and fire the `select` the browser would. */
  async function place(start: number, end = start) {
    // A `select` for browsers plus the `keyup` React's onSelect polyfill also listens to (happy-dom fires no selectionchange).
    await act(async () => { textarea().setSelectionRange(start, end); textarea().dispatchEvent(new Event("select", { bubbles: true })); textarea().dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "ArrowRight" })); });
  }
  const GUIDED = "flowchart LR\n  a[Alpha] --> b{Beta?}\n  b -->|yes| c";
  const refusal = () => container.querySelector(".diagrams-editor-refusal")?.textContent ?? null;

  it("every field is marked, the one under the caret is named, and a stray caret is redirected to the nearest field", async () => {
    await mount({ onChange: vi.fn(), value: GUIDED });
    expect(container.querySelector("#ed-help")!.textContent).toMatch(/Tab moves between fields/);
    const slots = diagramsSourceSlots("graph", "mermaid", GUIDED);
    expect(container.querySelectorAll(".diagrams-editor-slot").length).toBe(slots.length);
    await place(GUIDED.indexOf("Alpha") + 2);
    expect(container.querySelector(".diagrams-editor-field")!.textContent).toBe("Editing label");
    expect(container.querySelectorAll(".diagrams-editor-slot.is-active").length).toBe(1);
    // A click on the space before the arrow lands on the nearest field.
    // Mutation: drop the redirect in `onSelect` -> the caret stays on the
    // space (23) instead of the label's end (22) -> red.
    await place(GUIDED.indexOf(" -->"));
    expect(textarea().selectionStart).toBe(GUIDED.indexOf("Alpha") + 5);
  });

  it("typing into structure is refused with a reason; typing into a field is not; a field refuses the characters it cannot hold", async () => {
    // Mutation: drop the `!slot` refusal in the guard -> the arrow accepts
    // "x" -> red. Mutation: drop the cycle refusal -> the arrow accepts
    // typing -> red.
    await mount({ onChange: vi.fn(), value: GUIDED });
    const arrow = GUIDED.indexOf("-->") + 1;
    await act(async () => { textarea().setSelectionRange(arrow, arrow); });
    expect(await beforeInput({ inputType: "insertText", data: "x" })).toBe(false);
    expect(refusal()).toMatch(/fixed choice/);
    const gap = GUIDED.indexOf(" -->");
    await act(async () => { textarea().setSelectionRange(gap, gap); });
    expect(await beforeInput({ inputType: "insertText", data: "x" })).toBe(false);
    expect(refusal()).toMatch(/structure/);
    const label = GUIDED.indexOf("Alpha") + 5;
    await act(async () => { textarea().setSelectionRange(label, label); });
    expect(await beforeInput({ inputType: "insertText", data: "!" })).toBe(true);
    expect(await beforeInput({ inputType: "insertText", data: "]" })).toBe(false);
    expect(refusal()).toMatch(/cannot hold "\]"/);
    expect(container.querySelector(".diagrams-editor-slot.is-refused")).not.toBeNull();
  });

  it("deleting at a field's edge is refused; inside it is allowed; a selection spanning structure is refused", async () => {
    // Mutation: drop `from <= slot.start` from the backspace guard -> red.
    await mount({ onChange: vi.fn(), value: GUIDED });
    const a = GUIDED.indexOf("a[");
    await act(async () => { textarea().setSelectionRange(a, a); });
    expect(await beforeInput({ inputType: "deleteContentBackward" })).toBe(false);
    expect(await beforeInput({ inputType: "deleteContentForward" })).toBe(true);
    await act(async () => { textarea().setSelectionRange(a + 1, a + 1); });
    expect(await beforeInput({ inputType: "deleteContentForward" })).toBe(false);
    expect(await beforeInput({ inputType: "deleteContentBackward" })).toBe(true);
    await act(async () => { textarea().setSelectionRange(a, a + 4); });
    expect(await beforeInput({ inputType: "deleteContentBackward" })).toBe(false);
    expect(refusal()).toMatch(/spans structure/);
  });

  it("Tab and Shift+Tab walk the fields with the value selected; Enter moves on instead of breaking the line", async () => {
    await mount({ onChange: vi.fn(), value: GUIDED });
    await place(GUIDED.indexOf("a["));
    await key({ key: "Tab" });
    const selected = () => textarea().value.slice(textarea().selectionStart, textarea().selectionEnd);
    expect(selected()).toBe("[");
    await key({ key: "Tab" });
    expect(selected()).toBe("Alpha");
    await key({ key: "Tab", shiftKey: true });
    expect(selected()).toBe("[");
    expect(await beforeInput({ inputType: "insertParagraph" })).toBe(false);
    expect(selected()).toBe("Alpha");
    expect(textarea().value).toBe(GUIDED);
    expect(refusal()).toMatch(/toolbar/);
  });

  it("a cycle field changes with Space and the vertical arrows: an arrow kind, and a shape rewriting both brackets", async () => {
    await mount({ onChange: vi.fn(), value: GUIDED });
    const arrow = GUIDED.indexOf("-->");
    await place(arrow);
    await key({ key: " " });
    expect(textarea().value.split("\n")[1]).toBe("  a[Alpha] -.-> b{Beta?}");
    await key({ key: "ArrowUp" });
    expect(textarea().value.split("\n")[1]).toBe("  a[Alpha] --> b{Beta?}");
    await place(GUIDED.indexOf("a[") + 1, GUIDED.indexOf("a[") + 2); // the `[` selected, as Tab leaves it
    await key({ key: "ArrowDown" });
    expect(textarea().value.split("\n")[1]).toBe("  a(Alpha) --> b{Beta?}");
    expect(textarea().value.slice(textarea().selectionStart, textarea().selectionEnd)).toBe("(");
  });

  it("a choice field's ▾ lists its named choices with the held one marked; a pick rewrites the field — a shape's opener AND closer — as one edit", async () => {
    // Mutation: drop the trigger -> red. Mutation: drop the `pair` rewrite
    // from `diagramsSourceSlotChoose` -> the closer stays `]` -> red.
    // Mutation: drop the `value=` binding -> the held shape is not current -> red.
    const previews = { rounded: "( R )" };
    await mount({ onChange: vi.fn(), value: GUIDED, previews });
    // A cycle field owns a select whether or not the caret is in it — that is
    // what makes a FIRST click open the menu. Only the id one is caret-driven.
    expect(container.querySelector(".diagrams-editor-choice-select.is-adjacent")).toBeNull();
    await place(GUIDED.indexOf("a[") + 1, GUIDED.indexOf("a[") + 2); // the `[` selected, as Tab leaves it
    // A REAL `<select>`, not a bespoke popover — the platform owns the menu,
    // so the test asserts the control's own contract: its options, the held
    // value, and that changing it rewrites BOTH brackets as one edit.
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="shape choices"]')!;
    const labels = Array.from(select.options).map((o) => o.textContent!.split("   ")[0]);
    expect(labels).toEqual(["Rectangle", "Rounded", "Decision", "Circle", "Stadium", "Subroutine", "Asymmetric"]);
    expect(select.value).toBe(select.options[0]!.value); // the held shape is the current one
    expect(Array.from(select.options)[1]!.textContent).toContain("(Label)"); // its syntax rides in the option text
    expect(Array.from(select.options)[1]!.textContent).toContain("( R )");   // and so does the live preview
    await act(async () => {
      select.value = select.options[1]!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(textarea().value.split("\n")[1]).toBe("  a(Alpha) --> b{Beta?}");
  });

  it("a caret merely touching a one-character choice (a click on the bracket) still offers its select, and a pick lands on the shape", async () => {
    // Mutation: drop `adjacentChoice` -> the caret at the seam names the id, no select -> red.
    await mount({ onChange: vi.fn(), value: GUIDED });
    await place(GUIDED.indexOf("a[") + 1);
    expect(container.querySelector(".diagrams-editor-field")!.textContent).toBe("Editing node id");
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="shape choices"]')!;
    await act(async () => {
      select.value = select.options[3]!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(textarea().value.split("\n")[1]).toBe("  a((Alpha)) --> b{Beta?}");
    expect(textarea().value.slice(textarea().selectionStart, textarea().selectionEnd)).toBe("((");
  });

  it("an id field offers the ids that EXIST as a native select — an edge endpoint is a constrained set (mutation: drop the id-slot branch) → red", async () => {
    // USER FEEDBACK, verbatim: "for the edges I should get a dropdown for any
    // from and to and style, because I have already the options for these
    // too ... anything that has a constrained set ... should be possible to
    // click and show a dropdown".
    const ids = [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta?" }, { id: "c", label: "Gamma" }];
    await mount({ onChange: vi.fn(), value: GUIDED, ids });
    await place(GUIDED.indexOf("--> b") + 4); // the edge's TARGET endpoint
    const select = container.querySelector<HTMLSelectElement>("select.diagrams-editor-choice-select.is-adjacent")!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["a", "b", "c"]);
    expect(select.value).toBe("b"); // the endpoint it currently names
    await act(async () => {
      select.value = "c";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(textarea().value.split("\n")[1]).toBe("  a[Alpha] --> c{Beta?}".replace("c{Beta?}", "c{Beta?}"));
  });

  it("caretPixel and the field boxes agree on a line's top — both count from zero (mutation: drop the -1 in caretPixel) → red", async () => {
    // The field boxes and the error stripe always used `(line - 1)`;
    // `caretPixel` used `lineColumnOf`'s own ONE-based line, so anything it
    // positioned — the choice `<select>`, the completion list — sat a full
    // line below the text it belonged to. Both must count from zero.
    await mount({ onChange: vi.fn(), value: GUIDED });
    await place(GUIDED.indexOf("a[") + 1, GUIDED.indexOf("a[") + 2); // the `[` on line 2
    const box = container.querySelector<HTMLElement>(".diagrams-editor-slot.is-active")!;
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="shape choices"]')!;
    // The field box counts from zero already, so it pins the right line.
    expect(box.style.top).toBe(`${DIAGRAMS_EDITOR_LINE_PX}px`);
    // Asserted as a DIFFERENCE, not an absolute pixel: the select adds the
    // textarea's own top padding, which the test DOM reports as empty.
    const padTop = parseFloat(getComputedStyle(textarea()).paddingTop) || 0;
    expect(parseFloat(select.style.top)).toBe(parseFloat(box.style.top) + padTop);
  });

  it("a choice control covers its OWN field only — a shape menu never sits over the label it opens (mutation: size it through `slot.pair.end`) → red", async () => {
    // The shape field is the opener alone; its closer rides in `pair` because
    // a CHOICE rewrites both. Sizing the control through the pair laid it
    // over `[Alpha]` entire, so the label underneath could not be clicked,
    // dragged over or caret-placed — selection, dead on the commonest field.
    await mount({ onChange: vi.fn(), value: GUIDED });
    await place(GUIDED.indexOf("a[") + 1, GUIDED.indexOf("a[") + 2);
    const widthOf = (role: string) => parseFloat(container.querySelector<HTMLSelectElement>(`select[aria-label="${role} choices"]`)!.style.width);
    // Self-calibrating, so no pixel constant: the arrow field on the same
    // line is three characters wide, which gives this DOM's character width.
    const charW = widthOf("arrow") / 3;
    // `a[Alpha]` — the shape field is ONE character. Through `pair.end` it
    // would measure seven.
    expect(widthOf("shape")).toBeCloseTo(charW, 5);
  });

  it("a choice applies to the field it was OFFERED for, never to the offsets it was rendered at (mutation: drop the held-value check in `chooseOption`) → red", async () => {
    // A native menu stays open across re-renders. Between the render that
    // offered the options and the `change` that picks one, an edit
    // elsewhere can shift every offset after it — and the write then lands
    // in the middle of whatever now sits at the old offsets. USER, on the
    // corrupted source this produced: "it puts more than one arrow... it
    // should only change the arrow there is".
    const SRC = "flowchart TD\n  a --> b;\n  b --> c;\n";
    await mount({ onChange: vi.fn(), value: SRC });
    const second = Array.from(container.querySelectorAll<HTMLSelectElement>('select[aria-label="arrow choices"]'))[1]!;
    // The text grows by one character BEFORE that arrow, while its menu is open.
    await type("flowchart TD\n  aa --> b;\n  b --> c;\n");
    await act(async () => { second.value = "==>"; second.dispatchEvent(new Event("change", { bubbles: true })); });
    // The second arrow — and only it — changed. The old offsets pointed one
    // character to the left, which is `b -`, not an arrow at all.
    expect(textarea().value).toBe("flowchart TD\n  aa --> b;\n  b ==> c;\n");
  });

  it("a choice whose field is GONE from the current text refuses, and says so — it never writes at the old offsets (mutation: drop the held-value check) → red", async () => {
    // The element outliving its own props is the residual case the stable
    // key cannot cover: here the text is changed underneath WITHOUT an input
    // event, so the control's slot is genuinely stale. Writing then lands
    // wherever those offsets now point, which is how a node id ended up with
    // an arrow inside it.
    const SRC = "flowchart TD\n  a --> b;\n  b --> c;\n";
    await mount({ onChange: vi.fn(), value: SRC });
    const second = Array.from(container.querySelectorAll<HTMLSelectElement>('select[aria-label="arrow choices"]'))[1]!;
    const moved = "flowchart TD\n  a --> b;\n  bbbbb;\n";
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea(), moved);
    await act(async () => { second.value = "==>"; second.dispatchEvent(new Event("change", { bubbles: true })); });
    // Nothing was written: no arrow anywhere became `==>`.
    expect(textarea().value).not.toContain("==>");
    expect(refusal()).toMatch(/moved while the menu was open/);
  });

  it("the item hovered on the RENDER marks its own fields in the rail, and never moves the caret (mutation: ignore `highlight`) → red", async () => {
    // USER, verbatim: "when we hover it on the rendering area we should see
    // it in the left sidebar highlighting — like you highlight the node and
    // you know where the node is in the sidebar". The render draws nothing
    // itself, so this mark is the whole answer.
    const rerender = await mount({ onChange: vi.fn(), value: GUIDED });
    expect(container.querySelectorAll(".diagrams-editor-slot.is-highlight")).toHaveLength(0);
    const caretBefore = textarea().selectionStart;
    await rerender({ highlight: { kind: "node", id: "b" } });
    const marked = Array.from(container.querySelectorAll<HTMLElement>(".diagrams-editor-slot.is-highlight"));
    expect(marked.length).toBeGreaterThan(0);
    // `b{Beta?}` is declared on line 2, so every mark sits on that line.
    for (const el of marked) expect(el.style.top).toBe(`${DIAGRAMS_EDITOR_LINE_PX}px`);
    // Hovering is not selecting: the caret stayed where it was.
    expect(textarea().selectionStart).toBe(caretBefore);
    await rerender({ highlight: null });
    expect(container.querySelectorAll(".diagrams-editor-slot.is-highlight")).toHaveLength(0);
  });

  it("a JSON enum lists its choices too — the graph shape by name, with its live preview", async () => {
    const json = '{\n  "nodes": [{ "id": "a", "shape": "rect" }],\n  "edges": []\n}';
    await mount({ onChange: vi.fn(), dialect: "json", value: json, previews: { diamond: "<D>" } });
    await place(json.indexOf("rect") + 1);
    // Same native control on the JSON tab — and `cylinder` is offered here,
    // where the Mermaid adapter cannot parse `[( )]`.
    // The JSON slot's role carries its own quotes (`"shape"`), so find the
    // control by what it OFFERS rather than by a label spelling.
    const select = Array.from(container.querySelectorAll<HTMLSelectElement>("select.diagrams-editor-choice-select"))
      .find((el) => Array.from(el.options).some((o) => o.textContent!.startsWith("Rectangle")))!;
    const labels = Array.from(select.options).map((o) => o.textContent!.split("   ")[0]);
    expect(labels).toEqual(["Rectangle", "Rounded", "Decision", "Circle", "Stadium", "Subroutine", "Asymmetric", "Cylinder"]);
    expect(Array.from(select.options)[2]!.textContent).toContain("<D>"); // the live preview rides in the option text
    await act(async () => {
      select.value = select.options[2]!.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(textarea().value).toContain('"shape": "diamond"');
  });

  it("selectItem selects a node's label so the next keystroke replaces it, and the caret's field reports its item upward — once per item, not per keystroke", async () => {
    // Mutation: make `selectItem` only place the caret (no selection) ->
    // the selected text is "" -> red. Mutation: report on every caret move
    // -> the second `place` inside the same label adds a call -> red.
    const onSelectionChange = vi.fn();
    await mount({ onChange: vi.fn(), value: GUIDED, onSelectionChange });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    let selected = false;
    await act(async () => { selected = handle.current!.selectItem({ kind: "node", id: "b" }); });
    expect(selected).toBe(true);
    expect(textarea().value.slice(textarea().selectionStart, textarea().selectionEnd)).toBe("Beta?");
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "node", id: "b" });
    const calls = onSelectionChange.mock.calls.length;
    await place(GUIDED.indexOf("Beta?") + 2);
    expect(onSelectionChange.mock.calls.length).toBe(calls);
    await place(GUIDED.indexOf("yes"));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "edge", from: "b", to: "c" });
    await act(async () => { selected = handle.current!.selectItem({ kind: "edge", from: "b", to: "c" }); });
    expect(selected).toBe(true);
    expect(textarea().value.slice(textarea().selectionStart, textarea().selectionEnd)).toBe("yes");
    await act(async () => { selected = handle.current!.selectItem({ kind: "node", id: "nope" }); });
    expect(selected).toBe(false);
  });

  it("a single-line paste is routed into the field: characters the field cannot hold are dropped, and it says so", async () => {
    await mount({ onChange: vi.fn(), value: GUIDED });
    const a = GUIDED.indexOf("a[");
    await act(async () => { textarea().setSelectionRange(a, a + 1); });
    expect(await beforeInput({ inputType: "insertFromPaste", paste: "new node!" })).toBe(false);
    expect(textarea().value.split("\n")[1]).toBe("  newnode[Alpha] --> b{Beta?}");
    expect(refusal()).toMatch(/Pasted into the node id/);
  });

  it("Escape then Tab is NOT captured, so focus can leave; a plain Tab is", async () => {
    await mount({ onChange: vi.fn(), value: GUIDED });
    await place(GUIDED.indexOf("a["));
    await key({ key: "Escape" });
    const release = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    await act(async () => { textarea().dispatchEvent(release); });
    expect(release.defaultPrevented).toBe(false);
    const walk = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    await act(async () => { textarea().dispatchEvent(walk); });
    expect(walk.defaultPrevented).toBe(true);
  });

  it("a broken line becomes a repair field that takes any character and line breaks; the other lines stay masked", async () => {
    // Mutation: drop `diagramsSourceRepairSlots` from the slot memo -> `]`
    // is refused in the label and Enter is intercepted -> red.
    const broken = "flowchart LR\n  a[Alpha --> b\n  b --> c";
    await mount({ onChange: vi.fn(), value: broken, error: { error: "GLYPH_MERMAID_SYNTAX: glyphcss: GLYPH_MERMAID_SYNTAX: Unclosed quoted label, node shape, edge text, or edge label.", code: "GLYPH_MERMAID_SYNTAX" } });
    expect(container.querySelector("#ed-help")!.textContent).toMatch(/Line 2 is free to edit until it parses/);
    expect(container.querySelectorAll(".diagrams-editor-slot.is-repair").length).toBe(1);
    const inLabel = broken.indexOf("Alpha") + 5;
    await act(async () => { textarea().setSelectionRange(inLabel, inLabel); });
    expect(await beforeInput({ inputType: "insertText", data: "]" })).toBe(true);
    expect(await beforeInput({ inputType: "insertParagraph" })).toBe(true);
    expect(container.querySelector("#ed-help")!.textContent).toMatch(/Repairing this line/);
    // Line 3 is still masked: its arrow refuses typing.
    const arrow = broken.indexOf("b --> c") + 3;
    await act(async () => { textarea().setSelectionRange(arrow, arrow); });
    expect(await beforeInput({ inputType: "insertText", data: "x" })).toBe(false);
  });

  it("a failure that names no line opens every line for repair", async () => {
    await mount({ onChange: vi.fn(), dialect: "json", value: "{", error: { error: "GLYPH_DIAGRAM_BAD_JSON: Invalid JSON: Unexpected end of input", code: "GLYPH_DIAGRAM_BAD_JSON" } });
    expect(container.querySelector("#ed-help")!.textContent).toMatch(/every line is free to edit/);
    await act(async () => { textarea().setSelectionRange(1, 1); });
    expect(await beforeInput({ inputType: "insertText", data: "}" })).toBe(true);
  });

  it("a multi-line paste replaces the whole source (one undo step) and says so; a single-line paste stays a field value", async () => {
    // Mutation: drop the whole-source branch -> the multi-line clipboard is
    // squeezed into the id field -> red.
    await mount({ onChange: vi.fn(), value: GUIDED });
    const a = GUIDED.indexOf("a[");
    await act(async () => { textarea().setSelectionRange(a, a + 1); });
    expect(await beforeInput({ inputType: "insertFromPaste", paste: "flowchart TB\n  x --> y" })).toBe(false);
    expect(textarea().value).toBe("flowchart TB\n  x --> y");
    expect(refusal()).toMatch(/Replaced the whole source/);
  });

  it("after Escape closes the completion list, Tab still walks the fields — it does not leave the editor", async () => {
    await mount({ onChange: vi.fn(), value: GUIDED, ids: [{ id: "alpha" }, { id: "beta" }] });
    const c = GUIDED.length;
    await typeAtEnd(GUIDED.replace(/c$/, "al"));
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
    await key({ key: "Escape" });
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    await act(async () => { textarea().dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(textarea().value.length).toBe(c + 1);
  });

  it("with no error there is no alert, and the textarea is described by the keyboard help only", async () => {
    await mount({ onChange: vi.fn() });
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(textarea().getAttribute("aria-describedby")).toBe("ed-help");
    expect(textarea().getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector("#ed-help")!.textContent).toMatch(/Tab moves between fields/);
  });
});
