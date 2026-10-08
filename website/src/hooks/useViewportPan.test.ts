// @vitest-environment happy-dom
import "../test/dom";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewportPan } from "./useViewportPan";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, viewport: HTMLDivElement, node: HTMLButtonElement;
let overflow: boolean;
let pan: ReturnType<typeof useViewportPan>;
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
const selected = vi.fn();
function Harness({ resetKey = 0 }: { resetKey?: number }) {
  const view = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  pan = useViewportPan(view, content, resetKey);
  return createElement(
    "div",
    { ref: view, tabIndex: 0 },
    createElement("div", { ref: content }, createElement("button", { onClick: selected }, "Node")),
  );
}
beforeEach(() => {
  overflow = true;
  selected.mockClear();
  disconnect.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(element: HTMLElement) {
        if (element.tagName !== "DIV" || element.querySelector("div") === null) return;
        Object.defineProperties(element, {
          clientWidth: { configurable: true, get: () => 100 },
          clientHeight: { configurable: true, get: () => 80 },
          scrollWidth: { configurable: true, get: () => (overflow ? 400 : 100) },
          scrollHeight: { configurable: true, get: () => (overflow ? 300 : 80) },
        });
        element.setPointerCapture = vi.fn();
        element.hasPointerCapture = vi.fn(() => true);
        element.releasePointerCapture = vi.fn();
      }
      disconnect = disconnect;
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  viewport = host.firstElementChild as HTMLDivElement;
  node = host.querySelector("button")!;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function pointer(type: string, x: number, y: number, target: HTMLElement = viewport) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  act(() => target.dispatchEvent(event));
  return event;
}
function wheel(options: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", { deltaX: 10, deltaY: 20, bubbles: true, cancelable: true, ...options });
  Object.defineProperties(event, {
    ctrlKey: { value: options.ctrlKey ?? false },
    metaKey: { value: options.metaKey ?? false },
    shiftKey: { value: options.shiftKey ?? false },
  });
  act(() => viewport.dispatchEvent(event));
  return event;
}
function key(value: string, target: HTMLElement = viewport) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}
it("drags overflow without selecting a node on release, while ordinary clicks still select", () => {
  expect(pan.canPan).toBe(true);
  viewport.scrollLeft = 20;
  viewport.scrollTop = 30;
  pointer("pointerdown", 50, 50, node);
  pointer("pointermove", 30, 20);
  expect(viewport.scrollLeft).toBe(40);
  expect(viewport.scrollTop).toBe(60);
  expect(pan.isPanning).toBe(true);
  expect(viewport.setPointerCapture).toHaveBeenCalledWith(1);
  pointer("pointerup", 30, 20);
  act(() => node.click());
  expect(selected).not.toHaveBeenCalled();
  expect(pan.isPanning).toBe(false);
  pointer("pointerdown", 50, 50, node);
  pointer("pointermove", 52, 51);
  pointer("pointerup", 52, 51, node);
  act(() => node.click());
  expect(selected).toHaveBeenCalledOnce();
});
it("pans wheel and keyboard only on overflow and leaves control-wheel and node keys untouched", () => {
  expect(wheel().defaultPrevented).toBe(true);
  expect(viewport.scrollLeft).toBe(10);
  expect(viewport.scrollTop).toBe(20);
  expect(wheel({ ctrlKey: true }).defaultPrevented).toBe(false);
  expect(viewport.scrollTop).toBe(20);
  expect(key("ArrowDown").defaultPrevented).toBe(true);
  expect(viewport.scrollTop).toBe(60);
  expect(key("ArrowDown", node).defaultPrevented).toBe(false);
  expect(viewport.scrollTop).toBe(60);
  overflow = false;
  act(() => resize([], {} as ResizeObserver));
  expect(pan.canPan).toBe(false);
  expect(wheel().defaultPrevented).toBe(false);
  expect(key("ArrowDown").defaultPrevented).toBe(false);
  expect(viewport.scrollLeft).toBe(10);
  expect(viewport.scrollTop).toBe(60);
});
it("resets offsets explicitly and when the reset key changes", () => {
  wheel();
  act(() => pan.resetView());
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
  wheel();
  act(() => root.render(createElement(Harness, { resetKey: 1 })));
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
});
it("disconnects measurement and removes input handling on unmount", () => {
  act(() => root.unmount());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(wheel().defaultPrevented).toBe(false);
  expect(key("ArrowDown").defaultPrevented).toBe(false);
  pointer("pointerdown", 50, 50);
  pointer("pointermove", 10, 10);
  pointer("pointerup", 10, 10);
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
});

it.each(["pointercancel", "lostpointercapture"])("does not swallow later node clicks after %s", (cancelType) => {
  pointer("pointerdown", 50, 50, node);
  pointer("pointermove", 30, 20);
  expect(pan.isPanning).toBe(true);
  pointer(cancelType, 30, 20);
  expect(pan.isPanning).toBe(false);
  act(() => node.click());
  expect(selected).toHaveBeenCalledOnce();
});

it("ends a below-threshold drag released outside the viewport", () => {
  pointer("pointerdown", 50, 50, node);
  pointer("pointerup", 51, 50, document.body);
  pointer("pointermove", 10, 10);
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
  expect(pan.isPanning).toBe(false);
  act(() => node.click());
  expect(selected).toHaveBeenCalledOnce();
});
