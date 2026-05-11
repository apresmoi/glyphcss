/**
 * <poly-perspective-camera> — standalone perspective camera element.
 *
 * Wraps `createPolyPerspectiveCamera`. Unlike <poly-scene> which owns the
 * scene DOM, this element provides a camera context that child controls can
 * read. It creates a `<div class="polycss-camera">` wrapper with the
 * CSS `perspective` property set.
 *
 * Attributes (all optional):
 *   perspective   — number, CSS perspective in pixels (default 8000)
 *   zoom          — number
 *   rot-x         — number, degrees (default 65)
 *   rot-y         — number, degrees (default 45)
 *   target        — "x,y,z" comma-separated world coordinates
 *   distance      — number, camera pull-back in CSS pixels
 */
import {
  createPolyPerspectiveCamera,
  type PolyPerspectiveCameraHandle,
} from "../api/createPolyCamera";
import { parseNumber, parseVec3 } from "./parseAttr";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "perspective",
  "zoom",
  "rot-x",
  "rot-y",
  "target",
  "distance",
] as const;


export class PolyPerspectiveCameraElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _camera: PolyPerspectiveCameraHandle | null = null;
  private _wrapper: HTMLElement | null = null;

  /** Returns the camera handle, or null if not yet connected. */
  getCamera(): PolyPerspectiveCameraHandle | null {
    return this._camera;
  }

  private _readOptions() {
    return {
      perspective: parseNumber(this.getAttribute("perspective")),
      zoom: parseNumber(this.getAttribute("zoom")),
      rotX: parseNumber(this.getAttribute("rot-x")),
      rotY: parseNumber(this.getAttribute("rot-y")),
      target: parseVec3(this.getAttribute("target")),
      distance: parseNumber(this.getAttribute("distance")),
    };
  }

  private _mount(): void {
    if (this._camera) return;
    const opts = this._readOptions();
    this._camera = createPolyPerspectiveCamera(opts);
    this._wrapper = this.ownerDocument!.createElement("div");
    this._wrapper.className = "polycss-camera";
    this._wrapper.style.perspective = this._camera.perspectiveStyle;
    // Move existing children into the wrapper
    while (this.firstChild) {
      this._wrapper.appendChild(this.firstChild);
    }
    this.appendChild(this._wrapper);
    this.dispatchEvent(new CustomEvent("polycss:camera-ready", { bubbles: false }));
  }

  private _teardown(): void {
    // Move children back out of the wrapper
    if (this._wrapper) {
      while (this._wrapper.firstChild) {
        this.insertBefore(this._wrapper.firstChild, this._wrapper);
      }
      if (this._wrapper.parentNode) this._wrapper.parentNode.removeChild(this._wrapper);
      this._wrapper = null;
    }
    this._camera = null;
  }

  connectedCallback(): void {
    this._mount();
  }

  disconnectedCallback(): void {
    this._teardown();
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._camera || !this._wrapper) return;
    const opts = this._readOptions();
    // Re-create camera with new options (options like perspective require re-creation).
    // createPolyPerspectiveCamera already applies all opts in its constructor.
    this._camera = createPolyPerspectiveCamera(opts);
    this._wrapper.style.perspective = this._camera.perspectiveStyle;
  }
}
