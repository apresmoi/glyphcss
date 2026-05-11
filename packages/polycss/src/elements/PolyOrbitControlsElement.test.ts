/**
 * <poly-orbit-controls> element tests.
 *
 * Covers: registration, attribute parsing, attachment to parent scene,
 * attribute-change lifecycle, and disconnect cleanup.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PolySceneElement } from "./PolySceneElement";
import { PolyOrbitControlsElement } from "./PolyOrbitControlsElement";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-orbit-controls")) {
    customElements.define("poly-orbit-controls", PolyOrbitControlsElement);
  }
});

let rafQueue: Array<(now: number) => void> = [];
let rafId = 0;

function installManualRaf(): void {
  rafQueue = [];
  rafId = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
    rafQueue = [];
  });
}

describe("PolyOrbitControlsElement", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    installManualRaf();
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
    vi.restoreAllMocks();
  });

  // ── Registration ─────────────────────────────────────────────────────────
  it("is registered as <poly-orbit-controls>", () => {
    expect(customElements.get("poly-orbit-controls")).toBe(PolyOrbitControlsElement);
  });

  it("declares the documented observed attributes", () => {
    const observed = PolyOrbitControlsElement.observedAttributes;
    expect(observed).toContain("drag");
    expect(observed).toContain("wheel");
    expect(observed).toContain("dolly");
    expect(observed).toContain("min-distance");
    expect(observed).toContain("max-distance");
    expect(observed).toContain("invert");
    expect(observed).toContain("zoom-min");
    expect(observed).toContain("zoom-max");
    expect(observed).toContain("animate-speed");
    expect(observed).toContain("animate-axis");
    expect(observed).toContain("animate-pause-on-interaction");
  });

  // ── Attachment ───────────────────────────────────────────────────────────
  it("creates controls when nested inside <poly-scene>", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    // Default options → drag enabled → host gets the grab cursor
    expect(sceneEl.style.cursor).toBe("grab");
    expect(sceneEl.style.touchAction).toBe("none");
  });

  it("no-ops when inserted with no parent <poly-scene>", () => {
    const orphan = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    host.appendChild(orphan);
    expect(host.style.cursor).toBe("");
    expect(rafQueue.length).toBe(0);
  });

  // ── Attribute parsing ─────────────────────────────────────────────────────
  it("drag='false' disables drag (no grab cursor)", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    controlsEl.setAttribute("drag", "false");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(sceneEl.style.cursor).toBe("");
  });

  it("animate-speed attribute starts the rAF loop", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    controlsEl.setAttribute("animate-speed", "0.5");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(rafQueue.length).toBe(1);
  });

  it("no animate-* attribute → no rAF", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(rafQueue.length).toBe(0);
  });

  it("zoom-min / zoom-max enforce clamp via wheel", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    controlsEl.setAttribute("zoom-min", "0.5");
    controlsEl.setAttribute("zoom-max", "2");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    const scene = sceneEl.getScene()!;
    for (let i = 0; i < 20; i++) {
      sceneEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1000 }));
    }
    expect(scene.getOptions().zoom).toBe(2);
  });

  // ── Live attribute changes ────────────────────────────────────────────────
  it("adding animate-speed after construction starts the rAF loop", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(rafQueue.length).toBe(0);
    controlsEl.setAttribute("animate-speed", "1");
    expect(rafQueue.length).toBe(1);
  });

  it("removing animate-speed stops the rAF loop", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    controlsEl.setAttribute("animate-speed", "1");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(rafQueue.length).toBe(1);
    controlsEl.removeAttribute("animate-speed");
    expect(rafQueue.length).toBe(0);
  });

  // ── Dolly / distance attributes ──────────────────────────────────────────
  it("dolly attribute enables dolly mode (wheel changes distance not zoom)", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    controlsEl.setAttribute("dolly", "");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    const scene = sceneEl.getScene()!;
    const beforeZoom = scene.getOptions().zoom;
    sceneEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 200 }));
    // In dolly mode zoom must remain unchanged
    expect(scene.getOptions().zoom).toBe(beforeZoom);
    expect(scene.getOptions().distance ?? 0).toBeGreaterThan(0);
  });

  it("max-distance attribute clamps the dolly distance", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    controlsEl.setAttribute("dolly", "");
    controlsEl.setAttribute("max-distance", "10");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    const scene = sceneEl.getScene()!;
    for (let i = 0; i < 20; i++) {
      sceneEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 1000 }));
    }
    expect(scene.getOptions().distance ?? 0).toBeLessThanOrEqual(10);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  it("disconnectedCallback destroys controls and clears cursor", () => {
    const sceneEl = document.createElement("poly-scene") as PolySceneElement;
    const controlsEl = document.createElement("poly-orbit-controls") as PolyOrbitControlsElement;
    controlsEl.setAttribute("animate-speed", "1");
    sceneEl.appendChild(controlsEl);
    host.appendChild(sceneEl);
    expect(rafQueue.length).toBe(1);
    sceneEl.removeChild(controlsEl);
    expect(rafQueue.length).toBe(0);
    expect(sceneEl.style.cursor).toBe("");
  });
});
