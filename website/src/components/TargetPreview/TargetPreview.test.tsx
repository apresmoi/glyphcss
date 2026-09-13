// @vitest-environment node
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, createRef } from "react";
import { TargetPreview } from "./TargetPreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<React.ComponentProps<typeof TargetPreview>>) {
  const ref = createRef<HTMLPreElement>();
  act(() => {
    root.render(createElement(TargetPreview, {
      target: "web", commandTitle: "glyphcss chart …", isHtml: false, text: "hello",
      ...props, ref,
    } as React.ComponentProps<typeof TargetPreview> & { ref: typeof ref }));
  });
  return { container, ref };
}

describe("TargetPreview — frame per target", () => {
  it("web renders the pre directly with no chrome wrapper", () => {
    const { container } = render({ target: "web", text: "abc" });
    expect(container.querySelector(".target-preview--terminal")).toBeNull();
    expect(container.querySelector(".target-preview--chat")).toBeNull();
    expect(container.firstElementChild!.tagName).toBe("PRE");
    expect(container.querySelector("pre.glyph-output")!.textContent).toBe("abc");
  });

  it("web with isHtml renders the provided html", () => {
    const { container } = render({ target: "web", isHtml: true, html: "<span style=\"color:#ff0000\">x</span>", text: "x" });
    expect(container.querySelector("pre span")!.getAttribute("style")).toContain("color:#ff0000");
  });

  it("terminal renders a title bar naming the command and a black-chrome body", () => {
    const { container } = render({ target: "terminal", commandTitle: "glyphcss chart …", text: "plain" });
    expect(container.querySelector(".target-preview--terminal")).not.toBeNull();
    expect(container.querySelector(".target-preview__titlebar")!.textContent).toContain("glyphcss chart …");
    expect(container.querySelector("pre.glyph-output")).not.toBeNull();
  });

  it("terminal with an ansi string decodes it into coloured spans, not raw escape bytes", () => {
    const ansi = "\x1b[31mred\x1b[0m plain";
    const { container } = render({ target: "terminal", ansi, text: "red plain" });
    const pre = container.querySelector("pre.glyph-output")!;
    expect(pre.innerHTML).not.toContain("\x1b");
    expect(pre.querySelector("span")!.getAttribute("style")).toContain("color:#800000");
    expect(pre.textContent).toBe("red plain");
  });

  it("chat renders an assistant bubble with a fenced code block, plain text, no colour", () => {
    const { container } = render({ target: "chat", text: "chat output", ansi: undefined });
    expect(container.querySelector(".target-preview--chat")).not.toBeNull();
    expect(container.querySelector(".target-preview__bubble")).not.toBeNull();
    expect(container.querySelector(".target-preview__fence")).not.toBeNull();
    const pre = container.querySelector("pre.glyph-output")!;
    expect(pre.textContent).toBe("chat output");
    expect(pre.querySelector("span")).toBeNull();
  });

  it("forwards the ref to the actual content <pre>, regardless of target", () => {
    const { ref } = render({ target: "terminal", ansi: "\x1b[31mx\x1b[0m", text: "x" });
    expect(ref.current).not.toBeNull();
    expect(ref.current!.tagName).toBe("PRE");
    expect(ref.current!.className).toContain("glyph-output");
  });
});
