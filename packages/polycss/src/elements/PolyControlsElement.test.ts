/**
 * <poly-controls> custom element tests — registration, attribute parsing,
 * parent-scene attachment (incl. the upgrade-after-children case), live
 * attribute changes, and disconnect cleanup.
 *
 * Note: behavior of drag/wheel/animate themselves is covered exhaustively
 * in createPolyControls.test.ts. This file focuses on the element's job:
 * mapping kebab-case attributes to PolyControlsOptions and lifecycle
 * coordination with <poly-scene>.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PolySceneElement } from "./PolySceneElement";
import { PolyControlsElement } from "./PolyControlsElement";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-controls")) {
    customElements.define("poly-controls", PolyControlsElement);
  }
});

// Manual rAF queue so animate ticks don't fire spontaneously during tests.
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

describe("PolyControlsElement", () => {
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

  // ── Registration ────────────────────────────────────────────────────────
  describe("registration", () => {
    it("is registered as <poly-controls>", () => {
      expect(customElements.get("poly-controls")).toBe(PolyControlsElement);
    });

    it("declares the documented observed attributes", () => {
      const observed = PolyControlsElement.observedAttributes;
      expect(observed).toContain("drag");
      expect(observed).toContain("wheel");
      expect(observed).toContain("invert");
      expect(observed).toContain("zoom-min");
      expect(observed).toContain("zoom-max");
      expect(observed).toContain("animate-speed");
      expect(observed).toContain("animate-axis");
      expect(observed).toContain("animate-pause-on-interaction");
    });
  });

  // ── Attachment ──────────────────────────────────────────────────────────
  describe("attaches to parent <poly-scene>", () => {
    it("creates controls when nested inside <poly-scene>", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      // Default options → drag enabled → host gets the grab cursor + touch-action.
      const sceneHost = sceneEl;
      expect(sceneHost.style.cursor).toBe("grab");
      expect(sceneHost.style.touchAction).toBe("none");
    });

    it("survives the upgrade-after-children case (controls connects before scene)", () => {
      // Build the tree detached so connectedCallback hasn't fired yet for
      // either element.
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      sceneEl.appendChild(controlsEl);
      // happy-dom may upgrade in either order; the element is supposed to
      // listen for `polycss:scene-ready` if the scene isn't ready yet.
      host.appendChild(sceneEl);
      // After connection, controls should be attached and the host styled.
      expect(sceneEl.style.cursor).toBe("grab");
    });

    it("no-ops when inserted with no parent <poly-scene>", () => {
      const orphan = document.createElement("poly-controls") as PolyControlsElement;
      host.appendChild(orphan);
      // No throw, no host styling, no rAF queued.
      expect(host.style.cursor).toBe("");
      expect(rafQueue.length).toBe(0);
    });
  });

  // ── Attribute parsing → options ─────────────────────────────────────────
  describe("attribute → options coercion", () => {
    it("drag absent → default true (host gets grab cursor)", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(sceneEl.style.cursor).toBe("grab");
    });

    it('drag="false" disables drag (no grab cursor)', () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      controlsEl.setAttribute("drag", "false");
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(sceneEl.style.cursor).toBe("");
    });

    it("animate-* attribute presence implies animate is on (queues rAF)", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      controlsEl.setAttribute("animate-speed", "0.5");
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(rafQueue.length).toBe(1);
    });

    it("no animate-* attribute → animate stays off (no rAF queued)", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(rafQueue.length).toBe(0);
    });

    it("animate-axis='x' rotates rotX, leaves rotY untouched", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      // Set rotX/rotY explicitly so getOptions returns concrete values
      // — otherwise both default to undefined and the assertion is trivially true.
      sceneEl.setAttribute("rot-x", "30");
      sceneEl.setAttribute("rot-y", "60");
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      controlsEl.setAttribute("animate-speed", "1");
      controlsEl.setAttribute("animate-axis", "x");
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      const scene = sceneEl.getScene()!;
      expect(scene.getOptions().rotX).toBe(30);
      expect(scene.getOptions().rotY).toBe(60);
      rafQueue.shift()?.(16.67);
      expect(scene.getOptions().rotX).not.toBe(30);
      expect(scene.getOptions().rotY).toBe(60);
    });

    it("invert as numeric string parses as a sensitivity multiplier", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      controlsEl.setAttribute("invert", "2");
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      const scene = sceneEl.getScene()!;
      const before = scene.getOptions().rotY ?? 45;
      sceneEl.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true, clientX: 100, clientY: 100 }),
      );
      sceneEl.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 }),
      );
      sceneEl.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true, clientX: 200, clientY: 100 }),
      );
      // Drag tracks the pointer (default direction = -dX/4); invert:2
      // multiplies sensitivity in the same default direction → -50 deg.
      expect(scene.getOptions().rotY).toBeCloseTo(((before - 50) % 360 + 360) % 360, 1);
    });

    it("zoom-min / zoom-max enforce clamp via wheel", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      controlsEl.setAttribute("zoom-min", "0.5");
      controlsEl.setAttribute("zoom-max", "2");
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      const scene = sceneEl.getScene()!;
      // Huge zoom-in — should saturate at 2.
      for (let i = 0; i < 20; i++) {
        sceneEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1000 }));
      }
      expect(scene.getOptions().zoom).toBe(2);
    });
  });

  // ── Live attribute changes → controls.update() ──────────────────────────
  describe("attributeChangedCallback", () => {
    it("flipping animate-speed on after construction starts the rAF loop", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(rafQueue.length).toBe(0);
      controlsEl.setAttribute("animate-speed", "1");
      expect(rafQueue.length).toBe(1);
    });

    it("removing animate-speed stops the rAF loop", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      controlsEl.setAttribute("animate-speed", "1");
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(rafQueue.length).toBe(1);
      controlsEl.removeAttribute("animate-speed");
      expect(rafQueue.length).toBe(0);
    });

    it('toggling drag="false" mid-life detaches drag handlers', () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(sceneEl.style.cursor).toBe("grab");
      controlsEl.setAttribute("drag", "false");
      expect(sceneEl.style.cursor).toBe("");
    });
  });

  // ── Disconnect cleanup ──────────────────────────────────────────────────
  describe("disconnectedCallback", () => {
    it("destroys controls when removed from the DOM", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      controlsEl.setAttribute("animate-speed", "1");
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      expect(rafQueue.length).toBe(1);
      sceneEl.removeChild(controlsEl);
      expect(rafQueue.length).toBe(0);
      // Cursor on host (which is the scene element here) reflects detach.
      expect(sceneEl.style.cursor).toBe("");
    });

    it("safe to remove and re-insert the controls element", () => {
      const sceneEl = document.createElement("poly-scene") as PolySceneElement;
      const controlsEl = document.createElement("poly-controls") as PolyControlsElement;
      sceneEl.appendChild(controlsEl);
      host.appendChild(sceneEl);
      sceneEl.removeChild(controlsEl);
      expect(() => sceneEl.appendChild(controlsEl)).not.toThrow();
      expect(sceneEl.style.cursor).toBe("grab");
    });
  });
});
