import {
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  createGlyphScene,
  cubePolygons,
  dodecahedronPolygons,
  icosahedronPolygons,
  loadMesh,
} from "../packages/glyphcss/src/index";
import type { GlyphCamera, GlyphMeshHandle, GlyphSceneHandle, Polygon, Vec3 } from "../packages/glyphcss/src/index";
import type { LoadMeshOptions } from "../packages/glyphcss/src/index";

import {
  createPolyOrthographicCamera,
  createPolyPerspectiveCamera,
  createPolyScene,
} from "../../Documents/voxcss/packages/polycss/src/index";
import type {
  PolyMeshHandle,
  PolyOrthographicCameraHandle,
  PolyPerspectiveCameraHandle,
  PolySceneHandle,
} from "../../Documents/voxcss/packages/polycss/src/index";

declare global {
  interface Window {
    __parityBench: unknown;
    __benchReady: boolean;
  }
}

type CameraMode = "orthographic" | "perspective" | "fpv";
type PolyCameraHandle = PolyOrthographicCameraHandle | PolyPerspectiveCameraHandle;

interface ModelCase {
  id: string;
  label: string;
  load: () => Promise<Polygon[]> | Polygon[];
}

interface GlyphView {
  host: HTMLElement;
  camera: GlyphCamera;
  scene: GlyphSceneHandle;
  mesh: GlyphMeshHandle;
}

interface PolyView {
  host: HTMLElement;
  camera: PolyCameraHandle;
  scene: PolySceneHandle;
  mesh: PolyMeshHandle;
}

interface CameraState {
  mode: CameraMode;
  rotX: number;
  rotY: number;
  zoom: number;
  distance: number;
  perspective: number;
  target: Vec3;
  eye: Vec3;
}

const BASE_TILE = 50;
const q = new URLSearchParams(location.search);
const qs = (key: string, fallback: string) => q.get(key) ?? fallback;
const qn = (key: string, fallback: number) => {
  const value = Number.parseFloat(q.get(key) ?? "");
  return Number.isFinite(value) ? value : fallback;
};

const modelSelect = document.getElementById("model") as HTMLSelectElement;
const cameraSelect = document.getElementById("camera") as HTMLSelectElement;
const zoomInput = document.getElementById("zoom") as HTMLInputElement;
const densityInput = document.getElementById("density") as HTMLInputElement;
const resetBtn = document.getElementById("reset") as HTMLButtonElement;
const readout = document.getElementById("readout") as HTMLElement;
const stage = document.getElementById("stage") as HTMLElement;
const glyphHost = document.getElementById("glyphHost") as HTMLElement;
const polyHost = document.getElementById("polyHost") as HTMLElement;
const overlayGlyphHost = document.getElementById("overlayGlyph") as HTMLElement;
const overlayPolyHost = document.getElementById("overlayPoly") as HTMLElement;
const renderHosts = [glyphHost, polyHost, overlayGlyphHost, overlayPolyHost];

const LIGHT = {
  directionalLight: { direction: [-0.45, -0.6, -0.65] as Vec3, intensity: 1.1, color: "#ffffff" },
  ambientLight: { intensity: 0.42, color: "#ffffff" },
};

function transformPolygons(polygons: Polygon[], scale: number, offset: Vec3, color?: string): Polygon[] {
  const moveVertex = ([x, y, z]: Vec3): Vec3 => [
    x * scale + offset[0],
    y * scale + offset[1],
    z * scale + offset[2],
  ];
  return polygons.map((polygon) => ({
    ...polygon,
    ...(color ? { color } : null),
    vertices: polygon.vertices.map(moveVertex),
    textureTriangles: polygon.textureTriangles?.map((triangle) => ({
      ...triangle,
      vertices: triangle.vertices.map(moveVertex) as [Vec3, Vec3, Vec3],
    })),
  }));
}

function normalizePolygons(polygons: Polygon[], targetSize = 2): Polygon[] {
  if (polygons.length === 0) return polygons;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      for (let i = 0; i < 3; i++) {
        if (vertex[i] < min[i]) min[i] = vertex[i];
        if (vertex[i] > max[i]) max[i] = vertex[i];
      }
    }
  }
  const center: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const scale = targetSize / extent;
  return transformPolygons(polygons, scale, [-center[0] * scale, -center[1] * scale, -center[2] * scale]);
}

async function galleryMesh(path: string, options: LoadMeshOptions = {}): Promise<Polygon[]> {
  const result = await loadMesh(path, {
    baseUrl: path,
    ...options,
  });
  return result.polygons;
}

function galleryObj(path: string, mtlUrl?: string): () => Promise<Polygon[]> {
  return () => galleryMesh(path, mtlUrl ? { mtlUrl } : {});
}

function galleryAsset(path: string): () => Promise<Polygon[]> {
  return () => galleryMesh(path);
}

const MODELS: ModelCase[] = [
  {
    id: "cactus-glb",
    label: "gallery GLB / cactus",
    load: galleryAsset("/website/public/gallery/glb/Cactus.glb"),
  },
  {
    id: "car-glb",
    label: "gallery GLB / car",
    load: galleryAsset("/website/public/gallery/glb/urban/Car.glb"),
  },
  {
    id: "box-glb",
    label: "gallery GLB / box",
    load: galleryAsset("/website/public/gallery/glb/urban/Box.glb"),
  },
  {
    id: "pizza-cactus-glb",
    label: "gallery GLB / pizza cactus",
    load: galleryAsset("/website/public/gallery/glb/poly-pizza/cactus-a.glb"),
  },
  {
    id: "pizza-box-glb",
    label: "gallery GLB / pizza box",
    load: galleryAsset("/website/public/gallery/glb/poly-pizza/cardboard-box-closed.glb"),
  },
  {
    id: "car-obj",
    label: "gallery OBJ / low-poly car",
    load: galleryObj(
      "/website/public/gallery/obj/opengameart/low-poly-car/car.obj",
      "/website/public/gallery/obj/opengameart/low-poly-car/car.mtl",
    ),
  },
  {
    id: "crate-obj",
    label: "gallery OBJ / crate",
    load: galleryObj(
      "/website/public/gallery/obj/opengameart/crate/Box.obj",
      "/website/public/gallery/obj/opengameart/crate/Box.mtl",
    ),
  },
  {
    id: "cactus-obj",
    label: "gallery OBJ / cactus",
    load: galleryObj(
      "/website/public/gallery/obj/quaternius/nature/Cactus_3.obj",
      "/website/public/gallery/obj/quaternius/nature/Cactus_3.mtl",
    ),
  },
  {
    id: "car-vox",
    label: "gallery VOX / car",
    load: galleryAsset("/website/public/gallery/vox/veh_car1.vox"),
  },
  {
    id: "cottage-obj",
    label: "gallery OBJ / cottage",
    load: galleryObj(
      "/website/public/gallery/obj/cottage.obj",
      "/website/public/gallery/obj/cottage.mtl",
    ),
  },
  {
    id: "rabbit-glb",
    label: "gallery GLB / rabbit",
    load: galleryAsset("/website/public/gallery/glb/poly-pizza/rabbit-blond.glb"),
  },
  {
    id: "boxes",
    label: "sanity / offset boxes",
    load: () => [
      ...transformPolygons(cubePolygons({ size: 1, color: "#f97373" }), 1, [-0.75, 0, 0]),
      ...transformPolygons(cubePolygons({ size: 0.75, color: "#48d5ff" }), 1, [0.65, 0.35, 0.25]),
      ...transformPolygons(cubePolygons({ size: 0.45, color: "#facc15" }), 1, [0.1, -0.85, 0.55]),
    ],
  },
  {
    id: "solids",
    label: "sanity / mixed solids",
    load: () => [
      ...transformPolygons(icosahedronPolygons({ size: 1, color: "#60a5fa" }), 1, [-0.75, -0.15, 0]),
      ...transformPolygons(dodecahedronPolygons({ size: 0.9, color: "#fb7185" }), 1, [0.75, 0.2, 0.05]),
    ],
  },
];

let modelPolygons: Polygon[] = [];
let glyphViews: GlyphView[] = [];
let polyViews: PolyView[] = [];
let modelId = qs("model", "cactus-glb");
let density = qn("density", 1);
let rafId: number | null = null;
const keys = new Set<string>();

const state: CameraState = {
  mode: (["orthographic", "perspective", "fpv"].includes(qs("camera", "orthographic"))
    ? qs("camera", "orthographic")
    : "orthographic") as CameraMode,
  rotX: qn("rotX", 65),
  rotY: qn("rotY", 45),
  zoom: qn("zoom", 90),
  distance: qn("distance", 0),
  perspective: qn("perspective", 32000),
  target: [0, 0, 0],
  eye: [-4, -4, 2],
};

function parseResult(polygons: Polygon[]) {
  return {
    polygons,
    objectUrls: [],
    warnings: [],
    dispose() {},
  };
}

function forwardDir(rotX: number, rotY: number): Vec3 {
  const rx = (rotX * Math.PI) / 180;
  const ry = (rotY * Math.PI) / 180;
  return [
    -Math.sin(rx) * Math.cos(ry),
    -Math.sin(rx) * Math.sin(ry),
    -Math.cos(rx),
  ];
}

function fpvTarget(): Vec3 {
  const f = forwardDir(state.rotX, state.rotY);
  const d = state.perspective / Math.max(state.zoom, 0.001);
  return [
    state.eye[0] + f[0] * d,
    state.eye[1] + f[1] * d,
    state.eye[2] + f[2] * d,
  ];
}

function activeTarget(): Vec3 {
  return state.mode === "fpv" ? fpvTarget() : state.target;
}

function createGlyphCamera(): GlyphCamera {
  if (state.mode === "orthographic") {
    return createGlyphOrthographicCamera({ rotX: state.rotX, rotY: state.rotY, zoom: state.zoom });
  }
  return createGlyphPerspectiveCamera({
    rotX: state.rotX,
    rotY: state.rotY,
    zoom: state.zoom,
    distance: state.distance,
    perspective: state.perspective,
  });
}

function createPolyCamera(): PolyCameraHandle {
  if (state.mode === "orthographic") {
    return createPolyOrthographicCamera({
      rotX: state.rotX,
      rotY: state.rotY,
      zoom: state.zoom,
      distance: state.distance,
      target: activeTarget(),
    });
  }
  return createPolyPerspectiveCamera({
    rotX: state.rotX,
    rotY: state.rotY,
    zoom: state.zoom,
    distance: state.distance,
    perspective: state.perspective,
    target: activeTarget(),
  });
}

function makeGlyphView(host: HTMLElement): GlyphView {
  host.innerHTML = "";
  const camera = createGlyphCamera();
  camera.target = activeTarget();
  camera.eyeMode = false;
  const scene = createGlyphScene(host, {
    camera,
    autoSize: true,
    mode: "solid",
    useColors: true,
    smoothShading: false,
    glyphPalette: "default",
    ...LIGHT,
  });
  const mesh = scene.add(modelPolygons);
  return { host, camera, scene, mesh };
}

function makePolyView(host: HTMLElement): PolyView {
  host.innerHTML = "";
  const camera = createPolyCamera();
  const scene = createPolyScene(host, {
    camera,
    autoCenter: false,
    directionalLight: LIGHT.directionalLight,
    ambientLight: LIGHT.ambientLight,
    textureLighting: "dynamic",
  });
  const mesh = scene.add(parseResult(modelPolygons), { merge: false, stableDom: true });
  return { host, camera, scene, mesh };
}

function destroyViews(): void {
  for (const view of glyphViews) view.scene.destroy();
  for (const view of polyViews) view.scene.destroy();
  glyphViews = [];
  polyViews = [];
}

function setHostDensity(): void {
  const font = 8 / Math.max(density, 0.1);
  for (const host of renderHosts) {
    host.style.fontSize = `${font}px`;
    host.style.lineHeight = "1";
  }
  for (const view of glyphViews) view.scene.fit();
}

function rebuildViews(): void {
  destroyViews();
  setHostDensity();
  glyphViews = [makeGlyphView(glyphHost), makeGlyphView(overlayGlyphHost)];
  polyViews = [makePolyView(polyHost), makePolyView(overlayPolyHost)];
  applyCamera();
}

function applyCamera(): void {
  const target = activeTarget();
  for (const view of glyphViews) {
    view.camera.rotX = state.rotX;
    view.camera.rotY = state.rotY;
    view.camera.zoom = state.zoom;
    view.camera.distance = state.distance;
    view.camera.perspective = state.mode === "orthographic" ? 0 : state.perspective;
    view.camera.target = target;
    view.camera.eyeMode = false;
    view.scene.rerender();
  }
  for (const view of polyViews) {
    view.camera.update({
      rotX: state.rotX,
      rotY: state.rotY,
      zoom: state.zoom,
      distance: state.distance,
      target,
    });
    view.scene.applyCamera();
  }
  updateReadoutSoon();
}

function resetCamera(mode = state.mode): void {
  state.mode = mode;
  state.distance = 0;
  if (mode === "fpv") {
    state.rotX = 70;
    state.rotY = 225;
    state.zoom = 50;
    state.perspective = 2000;
    state.eye = [-4, -4, 2];
  } else {
    state.rotX = 65;
    state.rotY = 45;
    state.zoom = mode === "orthographic" ? 90 : 75;
    state.perspective = 32000;
    state.target = [0, 0, 0];
  }
  zoomInput.value = String(state.zoom);
}

function glyphContentBBox(host: HTMLElement): DOMRect | null {
  const pre = host.querySelector("pre.glyph-output") as HTMLPreElement | null;
  if (!pre) return null;
  const text = pre.textContent ?? "";
  const lines = text.split("\n");
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (let r = 0; r < lines.length; r++) {
    const line = lines[r] ?? "";
    for (let c = 0; c < line.length; c++) {
      if (line[c] === " ") continue;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
  }
  if (!Number.isFinite(minC)) return null;
  const rect = pre.getBoundingClientRect();
  const cols = Math.max(...lines.map((line) => line.length), 1);
  const rows = Math.max(lines.length, 1);
  const cw = rect.width / cols;
  const ch = rect.height / rows;
  return new DOMRect(
    rect.left + minC * cw,
    rect.top + minR * ch,
    (maxC - minC + 1) * cw,
    (maxR - minR + 1) * ch,
  );
}

function polyContentBBox(host: HTMLElement): DOMRect | null {
  const elements = Array.from(host.querySelectorAll<HTMLElement>(".polycss-mesh *"));
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) continue;
    if (rect.left < left) left = rect.left;
    if (rect.top < top) top = rect.top;
    if (rect.right > right) right = rect.right;
    if (rect.bottom > bottom) bottom = rect.bottom;
  }
  if (!Number.isFinite(left)) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function fmtVec(v: Vec3): string {
  return `[${v.map((n) => n.toFixed(2)).join(",")}]`;
}

let readoutQueued = false;
function updateReadoutSoon(): void {
  if (readoutQueued) return;
  readoutQueued = true;
  requestAnimationFrame(() => {
    readoutQueued = false;
    const gb = glyphContentBBox(overlayGlyphHost);
    const pb = polyContentBBox(overlayPolyHost);
    const dw = gb && pb ? pb.width - gb.width : NaN;
    const dh = gb && pb ? pb.height - gb.height : NaN;
    const dcx = gb && pb ? (pb.left + pb.width / 2) - (gb.left + gb.width / 2) : NaN;
    const dcy = gb && pb ? (pb.top + pb.height / 2) - (gb.top + gb.height / 2) : NaN;
    readout.textContent =
      `model=${modelId} camera=${state.mode} rot=(${state.rotX.toFixed(1)},${state.rotY.toFixed(1)}) ` +
      `zoom=${state.zoom.toFixed(1)} target=${fmtVec(activeTarget())} ` +
      `bbox delta poly-glyph: size=(${Number.isFinite(dw) ? dw.toFixed(1) : "?"},${Number.isFinite(dh) ? dh.toFixed(1) : "?"}) ` +
      `center=(${Number.isFinite(dcx) ? dcx.toFixed(1) : "?"},${Number.isFinite(dcy) ? dcy.toFixed(1) : "?"}) px`;
  });
}

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set("model", modelId);
  params.set("camera", state.mode);
  params.set("zoom", state.zoom.toFixed(2));
  params.set("density", density.toFixed(2));
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function setCameraMode(mode: CameraMode): void {
  resetCamera(mode);
  cameraSelect.value = mode;
  syncUrl();
  rebuildViews();
}

async function setModel(next: string): Promise<void> {
  const model = MODELS.find((item) => item.id === next) ?? MODELS[0]!;
  modelId = model.id;
  readout.textContent = `loading ${model.label}...`;
  const loaded = await model.load();
  modelPolygons = normalizePolygons(loaded);
  modelSelect.value = modelId;
  syncUrl();
  rebuildViews();
}

function moveFpv(dt: number): boolean {
  if (state.mode !== "fpv") return false;
  let mf = 0;
  let mr = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) mf += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) mf -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) mr += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) mr -= 1;
  if (mf === 0 && mr === 0) return false;
  const r = (state.rotY * Math.PI) / 180;
  const fx = -Math.cos(r);
  const fy = -Math.sin(r);
  const rx = -Math.sin(r);
  const ry = Math.cos(r);
  const len = Math.hypot(mf, mr) || 1;
  const step = 3.5 * dt;
  state.eye[0] += ((fx * mf + rx * mr) / len) * step;
  state.eye[1] += ((fy * mf + ry * mr) / len) * step;
  return true;
}

let lastTime = 0;
function loop(now: number): void {
  const dt = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
  lastTime = now;
  if (moveFpv(dt)) applyCamera();
  rafId = requestAnimationFrame(loop);
}

function startLoop(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(loop);
}

function installControls(): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  stage.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.setPointerCapture(event.pointerId);
    stage.focus();
  });
  stage.addEventListener("pointerup", (event) => {
    dragging = false;
    try { stage.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  });
  stage.addEventListener("pointercancel", () => { dragging = false; });
  stage.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (state.mode === "fpv") {
      state.rotY = ((((state.rotY - dx * 0.18) % 360) + 360) % 360);
      state.rotX = Math.max(5, Math.min(175, state.rotX - dy * 0.18));
    } else {
      state.rotY = ((((state.rotY + dx * 0.25) % 360) + 360) % 360);
      state.rotX = Math.max(0, Math.min(180, state.rotX + dy * 0.25));
    }
    applyCamera();
  });
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.001);
    state.zoom = Math.max(8, Math.min(180, state.zoom * factor));
    zoomInput.value = String(state.zoom);
    syncUrl();
    applyCamera();
  }, { passive: false });
  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (state.mode === "fpv" && ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => { keys.delete(event.code); });
  window.addEventListener("blur", () => { keys.clear(); });
}

function installUi(): void {
  for (const model of MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    modelSelect.appendChild(option);
  }
  for (const [value, label] of [
    ["orthographic", "orthographic"],
    ["perspective", "perspective"],
    ["fpv", "FPV"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    cameraSelect.appendChild(option);
  }
  modelSelect.value = modelId;
  cameraSelect.value = state.mode;
  zoomInput.value = String(state.zoom);
  densityInput.value = String(density);

  modelSelect.addEventListener("change", () => { void setModel(modelSelect.value); });
  cameraSelect.addEventListener("change", () => setCameraMode(cameraSelect.value as CameraMode));
  zoomInput.addEventListener("input", () => {
    state.zoom = Number.parseFloat(zoomInput.value);
    syncUrl();
    applyCamera();
  });
  densityInput.addEventListener("input", () => {
    density = Number.parseFloat(densityInput.value);
    setHostDensity();
    syncUrl();
    applyCamera();
  });
  resetBtn.addEventListener("click", () => {
    resetCamera(state.mode);
    syncUrl();
    rebuildViews();
  });
}

installUi();
installControls();
resetCamera(state.mode);
zoomInput.value = String(qn("zoom", state.zoom));
state.zoom = Number.parseFloat(zoomInput.value);
density = qn("density", density);
densityInput.value = String(density);
await setModel(modelId);
startLoop();

window.__parityBench = {
  state,
  setModel,
  setCameraMode,
  applyCamera,
  glyphViews,
  polyViews,
};
window.__benchReady = true;
