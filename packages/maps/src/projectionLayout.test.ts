import { afterEach, expect, it, vi } from "vitest";
import { createGlyphMapProjectionLayout } from "./projectionLayout";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let resize!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const doc = document.implementation.createHTMLDocument("");
  const fonts = new EventTarget();
  Object.defineProperty(doc, "fonts", { value: fonts });
  const host = doc.createElement("div"), output = doc.createElement("pre");
  let width = 800, outputWidth = 640;
  const hostRead = vi.fn(() => ({ width, height: 600 }) as DOMRect);
  const outputRead = vi.fn(() => ({ width: outputWidth, height: 480 }) as DOMRect);
  host.getBoundingClientRect = hostRead; output.getBoundingClientRect = outputRead;
  const cache = createGlyphMapProjectionLayout(host, output);
  return { cache, host, output, hostRead, outputRead, fonts, resize: () => resize(), disconnect,
    width: (value: number) => { width = value; }, outputWidth: (value: number) => { outputWidth = value; } };
}

it("does no layout reads on unchanged frames and invalidates on resize/font/explicit fit", () => {
  const f = fixture();
  expect(f.cache.read(80, 30, 2).hostWidth).toBe(800);
  for (let i = 0; i < 10; i++) f.cache.read(80, 30, 2);
  expect(f.hostRead).toHaveBeenCalledTimes(1); expect(f.outputRead).toHaveBeenCalledTimes(1);
  f.width(900); f.resize(); expect(f.cache.read(80, 30, 2).hostWidth).toBe(900);
  f.outputWidth(700); f.fonts.dispatchEvent(new Event("loadingdone"));
  expect(f.cache.read(80, 30, 2).outputWidth).toBe(700);
  f.outputWidth(720); f.cache.invalidate(); expect(f.cache.read(80, 30, 2).outputWidth).toBe(720);
  f.cache.dispose(); expect(f.disconnect).toHaveBeenCalledOnce();
});

it("detects synchronous option, font-style, class and first-content changes before observer delivery", () => {
  const f = fixture(); f.cache.read(80, 30, 2);
  f.cache.read(40, 15, 2); expect(f.hostRead).toHaveBeenCalledTimes(2);
  f.cache.read(40, 15, 1.5); expect(f.hostRead).toHaveBeenCalledTimes(3);
  f.outputWidth(600); f.output.style.fontSize = "20px";
  expect(f.cache.read(40, 15, 1.5).outputWidth).toBe(600);
  f.width(1000); f.host.style.width = "1000px";
  expect(f.cache.read(40, 15, 1.5).hostWidth).toBe(1000);
  f.outputWidth(620); f.output.textContent = "M";
  expect(f.cache.read(40, 15, 1.5).outputWidth).toBe(620);
  f.outputWidth(630); f.output.className = "new-font";
  expect(f.cache.read(40, 15, 1.5).outputWidth).toBe(630);
  f.cache.dispose();
});

it("falls back to live measurement without ResizeObserver", () => {
  const f = fixture(); f.cache.dispose(); vi.stubGlobal("ResizeObserver", undefined);
  const cache = createGlyphMapProjectionLayout(f.host, f.output);
  expect(cache.read(80, 30, 2).hostWidth).toBe(800);
  f.width(900); expect(cache.read(80, 30, 2).hostWidth).toBe(900);
  cache.dispose();
});
