/**
 * <poly-polygon> custom element. Vanilla counterpart to React's <Poly>.
 *
 * On connect: walks up to the nearest <poly-scene>, parses its own
 * vertices/color/texture/uvs/data attributes into a Polygon, and registers
 * it via `scene.add({ polygons: [poly], dispose, objectUrls, warnings })`.
 *
 * Unlike <poly-mesh>, this element creates a one-polygon ParseResult inline
 * — there's no URL fetch.
 */
import type { ParseResult, Polygon, Vec2, Vec3 } from "@polycss/core";
import type { MeshHandle } from "../api/createPolyScene";
import type { PolySceneElement } from "./PolySceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "vertices",
  "color",
  "texture",
  "uvs",
  "position",
  "scale",
  "rotation",
] as const;

function parseJsonOrNull<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return undefined;
  }
  return [parts[0], parts[1], parts[2]];
}

function parseScale(value: string | null): number | Vec3 | undefined {
  if (!value) return undefined;
  if (!value.includes(",")) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return parseVec3(value);
}

function findScene(el: HTMLElement): PolySceneElement | null {
  const found = el.closest("poly-scene") as unknown as
    | (PolySceneElement & { getScene?: () => unknown })
    | null;
  return found ?? null;
}

export class PolyPolygonElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _handle: MeshHandle | null = null;

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
    // Geometry / appearance changes require re-mount; transform changes can
    // ride on setTransform if the only thing that changed was a transform
    // attribute. Cheapest correct path: tear down + remount on any change.
    this._tearDown();
    if (this.isConnected) this._mount();
  }

  private _tearDown(): void {
    if (this._handle) {
      try { this._handle.dispose(); } catch { /* ignore */ }
      this._handle = null;
    }
  }

  private _mount(): void {
    const sceneEl = findScene(this);
    if (!sceneEl) return;
    const scene = sceneEl.getScene();
    if (!scene) return;

    const vertices = parseJsonOrNull<Vec3[]>(this.getAttribute("vertices"));
    if (!vertices || !Array.isArray(vertices) || vertices.length < 3) return;

    const color = this.getAttribute("color") || undefined;
    const texture = this.getAttribute("texture") || undefined;
    const uvs = parseJsonOrNull<Vec2[]>(this.getAttribute("uvs")) ?? undefined;

    // data-* attributes flow through to polygon.data → reflected as data-*
    // on the rendered polygon div.
    const data: Record<string, string | number | boolean> = {};
    for (const attr of Array.from(this.attributes)) {
      if (attr.name.startsWith("data-")) {
        data[attr.name.slice(5)] = attr.value;
      }
    }

    const polygon: Polygon = {
      vertices,
      ...(color !== undefined ? { color } : {}),
      ...(texture !== undefined ? { texture } : {}),
      ...(uvs !== undefined ? { uvs } : {}),
      ...(Object.keys(data).length > 0 ? { data } : {}),
    };

    const inlineResult: ParseResult = {
      polygons: [polygon],
      objectUrls: [],
      warnings: [],
      dispose: () => { /* nothing minted */ },
    };

    this._handle = scene.add(inlineResult, {
      position: parseVec3(this.getAttribute("position")),
      scale: parseScale(this.getAttribute("scale")),
      rotation: parseVec3(this.getAttribute("rotation")),
    });
  }
}
