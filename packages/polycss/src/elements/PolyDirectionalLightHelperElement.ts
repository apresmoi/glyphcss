/**
 * <poly-directional-light-helper> custom element. Vanilla counterpart to the
 * React/Vue helper components. Drops a small octahedron at the directional
 * light's source position inside the nearest <poly-scene>.
 *
 * Attributes (all optional except `direction`):
 *   direction    — "x,y,z" CSS-pixel-space light direction (required)
 *   target       — "x,y,z" world coords; usually the mesh bbox center (default 0,0,0)
 *   distance     — number, world units from target along the light direction (default 5)
 *   size         — number, marker half-extent in world units (default 0.35)
 *   color        — hex string; defaults to a warm yellow
 */
import { octahedronPolygons } from "@polycss/core";
import type { ParseResult, Vec3 } from "@polycss/core";
import type { MeshHandle } from "../api/createPolyScene";
import type { PolySceneElement } from "./PolySceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "direction",
  "target",
  "distance",
  "size",
  "color",
] as const;

const TILE = 50;
const DEFAULT_DISTANCE = 5;
const DEFAULT_SIZE = 0.35;
const DEFAULT_COLOR = "#ffd54a";

function findScene(el: HTMLElement): PolySceneElement | null {
  return (el.closest("poly-scene") as unknown as PolySceneElement | null) ?? null;
}

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return undefined;
  }
  return [parts[0], parts[1], parts[2]];
}

function parseNumber(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export class PolyDirectionalLightHelperElement extends ELEMENT_BASE {
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
    if (!this._handle) return;
    // direction / target / distance only affect placement — update the
    // wrapper transform without rebuilding polygons. size/color require
    // rebuilding the octahedron.
    if (_name === "size" || _name === "color") {
      this._remount();
      return;
    }
    this._handle.setTransform({ position: this._meshPosition() });
  }

  private _meshPosition(): Vec3 | undefined {
    const direction = parseVec3(this.getAttribute("direction"));
    if (!direction) return undefined;
    const target = parseVec3(this.getAttribute("target")) ?? [0, 0, 0];
    const distance = parseNumber(this.getAttribute("distance"), DEFAULT_DISTANCE);
    const dx = direction[0], dy = direction[1], dz = direction[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const worldX = target[0] + (dy / len) * distance;
    const worldY = target[1] + (dx / len) * distance;
    const worldZ = target[2] + (dz / len) * distance;
    return [worldY * TILE, worldX * TILE, worldZ * TILE];
  }

  private _mount(): void {
    const sceneEl = findScene(this);
    if (!sceneEl) return;
    const scene = sceneEl.getScene();
    if (!scene) return;
    const size = parseNumber(this.getAttribute("size"), DEFAULT_SIZE);
    const color = this.getAttribute("color") ?? DEFAULT_COLOR;
    const parsed: ParseResult = {
      polygons: octahedronPolygons([0, 0, 0], size, color),
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    this._handle = scene.add(parsed, {
      position: this._meshPosition(),
      excludeFromAutoCenter: true,
    });
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
