/**
 * `<glyph-hotspot at="x,y,z" size="3,2">` — declarative hit anchor.
 * Walks up to the parent `<glyph-scene>` and registers itself as a hotspot.
 * Normal DOM events (click, hover, focus) fire on the projected overlay element.
 */
import type { Vec3 } from "@glyphcss/core";
import type { GlyphHotspotHandle } from "../api/createGlyphScene";
import type { GlyphSceneElement } from "./GlyphSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseSize(value: string | null): [number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0]!, parts[1]!];
}

function findScene(el: HTMLElement): GlyphSceneElement | null {
  const found = el.closest("glyph-scene") as unknown as (GlyphSceneElement & { getScene?: () => unknown }) | null;
  return found ?? null;
}

export class GlyphHotspotElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["at", "size", "hotspot-id"];
  }

  private _handle: GlyphHotspotHandle | null = null;

  connectedCallback(): void {
    this._register();
  }

  disconnectedCallback(): void {
    if (this._handle) {
      this._handle.remove();
      this._handle = null;
    }
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (this._handle) {
      this._handle.remove();
      this._handle = null;
    }
    this._register();
  }

  private _register(): void {
    const at = parseVec3(this.getAttribute("at"));
    if (!at) return;
    const sceneEl = findScene(this);
    const scene = sceneEl?.getScene();
    if (!scene) return;

    const id = this.getAttribute("hotspot-id") ?? this.getAttribute("id") ?? String(Math.random());
    const size = parseSize(this.getAttribute("size"));

    this._handle = scene.addHotspot(
      { id, at, size },
      () => this.dispatchEvent(new CustomEvent("glyphcss:hotspot-click", { detail: { id }, bubbles: true })),
    );
  }
}
