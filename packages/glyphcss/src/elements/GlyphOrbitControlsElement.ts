/**
 * `<glyph-orbit-controls>` — declarative orbit controls.
 */
import { createGlyphOrbitControls, type GlyphOrbitControlsHandle } from "../api/createGlyphOrbitControls";
import type { GlyphSceneElement } from "./GlyphSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

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

export class GlyphOrbitControlsElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["drag", "wheel", "invert", "clamp-pitch", "animate-speed", "animate-axis"];
  }

  private _controls: GlyphOrbitControlsHandle | null = null;

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
    const clampPitch = parseBool(this.getAttribute("clamp-pitch"));
    const speed = parseNumber(this.getAttribute("animate-speed"));
    const axis: "x" | "y" = this.getAttribute("animate-axis") === "x" ? "x" : "y";
    return {
      ...(drag !== undefined ? { drag } : {}),
      ...(wheel !== undefined ? { wheel } : {}),
      ...(invert !== undefined ? { invert } : {}),
      ...(clampPitch !== undefined ? { clampPitch } : {}),
      ...(speed !== undefined ? { animate: { speed, axis } } : {}),
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
    this._controls = createGlyphOrbitControls(handle, this._readOptions());
  }
}
