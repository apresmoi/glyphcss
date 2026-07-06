import * as THREE from "three";
import {
  AmbientLight as GlyphAmbientLight,
  DirectionalLight as GlyphDirectionalLight,
  OrthographicCamera as GlyphOrthographicCamera,
  PerspectiveCamera as GlyphPerspectiveCamera,
  Vector3 as GlyphVector3,
  compileScene,
  glyphToThreePoint,
  loadMesh,
  resolveGeometry,
  threeToGlyphPoint,
} from "glyphcss/three";
import type {
  GlyphCamera,
  GlyphGeometryName,
  LoadMeshOptions,
  Polygon as GlyphPolygon,
  Vec3 as GlyphVec3,
} from "../packages/glyphcss/src/index";
import {
  AmbientLight as PolyAmbientLight,
  DirectionalLight as PolyDirectionalLight,
  OrthographicCamera as PolyOrthographicCamera,
  PerspectiveCamera as PolyPerspectiveCamera,
  Vector3 as PolyVector3,
  mountPolyThreeScene,
  threeToPolyPoint,
} from "@layoutit/polycss/three";
import type {
  Polygon as PolyPolygon,
  Vec3 as PolyVec3,
} from "@layoutit/polycss-core";

declare global {
  interface Window {
    __threePolyGlyphParityBench: unknown;
    __benchReady: boolean;
  }
}

type CameraMode = "perspective" | "orthographic" | "fpv";
type LayoutMode = "single" | "lineup" | "occlusion" | "ground";
type ViewPreset = "iso" | "front" | "top" | "low" | "fpv";
type ThreePolygon = { vertices: THREE.Vector3[]; color?: string };
type PolyScene = ReturnType<typeof mountPolyThreeScene>;

interface ObjectCase {
  id: string;
  label: string;
  load: () => Promise<GlyphPolygon[]> | GlyphPolygon[];
}

interface GridMetrics {
  cols: number;
  rows: number;
  cellAspect: number;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const DEG = Math.PI / 180;
const q = new URLSearchParams(location.search);
const qs = (key: string, fallback: string) => q.get(key) ?? fallback;
const qn = (key: string, fallback: number) => {
  const value = Number.parseFloat(q.get(key) ?? "");
  return Number.isFinite(value) ? value : fallback;
};

const objectSelect = document.getElementById("object") as HTMLSelectElement;
const layoutSelect = document.getElementById("layout") as HTMLSelectElement;
const cameraSelect = document.getElementById("camera") as HTMLSelectElement;
const viewSelect = document.getElementById("view") as HTMLSelectElement;
const fovInput = document.getElementById("fov") as HTMLInputElement;
const sizeInput = document.getElementById("size") as HTMLInputElement;
const densityInput = document.getElementById("density") as HTMLInputElement;
const spinInput = document.getElementById("spin") as HTMLInputElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const readout = document.getElementById("readout") as HTMLElement;
const metricsEl = document.getElementById("metrics") as HTMLElement;
const codeOutput = document.getElementById("codeOutput") as HTMLElement;
const stage = document.getElementById("stage") as HTMLElement;
const dragCatcher = document.getElementById("dragCatcher") as HTMLElement;
const threeSurface = document.getElementById("threeSurface") as HTMLElement;
const glyphSurface = document.getElementById("glyphSurface") as HTMLElement;
const polySurface = document.getElementById("polySurface") as HTMLElement;
const glyphPre = document.getElementById("glyphPre") as HTMLPreElement;
const polyFrame = document.getElementById("polyFrame") as HTMLElement;
const threePill = document.getElementById("threePill") as HTMLElement;
const codeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".code-tabs button"));

let renderer: THREE.WebGLRenderer | null = null;
let fallbackCanvas: HTMLCanvasElement | null = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x0b1018, 1);
  threeSurface.appendChild(renderer.domElement);
} catch (error) {
  console.warn("three-poly-glyph-parity: WebGL unavailable, using canvas fallback", error);
  fallbackCanvas = document.createElement("canvas");
  threeSurface.appendChild(fallbackCanvas);
  threePill.textContent = "Canvas fallback / Three projection";
}

const state = {
  object: qs("object", "cactus-glb"),
  layout: (["single", "lineup", "occlusion", "ground"].includes(qs("layout", "single"))
    ? qs("layout", "single")
    : "single") as LayoutMode,
  camera: (["perspective", "orthographic", "fpv"].includes(qs("camera", "perspective"))
    ? qs("camera", "perspective")
    : "perspective") as CameraMode,
  view: (["iso", "front", "top", "low", "fpv"].includes(qs("view", "iso"))
    ? qs("view", "iso")
    : "iso") as ViewPreset,
  yaw: qn("yaw", 42),
  pitch: qn("pitch", 26),
  distance: qn("distance", 6),
  orthoSize: qn("orthoSize", 4),
  fov: qn("fov", 45),
  density: qn("density", 1),
  objectSpin: 0,
  fpvEye: new THREE.Vector3(0, 1.4, 6),
};

const keys = new Set<string>();
let baseThreePolygons: ThreePolygon[] = [];
let sourceLabel = "";
let animationFrame = 0;
let lastTime = 0;
let currentThreeMesh: THREE.Mesh | null = null;
let polyScene: PolyScene | null = null;
let activeCode: "three" | "glyph" | "poly" = "three";

const OBJECTS: ObjectCase[] = [
  { id: "cube", label: "primitive / cube", load: primitive("cube") },
  { id: "icosahedron", label: "primitive / icosahedron", load: primitive("icosahedron") },
  { id: "dodecahedron", label: "primitive / dodecahedron", load: primitive("dodecahedron") },
  { id: "cactus-glb", label: "gallery GLB / cactus", load: gallery("/website/public/gallery/glb/Cactus.glb") },
  { id: "pizza-cactus", label: "gallery GLB / cactus-a", load: gallery("/website/public/gallery/glb/poly-pizza/cactus-a.glb") },
  { id: "box-glb", label: "gallery GLB / box", load: gallery("/website/public/gallery/glb/urban/Box.glb") },
  { id: "pizza-box", label: "gallery GLB / cardboard box", load: gallery("/website/public/gallery/glb/poly-pizza/cardboard-box-closed.glb") },
  { id: "car-glb", label: "gallery GLB / car", load: gallery("/website/public/gallery/glb/urban/Car.glb") },
  { id: "sports-car", label: "gallery GLB / sports car", load: gallery("/website/public/gallery/glb/urban/Sports Car.glb") },
  {
    id: "car-obj",
    label: "gallery OBJ / low-poly car",
    load: gallery("/website/public/gallery/obj/opengameart/low-poly-car/car.obj", {
      mtlUrl: "/website/public/gallery/obj/opengameart/low-poly-car/car.mtl",
    }),
  },
  {
    id: "crate-obj",
    label: "gallery OBJ / crate",
    load: gallery("/website/public/gallery/obj/opengameart/crate/Box.obj", {
      mtlUrl: "/website/public/gallery/obj/opengameart/crate/Box.mtl",
    }),
  },
  {
    id: "cactus-obj",
    label: "gallery OBJ / cactus",
    load: gallery("/website/public/gallery/obj/quaternius/nature/Cactus_3.obj", {
      mtlUrl: "/website/public/gallery/obj/quaternius/nature/Cactus_3.mtl",
    }),
  },
];

function primitive(name: GlyphGeometryName): () => GlyphPolygon[] {
  return () => resolveGeometry(name, { center: [0, 0, 0], size: 1, color: "#d9e4f2" });
}

function gallery(path: string, options: LoadMeshOptions = {}): () => Promise<GlyphPolygon[]> {
  return async () => {
    const result = await loadMesh(path, { baseUrl: path, ...options });
    return result.polygons;
  };
}

function hexToRgb(hex: string | undefined): [number, number, number] {
  const clean = (hex ?? "#d9e4f2").replace("#", "");
  const n = Number.parseInt(clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.85, 0.89, 0.95];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function glyphPolygonsToThree(polygons: GlyphPolygon[]): ThreePolygon[] {
  return polygons.map((polygon) => ({
    color: polygon.color,
    vertices: polygon.vertices.map((vertex) => {
      const p = glyphToThreePoint(vertex);
      return new THREE.Vector3(p.x, p.y, p.z);
    }),
  }));
}

function threePolygonsToGlyph(polygons: ThreePolygon[]): GlyphPolygon[] {
  return polygons.map((polygon) => ({
    color: polygon.color,
    vertices: polygon.vertices.map((vertex) => (
      threeToGlyphPoint(new GlyphVector3(vertex.x, vertex.y, vertex.z)) as GlyphVec3
    )),
  }));
}

function threePolygonsToPoly(polygons: ThreePolygon[]): PolyPolygon[] {
  return polygons.map((polygon) => ({
    color: polygon.color,
    vertices: polygon.vertices.map((vertex) => (
      threeToPolyPoint(new PolyVector3(vertex.x, vertex.y, vertex.z)) as PolyVec3
    )),
  }));
}

function normalizeThreePolygons(polygons: ThreePolygon[], target = 2.2): ThreePolygon[] {
  const box = new THREE.Box3();
  for (const polygon of polygons) for (const vertex of polygon.vertices) box.expandByPoint(vertex);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const scale = target / (Math.max(size.x, size.y, size.z) || 1);
  return polygons.map((polygon) => ({
    color: polygon.color,
    vertices: polygon.vertices.map((vertex) => vertex.clone().sub(center).multiplyScalar(scale)),
  }));
}

function polygonBbox(polygons: ThreePolygon[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const polygon of polygons) for (const vertex of polygon.vertices) box.expandByPoint(vertex);
  return box;
}

function transformThreePolygons(polygons: ThreePolygon[], matrix: THREE.Matrix4, color?: string): ThreePolygon[] {
  return polygons.map((polygon) => ({
    color: color ?? polygon.color,
    vertices: polygon.vertices.map((vertex) => vertex.clone().applyMatrix4(matrix)),
  }));
}

function groundPlane(size = 7): ThreePolygon[] {
  return [{
    color: "#233044",
    vertices: [
      new THREE.Vector3(-size, 0, -size),
      new THREE.Vector3(-size, 0, size),
      new THREE.Vector3(size, 0, size),
      new THREE.Vector3(size, 0, -size),
    ],
  }];
}

function scenePolygons(): ThreePolygon[] {
  const spin = spinInput.checked ? state.objectSpin : 0;
  const bbox = polygonBbox(baseThreePolygons);
  const minY = Number.isFinite(bbox.min.y) ? bbox.min.y : 0;
  const sitOnGround = new THREE.Matrix4().makeTranslation(0, -minY, 0);
  const baseRot = new THREE.Matrix4().makeRotationY(spin);
  const base = new THREE.Matrix4().multiplyMatrices(sitOnGround, baseRot);
  const out: ThreePolygon[] = [];

  const addInstance = (x: number, y: number, z: number, scale: number, rotY: number, color?: string) => {
    const m = new THREE.Matrix4()
      .makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeRotationY(rotY))
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
      .multiply(base);
    out.push(...transformThreePolygons(baseThreePolygons, m, color));
  };

  if (state.layout === "lineup") {
    addInstance(-2.0, 0, 0, 0.72, -0.35, "#68d391");
    addInstance(0, 0, 0, 0.82, 0.25, undefined);
    addInstance(2.0, 0, 0, 0.62, 0.85, "#f6bd60");
    return out;
  }

  if (state.layout === "occlusion") {
    addInstance(0, 0, -1.05, 1.05, 0.2, "#60a5fa");
    addInstance(-0.25, 0, 0.65, 0.72, -0.45, "#fb7185");
    addInstance(0.9, 0, 1.2, 0.45, 0.8, "#facc15");
    return out;
  }

  if (state.layout === "ground") {
    out.push(...groundPlane());
    addInstance(0, 0, 0, 1, 0.2, undefined);
    addInstance(2.3, 0, -0.8, 0.45, -0.55, "#f6bd60");
    return out;
  }

  addInstance(0, 0, 0, 1, 0, undefined);
  return out;
}

function makeThreeGeometry(polygons: ThreePolygon[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const polygon of polygons) {
    if (polygon.vertices.length < 3) continue;
    const rgb = hexToRgb(polygon.color);
    for (let i = 1; i < polygon.vertices.length - 1; i++) {
      for (const vertex of [polygon.vertices[0]!, polygon.vertices[i]!, polygon.vertices[i + 1]!]) {
        positions.push(vertex.x, vertex.y, vertex.z);
        colors.push(...rgb);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function makeThreeCamera(grid: GridMetrics): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const aspect = grid.width / grid.height;
  const camera = state.camera === "orthographic"
    ? new THREE.OrthographicCamera(
      -state.orthoSize * aspect / 2,
      state.orthoSize * aspect / 2,
      state.orthoSize / 2,
      -state.orthoSize / 2,
      0.01,
      100,
    )
    : new THREE.PerspectiveCamera(state.fov, aspect, 0.01, 100);

  if (state.camera === "fpv") {
    camera.position.copy(state.fpvEye);
    camera.lookAt(state.fpvEye.clone().add(fpvForward()));
  } else {
    camera.position.copy(orbitPosition(state.distance));
    camera.lookAt(0, 0.8, 0);
  }
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function orbitPosition(distance: number): THREE.Vector3 {
  const yaw = state.yaw * DEG;
  const pitch = state.pitch * DEG;
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch) * distance,
    Math.sin(pitch) * distance + 0.8,
    Math.cos(yaw) * Math.cos(pitch) * distance,
  );
}

function fpvForward(): THREE.Vector3 {
  const yaw = state.yaw * DEG;
  const pitch = state.pitch * DEG;
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ).normalize();
}

function makeGlyphCamera(threeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera): GlyphCamera {
  if (threeCamera instanceof THREE.OrthographicCamera) {
    const camera = new GlyphOrthographicCamera(
      threeCamera.left,
      threeCamera.right,
      threeCamera.top,
      threeCamera.bottom,
      threeCamera.near,
      threeCamera.far,
    );
    camera.zoom = threeCamera.zoom;
    copyGlyphCameraPose(camera, threeCamera);
    return camera;
  }

  const camera = new GlyphPerspectiveCamera(threeCamera.fov, threeCamera.aspect, threeCamera.near, threeCamera.far);
  camera.zoom = threeCamera.zoom;
  copyGlyphCameraPose(camera, threeCamera);
  return camera;
}

function makePolyCamera(threeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera): PolyPerspectiveCamera | PolyOrthographicCamera {
  if (threeCamera instanceof THREE.OrthographicCamera) {
    const camera = new PolyOrthographicCamera(
      threeCamera.left,
      threeCamera.right,
      threeCamera.top,
      threeCamera.bottom,
      threeCamera.near,
      threeCamera.far,
    );
    camera.zoom = threeCamera.zoom;
    copyPolyCameraPose(camera, threeCamera);
    return camera;
  }

  const camera = new PolyPerspectiveCamera(threeCamera.fov, threeCamera.aspect, threeCamera.near, threeCamera.far);
  camera.zoom = threeCamera.zoom;
  copyPolyCameraPose(camera, threeCamera);
  return camera;
}

function copyGlyphCameraPose(
  target: GlyphPerspectiveCamera | GlyphOrthographicCamera,
  source: THREE.PerspectiveCamera | THREE.OrthographicCamera,
): void {
  target.position.set(source.position.x, source.position.y, source.position.z);
  const forward = new THREE.Vector3();
  source.getWorldDirection(forward);
  const look = source.position.clone().add(forward);
  target.lookAt(look.x, look.y, look.z);
}

function copyPolyCameraPose(
  target: PolyPerspectiveCamera | PolyOrthographicCamera,
  source: THREE.PerspectiveCamera | THREE.OrthographicCamera,
): void {
  target.position.set(source.position.x, source.position.y, source.position.z);
  const forward = new THREE.Vector3();
  source.getWorldDirection(forward);
  const look = source.position.clone().add(forward);
  target.lookAt(look.x, look.y, look.z);
}

function makeGlyphLight() {
  const light = new GlyphDirectionalLight("#ffffff", 1.05);
  light.position.set(3, 5, 4);
  light.target.position.set(0, 0, 0);
  return light.toGlyphDirectionalLight();
}

function makePolyLight() {
  const light = new PolyDirectionalLight("#ffffff", 1.05);
  light.position.set(3, 5, 4);
  light.target.position.set(0, 0, 0);
  return light.toPolyDirectionalLight();
}

function renderThree(polygons: ThreePolygon[], camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, grid: GridMetrics): void {
  if (!renderer) {
    renderThreeCanvasFallback(polygons, camera, grid);
    return;
  }

  renderer.setSize(grid.width, grid.height, false);
  renderer.domElement.style.width = `${grid.width}px`;
  renderer.domElement.style.height = `${grid.height}px`;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1018);
  scene.add(new THREE.AmbientLight(0xffffff, 0.42));
  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
  sun.position.set(3, 5, 4);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const geometry = makeThreeGeometry(polygons);
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.FrontSide,
  });
  currentThreeMesh?.geometry.dispose();
  if (Array.isArray(currentThreeMesh?.material)) {
    for (const m of currentThreeMesh.material) m.dispose();
  } else {
    currentThreeMesh?.material.dispose();
  }
  currentThreeMesh = new THREE.Mesh(geometry, material);
  scene.add(currentThreeMesh);
  renderer.render(scene, camera);
}

function renderThreeCanvasFallback(polygons: ThreePolygon[], camera: THREE.Camera, grid: GridMetrics): void {
  if (!fallbackCanvas) return;
  fallbackCanvas.width = grid.width;
  fallbackCanvas.height = grid.height;
  fallbackCanvas.style.width = `${grid.width}px`;
  fallbackCanvas.style.height = `${grid.height}px`;
  const ctx = fallbackCanvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0b1018";
  ctx.fillRect(0, 0, grid.width, grid.height);

  const lightTravel = new THREE.Vector3(0, 0, 0).sub(new THREE.Vector3(3, 5, 4)).normalize();
  const triangles: { pts: [number, number][]; depth: number; color: string }[] = [];
  for (const polygon of polygons) {
    if (polygon.vertices.length < 3) continue;
    for (let i = 1; i < polygon.vertices.length - 1; i++) {
      const tri = [polygon.vertices[0]!, polygon.vertices[i]!, polygon.vertices[i + 1]!];
      const projected = tri.map((vertex) => vertex.clone().project(camera));
      if (projected.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.z < -1 || p.z > 1)) continue;
      const a = tri[1]!.clone().sub(tri[0]!);
      const b = tri[2]!.clone().sub(tri[0]!);
      const normal = a.cross(b).normalize();
      const brightness = 0.42 + Math.max(0, normal.dot(lightTravel.clone().multiplyScalar(-1))) * 0.58;
      const [r, g, bl] = hexToRgb(polygon.color);
      triangles.push({
        pts: projected.map((p) => [
          grid.width * 0.5 + p.x * grid.width * 0.5,
          grid.height * 0.5 - p.y * grid.height * 0.5,
        ]),
        depth: projected.reduce((sum, p) => sum + p.z, 0) / projected.length,
        color: `rgb(${Math.round(r * brightness * 255)},${Math.round(g * brightness * 255)},${Math.round(bl * brightness * 255)})`,
      });
    }
  }
  triangles.sort((a, b) => b.depth - a.depth);
  for (const triangle of triangles) {
    ctx.beginPath();
    ctx.moveTo(triangle.pts[0]![0], triangle.pts[0]![1]);
    ctx.lineTo(triangle.pts[1]![0], triangle.pts[1]![1]);
    ctx.lineTo(triangle.pts[2]![0], triangle.pts[2]![1]);
    ctx.closePath();
    ctx.fillStyle = triangle.color;
    ctx.fill();
  }
}

function renderGlyph(polygons: GlyphPolygon[], camera: GlyphCamera, grid: GridMetrics): void {
  const result = compileScene({
    polygons,
    camera,
    cols: grid.cols,
    rows: grid.rows,
    cellAspect: grid.cellAspect,
    mode: "solid",
    useColors: true,
    glyphPalette: "default",
    directionalLight: makeGlyphLight(),
    ambientLight: new GlyphAmbientLight("#ffffff", 0.42).toGlyphAmbientLight(),
    doubleSided: false,
  });
  glyphPre.style.width = `${grid.width}px`;
  glyphPre.style.height = `${grid.height}px`;
  glyphPre.innerHTML = result.inner;
}

function renderPoly(polygons: PolyPolygon[], camera: PolyPerspectiveCamera | PolyOrthographicCamera, grid: GridMetrics): void {
  polyScene?.destroy();
  polyFrame.innerHTML = "";
  polyFrame.style.width = `${grid.width}px`;
  polyFrame.style.height = `${grid.height}px`;

  polyScene = mountPolyThreeScene(polyFrame, {
    camera,
    cameraOptions: { viewportHeight: grid.height },
    polygons,
    autoCenter: false,
    directionalLight: makePolyLight(),
    ambientLight: new PolyAmbientLight("#ffffff", 0.42).toPolyAmbientLight(),
    textureLighting: "dynamic",
  });
}

function measureGrid(): GridMetrics {
  const density = Math.max(0.5, state.density);
  const fontPx = 8 / density;
  glyphPre.style.fontSize = `${fontPx}px`;
  glyphPre.style.lineHeight = "1";

  const probe = document.createElement("span");
  probe.textContent = "MMMMMMMMMM\nMMMMMMMMMM";
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:${fontPx}px;line-height:1;padding:0;margin:0`;
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const cellW = (rect.width / 10) || fontPx * 0.6;
  const cellH = (rect.height / 2) || fontPx;
  const panel = glyphSurface.getBoundingClientRect();
  const maxW = Math.max(220, Math.floor(panel.width - 8));
  const maxH = Math.max(160, Math.floor(panel.height - 8));
  const cols = Math.max(32, Math.min(180, Math.floor(maxW / cellW)));
  const rows = Math.max(18, Math.min(96, Math.floor(maxH / cellH)));
  return {
    cols,
    rows,
    cellAspect: cellH / cellW,
    cellW,
    cellH,
    width: Math.round(cols * cellW),
    height: Math.round(rows * cellH),
  };
}

function projectedBBoxThree(polygons: ThreePolygon[], camera: THREE.Camera, grid: GridMetrics): BBox | null {
  let bbox: BBox | null = null;
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      const ndc = vertex.clone().project(camera);
      if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || ndc.z < -1 || ndc.z > 1) continue;
      const x = grid.width * 0.5 + ndc.x * grid.width * 0.5;
      const y = grid.height * 0.5 - ndc.y * grid.height * 0.5;
      bbox = addBBoxPoint(bbox, x, y);
    }
  }
  return bbox;
}

function glyphTextBBox(pre: HTMLPreElement, grid: GridMetrics): BBox | null {
  const text = pre.textContent ?? "";
  const lines = text.split("\n");
  let bbox: BBox | null = null;
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row] ?? "";
    for (let col = 0; col < line.length; col++) {
      if (line[col] === " ") continue;
      bbox = addBBoxPoint(bbox, col * grid.cellW, row * grid.cellH);
      bbox = addBBoxPoint(bbox, (col + 1) * grid.cellW, (row + 1) * grid.cellH);
    }
  }
  return bbox;
}

function polyDomBBox(surface: HTMLElement): BBox | null {
  const root = surface.getBoundingClientRect();
  const leaves = Array.from(surface.querySelectorAll<HTMLElement>(
    ".polycss-mesh b,.polycss-mesh i,.polycss-mesh u,.polycss-mesh s,.polycss-voxel-face",
  ));
  let bbox: BBox | null = null;
  for (const leaf of leaves) {
    const rect = leaf.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) continue;
    bbox = addBBoxPoint(bbox, rect.left - root.left, rect.top - root.top);
    bbox = addBBoxPoint(bbox, rect.right - root.left, rect.bottom - root.top);
  }
  return bbox;
}

function addBBoxPoint(bbox: BBox | null, x: number, y: number): BBox {
  if (!bbox) return { minX: x, minY: y, maxX: x, maxY: y };
  bbox.minX = Math.min(bbox.minX, x);
  bbox.minY = Math.min(bbox.minY, y);
  bbox.maxX = Math.max(bbox.maxX, x);
  bbox.maxY = Math.max(bbox.maxY, y);
  return bbox;
}

function bboxLine(label: string, bbox: BBox | null): string {
  if (!bbox) return `${label.padEnd(14)} none`;
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  const cx = bbox.minX + w / 2;
  const cy = bbox.minY + h / 2;
  return `${label.padEnd(14)} size=${w.toFixed(1)}x${h.toFixed(1)} center=${cx.toFixed(1)},${cy.toFixed(1)}`;
}

function bboxDelta(a: BBox | null, b: BBox | null): string {
  if (!a || !b) return "n/a";
  const aw = a.maxX - a.minX;
  const ah = a.maxY - a.minY;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const acx = a.minX + aw / 2;
  const acy = a.minY + ah / 2;
  const bcx = b.minX + bw / 2;
  const bcy = b.minY + bh / 2;
  return `size d=${(bw - aw).toFixed(2)},${(bh - ah).toFixed(2)} center d=${(bcx - acx).toFixed(2)},${(bcy - acy).toFixed(2)} px`;
}

function render(): void {
  const grid = measureGrid();
  const threePolygons = scenePolygons();
  const glyphPolygons = threePolygonsToGlyph(threePolygons);
  const polyPolygons = threePolygonsToPoly(threePolygons);
  const threeCamera = makeThreeCamera(grid);
  const glyphCamera = makeGlyphCamera(threeCamera);
  const polyCamera = makePolyCamera(threeCamera);

  renderThree(threePolygons, threeCamera, grid);
  renderGlyph(glyphPolygons, glyphCamera, grid);
  renderPoly(polyPolygons, polyCamera, grid);

  const threeBBox = projectedBBoxThree(threePolygons, threeCamera, grid);
  const glyphBBox = glyphTextBBox(glyphPre, grid);
  requestAnimationFrame(() => {
    const polyBBox = polyDomBBox(polyFrame);
    const tris = threePolygons.reduce((sum, polygon) => sum + Math.max(0, polygon.vertices.length - 2), 0);
    metricsEl.textContent = [
      `object=${sourceLabel} layout=${state.layout}`,
      `triangles=${tris} polygons=${threePolygons.length}`,
      `grid=${grid.cols}x${grid.rows} glyph cells  visual=${grid.width}x${grid.height} px`,
      `camera=${state.camera} view=${state.view} yaw=${state.yaw.toFixed(1)} pitch=${state.pitch.toFixed(1)} distance=${state.distance.toFixed(2)} orthoSize=${state.orthoSize.toFixed(2)} fov=${state.fov.toFixed(1)}`,
      "",
      bboxLine("three", threeBBox),
      bboxLine("glyphcss", glyphBBox),
      bboxLine("polycss", polyBBox),
      "",
      `glyphcss - three: ${bboxDelta(threeBBox, glyphBBox)}`,
      `polycss  - three: ${bboxDelta(threeBBox, polyBBox)}`,
      `polycss  - glyph: ${bboxDelta(glyphBBox, polyBBox)}`,
    ].join("\n");
    readout.textContent = `glyph vs three: ${bboxDelta(threeBBox, glyphBBox)} | poly vs three: ${bboxDelta(threeBBox, polyBBox)}`;
  });
  updateCodePanel(grid, threeCamera);
}

function syncInputs(): void {
  objectSelect.value = state.object;
  layoutSelect.value = state.layout;
  cameraSelect.value = state.camera;
  viewSelect.value = state.view;
  fovInput.value = String(state.fov);
  sizeInput.value = String(state.camera === "orthographic" ? state.orthoSize : state.distance);
  densityInput.value = String(state.density);
}

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set("object", state.object);
  params.set("layout", state.layout);
  params.set("camera", state.camera);
  params.set("view", state.view);
  params.set("density", state.density.toFixed(2));
  params.set("fov", state.fov.toFixed(0));
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function setViewPreset(view: ViewPreset): void {
  state.view = view;
  if (view === "front") {
    state.yaw = 0; state.pitch = 6; state.distance = 5.5; state.orthoSize = 4.2;
  } else if (view === "top") {
    state.yaw = 0; state.pitch = 89; state.distance = 6; state.orthoSize = 5.2;
  } else if (view === "low") {
    state.yaw = 38; state.pitch = 8; state.distance = 5.5; state.orthoSize = 3.8;
  } else if (view === "fpv") {
    state.camera = "fpv"; state.yaw = 180; state.pitch = -3; state.distance = 6; state.fpvEye.set(0, 1.3, 5.2);
  } else {
    state.yaw = 42; state.pitch = 26; state.distance = 6; state.orthoSize = 4;
  }
  syncInputs();
  syncUrl();
  render();
}

async function setObject(id: string): Promise<void> {
  const item = OBJECTS.find((object) => object.id === id) ?? OBJECTS[0]!;
  state.object = item.id;
  sourceLabel = item.label;
  readout.textContent = `loading ${item.label}...`;
  const glyphPolygons = await item.load();
  baseThreePolygons = normalizeThreePolygons(glyphPolygonsToThree(glyphPolygons));
  syncInputs();
  syncUrl();
  render();
}

function installUi(): void {
  for (const item of OBJECTS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    objectSelect.appendChild(option);
  }
  for (const [value, label] of [
    ["single", "single object"],
    ["lineup", "three copies"],
    ["occlusion", "depth occlusion"],
    ["ground", "ground + prop"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    layoutSelect.appendChild(option);
  }
  for (const [value, label] of [
    ["perspective", "perspective"],
    ["orthographic", "orthographic"],
    ["fpv", "FPV"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    cameraSelect.appendChild(option);
  }
  for (const [value, label] of [
    ["iso", "iso"],
    ["front", "front"],
    ["top", "top"],
    ["low", "low"],
    ["fpv", "FPV start"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    viewSelect.appendChild(option);
  }
  syncInputs();

  objectSelect.addEventListener("change", () => { void setObject(objectSelect.value); });
  layoutSelect.addEventListener("change", () => {
    state.layout = layoutSelect.value as LayoutMode;
    syncUrl();
    render();
  });
  cameraSelect.addEventListener("change", () => {
    state.camera = cameraSelect.value as CameraMode;
    if (state.camera === "fpv") setViewPreset("fpv");
    else {
      syncInputs();
      syncUrl();
      render();
    }
  });
  viewSelect.addEventListener("change", () => setViewPreset(viewSelect.value as ViewPreset));
  fovInput.addEventListener("input", () => {
    state.fov = Number(fovInput.value);
    syncUrl();
    render();
  });
  sizeInput.addEventListener("input", () => {
    const value = Number(sizeInput.value);
    if (state.camera === "orthographic") state.orthoSize = value;
    else state.distance = value;
    render();
  });
  densityInput.addEventListener("input", () => {
    state.density = Number(densityInput.value);
    syncUrl();
    render();
  });
  spinInput.addEventListener("change", () => render());
  resetBtn.addEventListener("click", () => setViewPreset(state.camera === "fpv" ? "fpv" : "iso"));
  for (const button of codeButtons) {
    button.addEventListener("click", () => {
      activeCode = button.dataset.kind as "three" | "glyph" | "poly";
      for (const next of codeButtons) next.dataset.active = String(next === button);
      render();
    });
  }
}

function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? Number(n.toFixed(digits)).toString() : "0";
}

function fmtThreeVec(v: THREE.Vector3): string {
  return `${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}`;
}

function objectSourceHint(): string {
  switch (state.object) {
    case "cube": return `resolveGeometry("cube", { center: [0, 0, 0], size: 1 })`;
    case "icosahedron": return `resolveGeometry("icosahedron", { center: [0, 0, 0], size: 1 })`;
    case "dodecahedron": return `resolveGeometry("dodecahedron", { center: [0, 0, 0], size: 1 })`;
    case "cactus-glb": return `loadMesh("/website/public/gallery/glb/Cactus.glb")`;
    case "pizza-cactus": return `loadMesh("/website/public/gallery/glb/poly-pizza/cactus-a.glb")`;
    case "box-glb": return `loadMesh("/website/public/gallery/glb/urban/Box.glb")`;
    case "pizza-box": return `loadMesh("/website/public/gallery/glb/poly-pizza/cardboard-box-closed.glb")`;
    case "car-glb": return `loadMesh("/website/public/gallery/glb/urban/Car.glb")`;
    case "sports-car": return `loadMesh("/website/public/gallery/glb/urban/Sports Car.glb")`;
    case "car-obj": return `loadMesh("/website/public/gallery/obj/opengameart/low-poly-car/car.obj", { mtlUrl: "/website/public/gallery/obj/opengameart/low-poly-car/car.mtl" })`;
    case "crate-obj": return `loadMesh("/website/public/gallery/obj/opengameart/crate/Box.obj", { mtlUrl: "/website/public/gallery/obj/opengameart/crate/Box.mtl" })`;
    case "cactus-obj": return `loadMesh("/website/public/gallery/obj/quaternius/nature/Cactus_3.obj", { mtlUrl: "/website/public/gallery/obj/quaternius/nature/Cactus_3.mtl" })`;
    default: return `loadMesh(/* ${sourceLabel} */)`;
  }
}

function cameraLookTarget(camera: THREE.Camera): THREE.Vector3 {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  return camera.position.clone().add(forward);
}

function updateCodePanel(grid: GridMetrics, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
  if (activeCode === "three") codeOutput.textContent = threeSnippet(grid, camera);
  else if (activeCode === "glyph") codeOutput.textContent = glyphSnippet(grid, camera);
  else codeOutput.textContent = polySnippet(grid, camera);
}

function snippetHeader(grid: GridMetrics): string {
  return [
    `// object: ${sourceLabel}`,
    `// source: ${objectSourceHint()}`,
    `// layout: ${state.layout}`,
    `// visual: ${grid.width}x${grid.height}px`,
    "",
  ].join("\n");
}

function threeSnippet(grid: GridMetrics, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): string {
  const look = cameraLookTarget(camera);
  const cameraCode = camera instanceof THREE.OrthographicCamera
    ? `const camera = new THREE.OrthographicCamera(${fmt(camera.left)}, ${fmt(camera.right)}, ${fmt(camera.top)}, ${fmt(camera.bottom)}, ${fmt(camera.near)}, ${fmt(camera.far)});`
    : `const camera = new THREE.PerspectiveCamera(${fmt(camera.fov)}, ${fmt(camera.aspect)}, ${fmt(camera.near)}, ${fmt(camera.far)});`;

  return `${snippetHeader(grid)}import * as THREE from "three";

${cameraCode}
camera.position.set(${fmtThreeVec(camera.position)});
camera.lookAt(${fmtThreeVec(look)});

scene.add(new THREE.AmbientLight(0xffffff, 0.42));
const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.position.set(3, 5, 4);
sun.target.position.set(0, 0, 0);
scene.add(sun, sun.target);

scene.add(new THREE.Mesh(
  polygonsToBufferGeometry(scenePolygons),
  new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide }),
));
renderer.render(scene, camera);`;
}

function glyphSnippet(grid: GridMetrics, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): string {
  const look = cameraLookTarget(camera);
  const cameraCode = camera instanceof THREE.OrthographicCamera
    ? `const camera = new OrthographicCamera(${fmt(camera.left)}, ${fmt(camera.right)}, ${fmt(camera.top)}, ${fmt(camera.bottom)}, ${fmt(camera.near)}, ${fmt(camera.far)});`
    : `const camera = new PerspectiveCamera(${fmt(camera.fov)}, ${fmt(camera.aspect)}, ${fmt(camera.near)}, ${fmt(camera.far)});`;

  return `${snippetHeader(grid)}import {
  compileScene,
  ${camera instanceof THREE.OrthographicCamera ? "OrthographicCamera" : "PerspectiveCamera"},
  DirectionalLight,
  Vector3,
  threeToGlyphPoint,
} from "glyphcss/three";

${cameraCode}
camera.position.set(${fmtThreeVec(camera.position)});
camera.lookAt(${fmtThreeVec(look)});

const light = new DirectionalLight("#ffffff", 1.05);
light.position.set(3, 5, 4);
light.target.position.set(0, 0, 0);

const glyphPolygons = scenePolygons.map((polygon) => ({
  ...polygon,
  vertices: polygon.vertices.map((v) => threeToGlyphPoint(new Vector3(v.x, v.y, v.z))),
}));

pre.innerHTML = compileScene({
  polygons: glyphPolygons,
  camera,
  cols: ${grid.cols},
  rows: ${grid.rows},
  cellAspect: ${fmt(grid.cellAspect)},
  mode: "solid",
  useColors: true,
  directionalLight: light.toGlyphDirectionalLight(),
  ambientLight: { color: "#ffffff", intensity: 0.42 },
}).inner;`;
}

function polySnippet(grid: GridMetrics, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): string {
  const look = cameraLookTarget(camera);
  const cameraCode = camera instanceof THREE.OrthographicCamera
    ? `const camera = new OrthographicCamera(${fmt(camera.left)}, ${fmt(camera.right)}, ${fmt(camera.top)}, ${fmt(camera.bottom)}, ${fmt(camera.near)}, ${fmt(camera.far)});`
    : `const camera = new PerspectiveCamera(${fmt(camera.fov)}, ${fmt(camera.aspect)}, ${fmt(camera.near)}, ${fmt(camera.far)});`;

  return `${snippetHeader(grid)}import {
  ${camera instanceof THREE.OrthographicCamera ? "OrthographicCamera" : "PerspectiveCamera"},
  DirectionalLight,
  Vector3,
  mountPolyThreeScene,
  threeToPolyPoint,
} from "@layoutit/polycss/three";

${cameraCode}
camera.position.set(${fmtThreeVec(camera.position)});
camera.lookAt(${fmtThreeVec(look)});

const light = new DirectionalLight("#ffffff", 1.05);
light.position.set(3, 5, 4);
light.target.position.set(0, 0, 0);

const polyPolygons = scenePolygons.map((polygon) => ({
  ...polygon,
  vertices: polygon.vertices.map((v) => threeToPolyPoint(new Vector3(v.x, v.y, v.z))),
}));

mountPolyThreeScene(host, {
  camera,
  cameraOptions: { viewportHeight: ${grid.height} },
  polygons: polyPolygons,
  autoCenter: false,
  directionalLight: light.toPolyDirectionalLight(),
  ambientLight: { color: "#ffffff", intensity: 0.42 },
  textureLighting: "dynamic",
});`;
}

function installPointerControls(): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  dragCatcher.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    dragCatcher.setPointerCapture(event.pointerId);
    stage.focus();
  });
  dragCatcher.addEventListener("pointerup", (event) => {
    dragging = false;
    try { dragCatcher.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  });
  dragCatcher.addEventListener("pointercancel", () => { dragging = false; });
  dragCatcher.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    state.yaw += dx * 0.22;
    state.pitch = Math.max(
      state.camera === "fpv" ? -80 : -20,
      Math.min(89, state.pitch + (state.camera === "fpv" ? -dy : dy) * 0.18),
    );
    render();
  });
  dragCatcher.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.001);
    if (state.camera === "orthographic") {
      state.orthoSize = Math.max(1.2, Math.min(12, state.orthoSize * factor));
    } else {
      state.distance = Math.max(1.5, Math.min(12, state.distance * factor));
    }
    syncInputs();
    render();
  }, { passive: false });
  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (state.camera === "fpv" && ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => keys.delete(event.code));
  window.addEventListener("blur", () => keys.clear());
}

function moveFpv(dt: number): boolean {
  if (state.camera !== "fpv") return false;
  let forward = 0;
  let right = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) forward += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) forward -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) right += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) right -= 1;
  if (forward === 0 && right === 0) return false;
  const f = fpvForward();
  f.y = 0;
  f.normalize();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).multiplyScalar(-1).normalize();
  const step = 2.4 * dt;
  state.fpvEye.addScaledVector(f, forward * step);
  state.fpvEye.addScaledVector(r, right * step);
  return true;
}

function loop(now: number): void {
  const dt = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
  lastTime = now;
  let changed = false;
  if (spinInput.checked) {
    state.objectSpin += dt * 0.65;
    changed = true;
  }
  if (moveFpv(dt)) changed = true;
  if (changed) render();
  animationFrame = requestAnimationFrame(loop);
}

async function init(): Promise<void> {
  installUi();
  installPointerControls();
  setViewPreset(state.view);
  await setObject(state.object);
  window.addEventListener("resize", render);
  animationFrame = requestAnimationFrame(loop);
  window.__threePolyGlyphParityBench = { render, setObject, state };
  window.__benchReady = true;
}

void init().catch((error) => {
  console.error(error);
  readout.textContent = error instanceof Error ? error.message : String(error);
});

window.addEventListener("beforeunload", () => {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  currentThreeMesh?.geometry.dispose();
  polyScene?.destroy();
});
