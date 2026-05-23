/**
 * `<glyph-scene>` custom element.
 *
 * Must be placed inside a `<glyph-perspective-camera>` or
 * `<glyph-orthographic-camera>` element. On `connectedCallback`, walks up
 * `parentElement` until it finds a camera ancestor, then instantiates
 * `createGlyphScene(this, { camera, ...options })`.
 *
 * Children (`<glyph-mesh>`) walk up the tree to find this element and call
 * `getScene()` to register themselves.
 *
 * Attribute parsing mirrors `<poly-scene>` conventions.
 */
import {
  createGlyphScene,
  type GlyphSceneHandle,
  type GlyphSceneOptions,
} from "../api/createGlyphScene";
import type { RenderMode } from "@glyphcss/core";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "mode",
  "glyph-palette",
  "use-colors",
  "cols",
  "rows",
  "cell-aspect",
  "directional-direction",
  "directional-intensity",
  "ambient-intensity",
  "auto-size",
] as const;

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseMode(value: string | null): RenderMode | undefined {
  if (value === "wireframe" || value === "solid" || value === "voxel") return value;
  return undefined;
}

function parseBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "false") return false;
  if (value === "true" || value === "") return true;
  return undefined;
}

export class GlyphSceneElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _scene: GlyphSceneHandle | null = null;

  getScene(): GlyphSceneHandle | null {
    return this._scene;
  }

  private _readOptions(): GlyphSceneOptions {
    const opts: GlyphSceneOptions = {};
    const mode = parseMode(this.getAttribute("mode"));
    if (mode !== undefined) opts.mode = mode;
    const glyphPalette = this.getAttribute("glyph-palette");
    if (glyphPalette) opts.glyphPalette = glyphPalette;
    const useColors = parseBool(this.getAttribute("use-colors"));
    if (useColors !== undefined) opts.useColors = useColors;
    const cols = parseNumber(this.getAttribute("cols"));
    if (cols !== undefined) opts.cols = cols;
    const rows = parseNumber(this.getAttribute("rows"));
    if (rows !== undefined) opts.rows = rows;
    const cellAspect = parseNumber(this.getAttribute("cell-aspect"));
    if (cellAspect !== undefined) opts.cellAspect = cellAspect;
    const dirIntensity = parseNumber(this.getAttribute("directional-intensity"));
    if (dirIntensity !== undefined) opts.directionalLight = { direction: [0.5, 0.7, 0.5], intensity: dirIntensity };
    const ambIntensity = parseNumber(this.getAttribute("ambient-intensity"));
    if (ambIntensity !== undefined) opts.ambientLight = { intensity: ambIntensity };
    if (this.hasAttribute("auto-size")) opts.autoSize = true;
    return opts;
  }

  private _findCameraAncestor(): (HTMLElement & { getCamera?: () => unknown }) | null {
    let el: HTMLElement | null = this.parentElement;
    while (el) {
      const tag = el.tagName.toLowerCase();
      if (
        tag === "glyph-perspective-camera" ||
        tag === "glyph-orthographic-camera" ||
        tag === "glyph-camera"
      ) {
        return el as HTMLElement & { getCamera?: () => unknown };
      }
      el = el.parentElement;
    }
    return null;
  }

  private _initScene(cameraAncestor: HTMLElement & { getCamera?: () => unknown }): void {
    const camera = typeof cameraAncestor.getCamera === "function"
      ? (cameraAncestor.getCamera() as GlyphSceneOptions["camera"])
      : undefined;
    const opts = this._readOptions();
    if (camera) opts.camera = camera;
    this._scene = createGlyphScene(this, opts);
    this.dispatchEvent(new CustomEvent("glyphcss:scene-ready", { bubbles: false }));
  }

  connectedCallback(): void {
    if (this._scene) return;
    const cameraAncestor = this._findCameraAncestor();
    if (!cameraAncestor) {
      throw new Error(
        "glyphcss: <glyph-scene> must be placed inside a <glyph-camera>, <glyph-perspective-camera>, or <glyph-orthographic-camera>.",
      );
    }
    const cam = typeof cameraAncestor.getCamera === "function"
      ? (cameraAncestor.getCamera() as unknown)
      : null;
    if (cam !== null) {
      // Camera already created — initialize immediately.
      this._initScene(cameraAncestor);
    } else {
      // Camera element connected after scene (ordering edge case in some environments).
      // Wait for the camera-ready event.
      const onReady = () => {
        cameraAncestor.removeEventListener("glyph:camera-ready", onReady);
        if (!this._scene) this._initScene(cameraAncestor);
      };
      cameraAncestor.addEventListener("glyph:camera-ready", onReady);
    }
  }

  rerender(): void {
    this._scene?.rerender();
  }

  disconnectedCallback(): void {
    if (this._scene) {
      this._scene.destroy();
      this._scene = null;
    }
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._scene) return;
    this._scene.setOptions(this._readOptions());
  }
}
