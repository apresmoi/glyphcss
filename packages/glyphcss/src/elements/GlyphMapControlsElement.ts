/**
 * `<glyph-map-controls>` — declarative map/pan controls.
 */
import { createGlyphMapControls, type GlyphMapControlsHandle } from "../api/createGlyphMapControls";
import type { GlyphSceneElement } from "./GlyphSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function parseBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "false") return false;
  if (value === "true" || value === "") return true;
  return undefined;
}

function findScene(el: HTMLElement): GlyphSceneElement | null {
  const found = el.closest("glyph-scene") as unknown as (GlyphSceneElement & { getScene?: () => unknown }) | null;
  return found ?? null;
}

export class GlyphMapControlsElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["drag", "wheel", "invert"];
  }

  private _controls: GlyphMapControlsHandle | null = null;

  connectedCallback(): void { this._attach(); }

  disconnectedCallback(): void {
    if (this._controls) { this._controls.destroy(); this._controls = null; }
  }

  attributeChangedCallback(_name: string, old: string | null, next: string | null): void {
    if (old === next) return;
    this._controls?.update(this._readOptions());
  }

  private _readOptions() {
    const drag = parseBool(this.getAttribute("drag"));
    const wheel = parseBool(this.getAttribute("wheel"));
    const invert = parseBool(this.getAttribute("invert"));
    return {
      ...(drag !== undefined ? { drag } : {}),
      ...(wheel !== undefined ? { wheel } : {}),
      ...(invert !== undefined ? { invert } : {}),
    };
  }

  private _attach(): void {
    if (this._controls) return;
    const sceneEl = findScene(this);
    if (!sceneEl) return;
    const handle = sceneEl.getScene();
    if (!handle) {
      const onReady = (): void => {
        sceneEl.removeEventListener("glyphcss:scene-ready", onReady);
        this._attach();
      };
      sceneEl.addEventListener("glyphcss:scene-ready", onReady);
      return;
    }
    this._controls = createGlyphMapControls(handle, this._readOptions());
  }
}
