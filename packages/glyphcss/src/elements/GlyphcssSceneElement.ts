/**
 * `<glyphcss-scene>` custom element. Vanilla counterpart to React's future GlyphcssScene.
 *
 * On `connectedCallback`, instantiates `createGlyphcssScene(this, options)`.
 * Children (`<glyphcss-mesh>`) walk up the tree to find this element and call
 * `getScene()` to register themselves.
 *
 * Attribute parsing mirrors `<poly-scene>` conventions.
 */
import {
  createGlyphcssScene,
  type GlyphcssSceneHandle,
  type GlyphcssSceneOptions,
} from "../api/createGlyphcssScene";
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

export class GlyphcssSceneElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _scene: GlyphcssSceneHandle | null = null;

  getScene(): GlyphcssSceneHandle | null {
    return this._scene;
  }

  private _readOptions(): GlyphcssSceneOptions {
    const opts: GlyphcssSceneOptions = {};
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
    return opts;
  }

  connectedCallback(): void {
    if (this._scene) return;
    this._scene = createGlyphcssScene(this, this._readOptions());
    this.dispatchEvent(new CustomEvent("glyphcss:scene-ready", { bubbles: false }));
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
