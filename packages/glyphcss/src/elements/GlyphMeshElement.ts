/**
 * `<glyph-mesh src="…">` / `<glyph-mesh geometry="…">` custom element.
 *
 * When `src` is set, fetches the mesh via `loadMesh`. When `geometry` is set
 * and `src` is NOT set, resolves the named built-in polygon factory via
 * `resolveGeometry`. If both are supplied, `src` wins silently.
 *
 * On disconnect: disposes the registered mesh handle.
 */
import { loadMesh, resolveGeometry, computeSceneBbox } from "@glyphcss/core";
import type { Vec3, GlyphGeometryName, Polygon } from "@glyphcss/core";
import type { GlyphMeshHandle, GlyphSceneHandle } from "../api/createGlyphScene";
import type { GlyphMeshTransform } from "../api/types";
import type { GlyphSceneElement } from "./GlyphSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = ["src", "geometry", "size", "color", "position", "scale", "rotation", "normalize"] as const;

/** Center and scale polygons to fit a 2-unit bounding box at origin. */
function fitToUnitBbox(polygons: Polygon[]): Polygon[] {
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  const size = Math.max(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ) || 1;
  const k = 2 / size;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map((v): Vec3 => [
      (v[0] - cx) * k,
      (v[1] - cy) * k,
      (v[2] - cz) * k,
    ]),
  }));
}

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

function findScene(el: HTMLElement): GlyphSceneElement | null {
  const found = el.closest("glyph-scene") as unknown as (GlyphSceneElement & { getScene?: () => unknown }) | null;
  return found ?? null;
}


export class GlyphMeshElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _handle: GlyphMeshHandle | null = null;
  private _loadToken = 0;

  getMeshHandle(): GlyphMeshHandle | null {
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
    if (name === "src" || name === "geometry" || name === "size" || name === "color") {
      this._tearDown();
      this._maybeLoad();
      return;
    }
    if (!this._handle) return;
    this._handle.setTransform(this._readTransform());
  }

  private _readTransform(): GlyphMeshTransform {
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
    const geometryAttr = this.getAttribute("geometry");
    const sceneEl = findScene(this);
    if (!sceneEl) return;

    // If the scene handle isn't ready yet (e.g. the camera custom element
    // upgrades after this element does), wait for it.
    if (!sceneEl.getScene()) {
      const onReady = (): void => {
        sceneEl.removeEventListener("glyphcss:scene-ready", onReady);
        void this._maybeLoad();
      };
      sceneEl.addEventListener("glyphcss:scene-ready", onReady);
      return;
    }

    if (src) {
      // src wins over geometry
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

      const scene: GlyphSceneHandle | null = sceneEl.getScene();
      if (!scene) {
        try { parsed.dispose(); } catch { /* ignore */ }
        return;
      }

      const shouldNormalize = this.hasAttribute("normalize");
      const polygons = shouldNormalize ? fitToUnitBbox(parsed.polygons) : parsed.polygons;
      this._handle = scene.add(polygons, this._readTransform());
      this.dispatchEvent(new CustomEvent("glyphcss:loaded", { detail: { polygons }, bubbles: true }));
      return;
    }

    if (geometryAttr) {
      const scene: GlyphSceneHandle | null = sceneEl.getScene();
      if (!scene) return;

      const sizeAttr = this.getAttribute("size");
      const size = sizeAttr !== null ? parseFloat(sizeAttr) : 1;
      const colorAttr = this.getAttribute("color") ?? undefined;

      let polygons;
      try {
        polygons = resolveGeometry(geometryAttr as GlyphGeometryName, {
          size: Number.isFinite(size) ? size : 1,
          color: colorAttr,
        });
      } catch (err) {
        this.dispatchEvent(new CustomEvent("glyphcss:error", { detail: err, bubbles: true }));
        return;
      }

      this._handle = scene.add(polygons, this._readTransform());
      this.dispatchEvent(new CustomEvent("glyphcss:loaded", { detail: { polygons }, bubbles: true }));
    }
  }
}
