/**
 * `<glyphcss-mesh src="…">` custom element. Fetches a mesh via the glyphcss-core
 * `loadMesh` parser, converts polygons to triangles, and registers with the
 * parent `<glyphcss-scene>`.
 *
 * On disconnect: disposes the registered mesh handle.
 */
import type { Vec3 } from "@glyphcss/core";
import { loadMesh } from "@glyphcss/core";
import type { GlyphcssMeshHandle, GlyphcssSceneHandle, GlyphcssTriangle } from "../api/createGlyphcssScene";
import type { GlyphcssMeshTransform } from "../api/types";
import type { GlyphcssSceneElement } from "./GlyphcssSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = ["src", "position", "scale", "rotation"] as const;

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseScale(value: string | null): number | Vec3 | undefined {
  if (!value) return undefined;
  if (!value.includes(",")) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return parseVec3(value);
}

function findScene(el: HTMLElement): GlyphcssSceneElement | null {
  const found = el.closest("glyphcss-scene") as unknown as (GlyphcssSceneElement & { getScene?: () => unknown }) | null;
  return found ?? null;
}

/** Convert glyphcss Polygon[] to GlyphcssTriangle[] by fan-triangulating each polygon. */
function polygonsToTriangles(polygons: { vertices: Vec3[]; color?: string }[]): GlyphcssTriangle[] {
  const ZERO_UV: [import("@glyphcss/core").Vec2, import("@glyphcss/core").Vec2, import("@glyphcss/core").Vec2] =
    [[0, 0], [0, 0], [0, 0]];
  const out: GlyphcssTriangle[] = [];
  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    for (let i = 1; i < verts.length - 1; i++) {
      out.push({
        vertices: [verts[0]!, verts[i]!, verts[i + 1]!],
        uvs: ZERO_UV,
        ...(poly.color ? { color: poly.color } : {}),
      });
    }
  }
  return out;
}

export class GlyphcssMeshElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _handle: GlyphcssMeshHandle | null = null;
  private _loadToken = 0;

  getMeshHandle(): GlyphcssMeshHandle | null {
    return this._handle;
  }

  connectedCallback(): void {
    this._maybeLoad();
  }

  disconnectedCallback(): void {
    this._tearDown();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (name === "src") {
      this._tearDown();
      this._maybeLoad();
      return;
    }
    if (!this._handle) return;
    this._handle.setTransform(this._readTransform());
  }

  private _readTransform(): GlyphcssMeshTransform {
    return {
      position: parseVec3(this.getAttribute("position")),
      scale: parseScale(this.getAttribute("scale")),
      rotation: parseVec3(this.getAttribute("rotation")),
    };
  }

  private _tearDown(): void {
    this._loadToken += 1;
    if (this._handle) {
      try { this._handle.dispose(); } catch { /* ignore */ }
      this._handle = null;
    }
  }

  private async _maybeLoad(): Promise<void> {
    const src = this.getAttribute("src");
    if (!src) return;
    const sceneEl = findScene(this);
    if (!sceneEl) return;

    const token = ++this._loadToken;

    let parsed: Awaited<ReturnType<typeof loadMesh>>;
    try {
      parsed = await loadMesh(src);
    } catch (err) {
      this.dispatchEvent(new CustomEvent("glyphcss:error", { detail: err, bubbles: true }));
      return;
    }

    if (token !== this._loadToken) {
      try { parsed.dispose(); } catch { /* ignore */ }
      return;
    }

    const scene: GlyphcssSceneHandle | null = sceneEl.getScene();
    if (!scene) {
      try { parsed.dispose(); } catch { /* ignore */ }
      return;
    }

    const triangles = polygonsToTriangles(parsed.polygons);
    this._handle = scene.add(triangles, this._readTransform());

    this.dispatchEvent(new CustomEvent("glyphcss:loaded", { detail: { triangles }, bubbles: true }));
  }
}
