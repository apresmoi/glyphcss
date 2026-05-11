/**
 * <poly-mesh src="…"> custom element. Vanilla counterpart to React's <PolyMesh>.
 *
 * On connect: walks up to the nearest <poly-scene>, fetches & parses the
 * `src` URL via `loadMesh`, then registers the result via `scene.add(...)`
 * with the parsed transform attributes.
 *
 * On disconnect: removes + disposes the registered mesh handle.
 *
 * `auto-center` is currently honored by recentering vertices in-place before
 * registering; this matches `<PolyMesh autoCenter>` semantics.
 */
import type { ParseResult, Polygon, Vec3 } from "@layoutit/polycss-core";
import { computeSceneBbox, loadMesh } from "@layoutit/polycss-core";
import type { PolyMeshHandle } from "../api/createPolyScene";
import type { PolySceneElement } from "./PolySceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "src",
  "mtl",
  "position",
  "scale",
  "rotation",
  "auto-center",
] as const;

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
  // closest() doesn't recurse into shadow roots; fine for v1.
  const found = el.closest("poly-scene") as unknown as
    | (PolySceneElement & { getScene?: () => unknown })
    | null;
  return found ?? null;
}

function recenter(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  if (cx === 0 && cy === 0 && cz === 0) return polygons;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(
      (v): Vec3 => [v[0] - cx, v[1] - cy, v[2] - cz],
    ),
  }));
}

export class PolyMeshElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _handle: PolyMeshHandle | null = null;
  private _parseResult: ParseResult | null = null;
  private _loadToken = 0;

  /** Returns the current mesh handle, or null if not yet loaded. */
  getMeshHandle(): PolyMeshHandle | null {
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
    if (name === "src" || name === "mtl") {
      this._tearDown();
      this._maybeLoad();
      return;
    }
    // Transform attributes only — update without re-parsing.
    if (!this._handle) return;
    this._handle.setTransform({
      position: parseVec3(this.getAttribute("position")),
      scale: parseScale(this.getAttribute("scale")),
      rotation: parseVec3(this.getAttribute("rotation")),
    });
  }

  private _tearDown(): void {
    this._loadToken += 1;
    if (this._handle) {
      try { this._handle.dispose(); } catch { /* ignore */ }
      this._handle = null;
    }
    this._parseResult = null;
  }

  private async _maybeLoad(): Promise<void> {
    const src = this.getAttribute("src");
    if (!src) return;
    const sceneEl = findScene(this);
    if (!sceneEl) return;

    const token = ++this._loadToken;

    const mtl = this.getAttribute("mtl") || undefined;
    let parsed: ParseResult;
    try {
      parsed = await loadMesh(src, mtl ? { mtlUrl: mtl } : undefined);
    } catch (err) {
      this.dispatchEvent(
        new CustomEvent("polycss:error", { detail: err, bubbles: true }),
      );
      return;
    }

    // Race: a newer load (or disconnect) superseded us — discard.
    if (token !== this._loadToken) {
      try { parsed.dispose(); } catch { /* ignore */ }
      return;
    }

    const scene = sceneEl.getScene();
    if (!scene) {
      try { parsed.dispose(); } catch { /* ignore */ }
      return;
    }

    const autoCenter = this.hasAttribute("auto-center");
    if (autoCenter) {
      parsed = { ...parsed, polygons: recenter(parsed.polygons) };
    }

    this._parseResult = parsed;
    this._handle = scene.add(parsed, {
      position: parseVec3(this.getAttribute("position")),
      scale: parseScale(this.getAttribute("scale")),
      rotation: parseVec3(this.getAttribute("rotation")),
    });

    this.dispatchEvent(
      new CustomEvent("polycss:loaded", {
        detail: { polygons: this._handle.polygons },
        bubbles: true,
      }),
    );
  }
}
