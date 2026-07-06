import type {
  GlyphAmbientLight,
  GlyphDirectionalLight,
  Polygon,
  Vec3,
} from "../types";

const DEG = Math.PI / 180;
const EPS = 1e-12;

export type Vector3Tuple = [number, number, number];

export interface GlyphProjectionMetrics {
  cellWidth?: number;
  cellHeight?: number;
  centerCol?: number;
  centerRow?: number;
}

export interface ThreeGlyphCamera {
  readonly kind: "perspective" | "orthographic";
  rotX: number;
  rotY: number;
  center: [number, number];
  mat: number[] | null;
  useMat: boolean;
  distance: number;
  perspective: number;
  zoom: number;
  stretch: number;
  fovScale: number;
  target: Vec3;
  eyeMode: boolean;
  project(v: Vec3, cols: number, rows: number, cellAspect: number, metrics?: GlyphProjectionMetrics): [number, number, number, number?];
  eyeDepth(v: Vec3): number;
}

export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vector3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  add(v: Vector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v: Vector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vector3): this {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  normalize(): this {
    const len = this.length();
    if (len > EPS) this.multiplyScalar(1 / len);
    return this;
  }

  toArray(): Vector3Tuple {
    return [this.x, this.y, this.z];
  }
}

export class Euler {
  x: number;
  y: number;
  z: number;
  readonly order = "XYZ";
  #onChange: () => void;

  constructor(x = 0, y = 0, z = 0, onChange: () => void = () => {}) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.#onChange = onChange;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.#onChange();
    return this;
  }
}

export class Object3D {
  readonly position = new Vector3();
  readonly rotation: Euler;
  readonly scale = new Vector3(1, 1, 1);
  up = new Vector3(0, 1, 0);
  #lookAtTarget: Vector3 | null = null;

  constructor() {
    this.rotation = new Euler(0, 0, 0, () => {
      this.#lookAtTarget = null;
    });
  }

  lookAt(x: number | Vector3, y?: number, z?: number): this {
    this.#lookAtTarget = x instanceof Vector3
      ? x.clone()
      : new Vector3(x, y ?? 0, z ?? 0);
    return this;
  }

  localToWorld(v: Vector3): Vector3 {
    const out = rotateByEuler(
      new Vector3(v.x * this.scale.x, v.y * this.scale.y, v.z * this.scale.z),
      this.rotation,
    );
    return out.add(this.position);
  }

  protected cameraBasis(): { right: Vector3; up: Vector3; forward: Vector3 } {
    if (this.#lookAtTarget) {
      const forward = this.#lookAtTarget.clone().sub(this.position).normalize();
      const right = forward.clone().cross(this.up).normalize();
      const up = right.clone().cross(forward).normalize();
      return { right, up, forward };
    }

    const right = rotateByEuler(new Vector3(1, 0, 0), this.rotation).normalize();
    const up = rotateByEuler(new Vector3(0, 1, 0), this.rotation).normalize();
    const backward = rotateByEuler(new Vector3(0, 0, 1), this.rotation).normalize();
    return { right, up, forward: backward.multiplyScalar(-1) };
  }
}

export abstract class Camera extends Object3D implements ThreeGlyphCamera {
  abstract readonly kind: "perspective" | "orthographic";
  near: number;
  far: number;
  center: [number, number] = [0.5, 0.5];
  rotX = 0;
  rotY = 0;
  distance = 0;
  perspective = 0;
  abstract zoom: number;
  stretch = 1;
  fovScale = 1;
  target: Vec3 = [0, 0, 0];
  mat: number[] | null = null;
  useMat = false;
  abstract eyeMode: boolean;

  protected constructor(near = 0.1, far = 2000) {
    super();
    this.near = near;
    this.far = far;
  }

  protected cameraSpaceFromGlyph(v: Vec3): Vector3 {
    const p = glyphToThreePoint(v);
    const rel = p.sub(this.position);
    const { right, up, forward } = this.cameraBasis();
    return new Vector3(
      rel.dot(right),
      rel.dot(up),
      -rel.dot(forward),
    );
  }

  abstract project(v: Vec3, cols: number, rows: number, cellAspect: number, metrics?: GlyphProjectionMetrics): [number, number, number, number?];

  abstract eyeDepth(v: Vec3): number;
}

export class PerspectiveCamera extends Camera {
  readonly kind = "perspective" as const;
  fov: number;
  aspect: number;
  zoom = 1;
  eyeMode = true;

  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super(near, far);
    this.fov = fov;
    this.aspect = aspect;
  }

  project(v: Vec3, cols: number, rows: number, _cellAspect: number, _metrics?: GlyphProjectionMetrics): [number, number, number, number?] {
    const p = this.cameraSpaceFromGlyph(v);
    if (-p.z <= this.near) return [NaN, NaN, p.z, NaN];

    const halfFov = Math.tan((this.fov * DEG) / 2);
    const xNdc = p.x / (-p.z * halfFov * this.aspect) * this.zoom;
    const yNdc = p.y / (-p.z * halfFov) * this.zoom;
    return ndcToCells(xNdc, yNdc, p.z, cols, rows, this.center, -1 / p.z);
  }

  eyeDepth(v: Vec3): number {
    return -this.cameraSpaceFromGlyph(v).z - this.near;
  }
}

export class OrthographicCamera extends Camera {
  readonly kind = "orthographic" as const;
  left: number;
  right: number;
  top: number;
  bottom: number;
  zoom = 1;
  eyeMode = false;

  constructor(left = -1, right = 1, top = 1, bottom = -1, near = 0.1, far = 2000) {
    super(near, far);
    this.left = left;
    this.right = right;
    this.top = top;
    this.bottom = bottom;
  }

  project(v: Vec3, cols: number, rows: number, _cellAspect: number, _metrics?: GlyphProjectionMetrics): [number, number, number] {
    const p = this.cameraSpaceFromGlyph(v);
    const halfWidth = (this.right - this.left) / (2 * this.zoom);
    const halfHeight = (this.top - this.bottom) / (2 * this.zoom);
    const centerX = (this.left + this.right) / 2;
    const centerY = (this.top + this.bottom) / 2;
    const xNdc = (p.x - centerX) / halfWidth;
    const yNdc = (p.y - centerY) / halfHeight;
    const [col, row, depth] = ndcToCells(xNdc, yNdc, p.z, cols, rows, this.center);
    return [col, row, depth];
  }

  eyeDepth(_v: Vec3): number {
    return Number.POSITIVE_INFINITY;
  }
}

export class DirectionalLight extends Object3D {
  readonly target = new Object3D();
  color: string;
  intensity: number;

  constructor(color = "#ffffff", intensity = 1) {
    super();
    this.color = color;
    this.intensity = intensity;
    this.position.set(0, 1, 0);
  }

  toGlyphDirectionalLight(): GlyphDirectionalLight {
    const direction = this.position.clone().sub(this.target.position).normalize();
    return {
      direction: threeToGlyphDirection(direction),
      color: this.color,
      intensity: this.intensity,
    };
  }
}

export class AmbientLight {
  color: string;
  intensity: number;

  constructor(color = "#ffffff", intensity = 1) {
    this.color = color;
    this.intensity = intensity;
  }

  toGlyphAmbientLight(): GlyphAmbientLight {
    return {
      color: this.color,
      intensity: this.intensity,
    };
  }
}

// Y-up (three) -> Z-up (glyph) must be a ROTATION (det +1), not an axis swap:
// [x, z, y] is a reflection, which reverses polygon orientation. The rendered
// silhouette survives that (projection round-trips through the inverse map,
// so the two reflections cancel in screen space) but winding-derived world
// normals pick up the det = -1 once, inverting Lambert shading. The +90 degree
// rotation about X keeps orientation: three (x, y, z) -> glyph (x, -z, y).
export function threeToGlyphPoint(v: Vector3): Vec3 {
  return [v.x, -v.z, v.y];
}

export function glyphToThreePoint(v: Vec3): Vector3 {
  return new Vector3(v[0], v[2], -v[1]);
}

export function threeToGlyphDirection(v: Vector3): Vec3 {
  return [v.x, -v.z, v.y];
}

export function glyphToThreeDirection(v: Vec3): Vector3 {
  return new Vector3(v[0], v[2], -v[1]);
}

export function transformPointToGlyph(point: Vector3, object: Object3D): Vec3 {
  return threeToGlyphPoint(object.localToWorld(point.clone()));
}

export function transformPolygonsToGlyph(polygons: Polygon[], object: Object3D): Polygon[] {
  return polygons.map((polygon) => ({
    ...polygon,
    vertices: polygon.vertices.map((v) => {
      const point = new Vector3(v[0], v[1], v[2]);
      return transformPointToGlyph(point, object);
    }),
  }));
}

function rotateByEuler(v: Vector3, euler: Euler): Vector3 {
  const a = Math.cos(euler.x);
  const b = Math.sin(euler.x);
  const c = Math.cos(euler.y);
  const d = Math.sin(euler.y);
  const e = Math.cos(euler.z);
  const f = Math.sin(euler.z);

  const x = v.x;
  const y = v.y;
  const z = v.z;

  return new Vector3(
    c * e * x - c * f * y + d * z,
    (a * f + b * e * d) * x + (a * e - b * f * d) * y - b * c * z,
    (b * f - a * e * d) * x + (b * e + a * f * d) * y + a * c * z,
  );
}

function ndcToCells(
  xNdc: number,
  yNdc: number,
  depth: number,
  cols: number,
  rows: number,
  center: [number, number],
  zbuf?: number,
): [number, number, number, number?] {
  const col = cols * center[0] + xNdc * cols * 0.5;
  const row = rows * center[1] - yNdc * rows * 0.5;
  return zbuf === undefined ? [col, row, depth] : [col, row, depth, zbuf];
}
