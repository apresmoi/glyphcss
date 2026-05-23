/**
 * `<glyph-orthographic-camera>` — outer host for an orthographic camera.
 * Creates the camera handle on connectedCallback and dispatches
 * `glyph:camera-ready` so descendant `<glyph-scene>` elements can adopt it.
 * Child `<glyph-scene>` walks up the DOM to find this element.
 */
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import type { GlyphCamera } from "../api/createGlyphCamera";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

export class GlyphOrthographicCameraElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["rot-x", "rot-y", "zoom"];
  }

  private _camera: GlyphCamera | null = null;

  getCamera(): GlyphCamera | null {
    return this._camera;
  }

  connectedCallback(): void {
    this._camera = createGlyphOrthographicCamera({
      rotX: parseNumber(this.getAttribute("rot-x")),
      rotY: parseNumber(this.getAttribute("rot-y")),
      zoom: parseNumber(this.getAttribute("zoom")),
    });
    this.dispatchEvent(new CustomEvent("glyph:camera-ready", { bubbles: false }));
  }

  disconnectedCallback(): void {
    this._camera = null;
  }

  attributeChangedCallback(_name: string, old: string | null, next: string | null): void {
    if (old === next) return;
    const camera = this._camera;
    if (!camera) return;
    const rotX = parseNumber(this.getAttribute("rot-x"));
    const rotY = parseNumber(this.getAttribute("rot-y"));
    const zoom = parseNumber(this.getAttribute("zoom"));
    let dirty = false;
    if (rotX !== undefined && camera.rotX !== rotX) { camera.rotX = rotX; dirty = true; }
    if (rotY !== undefined && camera.rotY !== rotY) { camera.rotY = rotY; dirty = true; }
    if (zoom !== undefined && camera.zoom !== zoom) { camera.zoom = zoom; dirty = true; }
    if (dirty) {
      const sceneEl = this.querySelector("glyph-scene") as (HTMLElement & { rerender?: () => void }) | null;
      sceneEl?.rerender?.();
    }
  }
}
