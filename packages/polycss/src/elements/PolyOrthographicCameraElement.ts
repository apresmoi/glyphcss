/**
 * <poly-orthographic-camera> — standalone orthographic camera element.
 *
 * Wraps `createPolyOrthographicCamera`. Sets CSS `perspective: none` on the
 * camera wrapper, disabling perspective projection.
 *
 * Attributes (all optional):
 *   zoom          — number
 *   rot-x         — number, degrees (default 65)
 *   rot-y         — number, degrees (default 45)
 *   target        — "x,y,z" comma-separated world coordinates
 *   distance      — number, camera pull-back in CSS pixels
 */
import {
  createPolyOrthographicCamera,
  type PolyOrthographicCameraHandle,
} from "../api/createPolyCamera";
import { parseNumber, parseVec3 } from "./parseAttr";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "zoom",
  "rot-x",
  "rot-y",
  "target",
  "distance",
] as const;


export class PolyOrthographicCameraElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _camera: PolyOrthographicCameraHandle | null = null;
  private _wrapper: HTMLElement | null = null;

  /** Returns the camera handle, or null if not yet connected. */
  getCamera(): PolyOrthographicCameraHandle | null {
    return this._camera;
  }

  private _readOptions() {
    return {
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
    this._camera = createPolyOrthographicCamera(opts);
    this._wrapper = this.ownerDocument!.createElement("div");
    this._wrapper.className = "polycss-camera";
    this._wrapper.style.perspective = this._camera.perspectiveStyle;
    while (this.firstChild) {
      this._wrapper.appendChild(this.firstChild);
    }
    this.appendChild(this._wrapper);
    this.dispatchEvent(new CustomEvent("polycss:camera-ready", { bubbles: false }));
  }

  private _teardown(): void {
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
    if (!this._camera) return;
    const opts = this._readOptions();
    if (opts.zoom !== undefined) this._camera.update({ zoom: opts.zoom });
    if (opts.rotX !== undefined) this._camera.update({ rotX: opts.rotX });
    if (opts.rotY !== undefined) this._camera.update({ rotY: opts.rotY });
    if (opts.target !== undefined) this._camera.update({ target: opts.target });
    if (opts.distance !== undefined) this._camera.update({ distance: opts.distance });
  }
}
