/**
 * <poly-axes-helper> custom element. Vanilla counterpart to React/Vue's
 * `<PolyAxesHelper>`. Drops three colored cuboids (red=X, green=Y, blue=Z)
 * along the world axes inside the nearest <poly-scene>.
 *
 * Attributes (all optional):
 *   size            — number, length of each bar in world units (default 5)
 *   thickness       — number, bar width as fraction of `size` (default 0.025)
 *   negative        — boolean attr; when present, bars also extend into −X/−Y/−Z
 *   x-color, y-color, z-color — hex string per-axis color overrides
 */
import { axesHelperPolygons } from "@layoutit/polycss-core";
import type { ParseResult } from "@layoutit/polycss-core";
import type { PolyMeshHandle } from "../api/createPolyScene";
import type { PolySceneElement } from "./PolySceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "size",
  "thickness",
  "negative",
  "x-color",
  "y-color",
  "z-color",
] as const;

function findScene(el: HTMLElement): PolySceneElement | null {
  return (el.closest("poly-scene") as unknown as PolySceneElement | null) ?? null;
}

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

export class PolyAxesHelperElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _handle: PolyMeshHandle | null = null;

  connectedCallback(): void {
    this._mount();
  }

  disconnectedCallback(): void {
    this._tearDown();
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (this._handle) this._remount();
  }

  private _polygons(): ReturnType<typeof axesHelperPolygons> {
    return axesHelperPolygons({
      size: parseNumber(this.getAttribute("size")),
      thickness: parseNumber(this.getAttribute("thickness")),
      negative: this.hasAttribute("negative"),
      xColor: this.getAttribute("x-color") ?? undefined,
      yColor: this.getAttribute("y-color") ?? undefined,
      zColor: this.getAttribute("z-color") ?? undefined,
    });
  }

  private _mount(): void {
    const sceneEl = findScene(this);
    if (!sceneEl) return;
    const scene = sceneEl.getScene();
    if (!scene) return;
    const parsed: ParseResult = {
      polygons: this._polygons(),
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    this._handle = scene.add(parsed, { excludeFromAutoCenter: true });
  }

  private _remount(): void {
    this._tearDown();
    this._mount();
  }

  private _tearDown(): void {
    if (this._handle) {
      try { this._handle.dispose(); } catch { /* ignore */ }
      this._handle = null;
    }
  }
}
