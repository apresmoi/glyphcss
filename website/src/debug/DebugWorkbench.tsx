import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PolyAxesHelper,
  PolyCamera,
  PolyDirectionalLightHelper,
  PolyScene,
  parseGltf,
  parseMtl,
  parseObj,
} from "@polycss/react";
import type {
  AmbientLight,
  DirectionalLight,
  GltfParseOptions,
  ObjParseOptions,
  Polygon,
  TextureLightingMode,
} from "@polycss/react";
import {
  axesHelperPolygons,
  createPolyControls,
  createPolyScene,
  octahedronPolygons,
} from "polycss";
import type {
  ControlsHandle,
  MeshHandle,
  PolySceneOptions,
  SceneHandle,
  Vec3,
} from "polycss";
import "./debug-workbench.css";

type Renderer = "react" | "vanilla";
type ModelKind = "obj" | "glb" | "gltf";
type TextureQuality = "auto" | "full" | "balanced" | "draft";

interface PresetModel {
  id: string;
  label: string;
  kind: "obj" | "glb" | "gltf";
  category: string;
  url: string;
  mtlUrl?: string;
  zoom?: number;
  rotX?: number;
  rotY?: number;
  options?: ObjParseOptions | GltfParseOptions;
}

interface LoadedModel {
  label: string;
  kind: ModelKind;
  polygons: Polygon[];
  sourcePolygons: number;
  sourceBytes: number;
  warnings: string[];
  parseMs: number;
  dispose: () => void;
}

interface SceneOptionsState {
  renderer: Renderer;
  autoCenter: boolean;
  interactive: boolean;
  animate: boolean;
  showFloor: boolean;
  showBackfaces: boolean;
  showAxes: boolean;
  showLight: boolean;
  zoom: number;
  rotX: number;
  rotY: number;
  perspective: number | false;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
  textureLighting: TextureLightingMode;
  textureQuality: TextureQuality;
}

interface ParserOptionsState {
  targetSize: number;
  gridShift: number;
  defaultColor: string;
}

interface DomMetrics {
  measuredAt: number;
  renderMs: number;
  nodeCount: number;
  polyCount: number;
  visiblePolyCount: number;
}

interface AtlasEstimate {
  atlasPolygons: number;
}

const PRESETS: PresetModel[] = [
  {
    id: "chicken",
    label: "Chicken",
    category: "Characters",
    kind: "obj",
    url: "/gallery/obj/chicken.obj",
    mtlUrl: "/gallery/obj/chicken.mtl",
    options: { targetSize: 60, defaultColor: "#cccccc" },
    zoom: 0.15,
    rotX: 74.4,
    rotY: 301.6,
  },
  {
    id: "church",
    label: "Church (UV-mapped)",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/church.obj",
    mtlUrl: "/gallery/obj/church.mtl",
    options: { targetSize: 60, defaultColor: "#cccccc" },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "avocado",
    label: "Avocado (UV-mapped)",
    category: "Objects",
    kind: "obj",
    url: "/gallery/obj/avocado.obj",
    mtlUrl: "/gallery/obj/avocado.mtl",
    options: { targetSize: 50, defaultColor: "#cccccc" },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "sting",
    label: "Sting Sword (UV-mapped)",
    category: "Objects",
    kind: "obj",
    url: "/gallery/obj/sting.obj",
    options: {
      targetSize: 60,
      defaultColor: "#cccccc",
      materialTextures: { Sting: "/gallery/obj/sting-diffuse.png" },
    },
    zoom: 0.3,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "cottage",
    label: "Cottage (UV-mapped)",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/cottage.obj",
    options: {
      targetSize: 60,
      defaultColor: "#a0a0a0",
      materialTextures: { cottage_texture: "/gallery/obj/cottage-diffuse.png" },
      includeObjects: ["Cube_Cube.002"],
    },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "rock1",
    label: "Rock (UV-mapped)",
    category: "Environment",
    kind: "obj",
    url: "/gallery/obj/rock1.obj",
    mtlUrl: "/gallery/obj/rock1.mtl",
    options: { targetSize: 40, defaultColor: "#8b6f47", excludeObjects: ["Plane"] },
    zoom: 0.6,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "insurgent",
    label: "Insurgent (.gltf, embedded buffer)",
    category: "Characters",
    kind: "gltf",
    url: "/gallery/glb/insurgent.gltf",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-car",
    label: "Apocalypse Car (GLB)",
    category: "Vehicles",
    kind: "glb",
    url: "/gallery/glb/apocalypse/car.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-barrel",
    label: "Apocalypse Barrel (GLB)",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/barrel.glb",
    options: { targetSize: 50 },
    zoom: 0.5,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-wall",
    label: "Apocalypse Wall (GLB)",
    category: "Architecture",
    kind: "glb",
    url: "/gallery/glb/apocalypse/wall_1.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "apoc-spike",
    label: "Spike Barricade (GLB)",
    category: "Objects",
    kind: "glb",
    url: "/gallery/glb/apocalypse/wooden_spike_barricade.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "ranger",
    label: "Ranger (GLB, UV-mapped)",
    category: "Characters",
    kind: "glb",
    url: "/gallery/glb/ranger.glb",
    options: { targetSize: 60 },
    zoom: 0.4,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "tree",
    label: "Tree",
    category: "Environment",
    kind: "glb",
    url: "/gallery/glb/tree.glb",
    options: { targetSize: 60 },
    zoom: 0.3,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "saucer",
    label: "Flying saucer",
    category: "Vehicles",
    kind: "obj",
    url: "/gallery/obj/saucer.obj",
    options: { targetSize: 60, defaultColor: "#94a3b8" },
    zoom: 0.2,
    rotX: 67,
    rotY: 42.3,
  },
  {
    id: "wheelbarrow",
    label: "Wheelbarrow",
    category: "Objects",
    kind: "obj",
    url: "/gallery/obj/wheelbarrow.obj",
    mtlUrl: "/gallery/obj/wheelbarrow.mtl",
    options: { targetSize: 60 },
    zoom: 0.2,
    rotX: 66.2,
    rotY: 36.1,
  },
  {
    id: "teapot",
    label: "Teapot",
    category: "Objects",
    kind: "obj",
    url: "/gallery/obj/teapot.obj",
    options: { targetSize: 60, defaultColor: "#a3a3a3" },
    zoom: 0.2,
    rotX: 65,
    rotY: 45,
  },
  {
    id: "castle",
    label: "Castle",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/castle.obj",
    options: { targetSize: 60 },
    zoom: 0.15,
    rotX: 66.9,
    rotY: 68.5,
  },
  {
    id: "coliseum",
    label: "Coliseum",
    category: "Architecture",
    kind: "obj",
    url: "/gallery/obj/coliseum.obj",
    options: { targetSize: 80, palette: ["#c9a876", "#a78760", "#8b6f47", "#6b5538"] },
    zoom: 0.15,
    rotX: 65,
    rotY: 45,
  },
];

const DEBUG_NAV = [
  { path: "/debug/sphere", label: "Sphere" },
  { path: "/debug/platonic", label: "Platonic solids" },
  { path: "/debug/triangle-editor", label: "Triangle editor" },
  { path: "/debug/meshes", label: "Meshes (OBJ / GLB)" },
];

const DEFAULT_SCENE: SceneOptionsState = {
  renderer: "vanilla",
  autoCenter: true,
  interactive: true,
  animate: false,
  showFloor: false,
  showBackfaces: false,
  showAxes: false,
  showLight: false,
  zoom: PRESETS[0].zoom ?? 0.35,
  rotX: PRESETS[0].rotX ?? 65,
  rotY: PRESETS[0].rotY ?? 45,
  perspective: false,
  lightAzimuth: 50,
  lightElevation: 45,
  lightIntensity: 1,
  lightColor: "#ffffff",
  ambientIntensity: 0.4,
  ambientColor: "#ffffff",
  textureLighting: "baked",
  textureQuality: "auto",
};

const DEFAULT_PARSER: ParserOptionsState = {
  targetSize: 60,
  gridShift: 1,
  defaultColor: "#8b95a1",
};

function parserDefaultsFor(model: PresetModel): Partial<ParserOptionsState> {
  const options = model.options as (ObjParseOptions & GltfParseOptions) | undefined;
  return {
    ...(typeof options?.targetSize === "number" ? { targetSize: options.targetSize } : {}),
    ...(typeof options?.gridShift === "number" ? { gridShift: options.gridShift } : {}),
    ...(typeof options?.defaultColor === "string" ? { defaultColor: options.defaultColor } : {}),
  };
}

const EMPTY_METRICS: DomMetrics = {
  measuredAt: 0,
  renderMs: 0,
  nodeCount: 0,
  polyCount: 0,
  visiblePolyCount: 0,
};

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function formatMs(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function atlasScaleForQuality(quality: TextureQuality): PolySceneOptions["atlasScale"] {
  switch (quality) {
    case "auto":
      return "auto";
    case "draft":
      return 0.25;
    case "balanced":
      return 0.75;
    case "full":
    default:
      return 1;
  }
}

function mergeParserOptions(
  base: ObjParseOptions | GltfParseOptions | undefined,
  parser: ParserOptionsState,
): ObjParseOptions & GltfParseOptions {
  return {
    ...(base ?? {}),
    targetSize: parser.targetSize,
    gridShift: parser.gridShift,
    defaultColor: parser.defaultColor,
  };
}

async function loadPresetModel(model: PresetModel, parser: ParserOptionsState): Promise<LoadedModel> {
  const started = performance.now();
  if (model.kind === "obj") {
    const [objText, mtlText] = await Promise.all([
      fetch(model.url).then((res) => {
        if (!res.ok) throw new Error(`fetch ${model.url} -> ${res.status}`);
        return res.text();
      }),
      model.mtlUrl
        ? fetch(model.mtlUrl).then((res) => (res.ok ? res.text() : null))
        : Promise.resolve(null),
    ]);

    const mtl = mtlText ? parseMtl(mtlText) : { colors: {}, textures: {} };
    const resolvedTextures: Record<string, string> = {};
    for (const [name, path] of Object.entries(mtl.textures)) {
      resolvedTextures[name] = model.mtlUrl
        ? new URL(path, new URL(model.mtlUrl, window.location.href)).href
        : path;
    }

    const options = mergeParserOptions(model.options, parser);
    const parsed = parseObj(objText, {
      ...options,
      materialColors: {
        ...mtl.colors,
        ...((model.options as ObjParseOptions | undefined)?.materialColors ?? {}),
      },
      materialTextures: {
        ...resolvedTextures,
        ...((model.options as ObjParseOptions | undefined)?.materialTextures ?? {}),
      },
    });
    return {
      label: model.label,
      kind: "obj",
      polygons: parsed.polygons,
      sourcePolygons: parsed.polygons.length,
      sourceBytes: objText.length + (mtlText?.length ?? 0),
      warnings: parsed.warnings ?? [],
      parseMs: performance.now() - started,
      dispose: parsed.dispose,
    };
  }

  const buf = await fetch(model.url).then((res) => {
    if (!res.ok) throw new Error(`fetch ${model.url} -> ${res.status}`);
    return res.arrayBuffer();
  });
  const parsed = parseGltf(buf, {
    ...mergeParserOptions(model.options, parser),
    baseUrl: new URL(model.url, window.location.href).href,
  });
  return {
    label: model.label,
    kind: model.kind,
    polygons: parsed.polygons,
    sourcePolygons: parsed.polygons.length,
    sourceBytes: buf.byteLength,
    warnings: parsed.warnings ?? [],
    parseMs: performance.now() - started,
    dispose: parsed.dispose,
  };
}

function buildFloor(polygons: Polygon[]): Polygon | null {
  if (polygons.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  const padX = Math.max(2, (maxX - minX) * 0.18);
  const padY = Math.max(2, (maxY - minY) * 0.18);
  return {
    vertices: [
      [minX - padX, minY - padY, 0],
      [maxX + padX, minY - padY, 0],
      [maxX + padX, maxY + padY, 0],
      [minX - padX, maxY + padY, 0],
    ],
    color: "#252a2d",
  };
}

function directionalFromOptions(options: SceneOptionsState): DirectionalLight {
  const az = (options.lightAzimuth * Math.PI) / 180;
  const el = (options.lightElevation * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return {
    direction: [
      cosEl * Math.sin(az),
      cosEl * Math.cos(az),
      Math.sin(el),
    ],
    color: options.lightColor,
    intensity: options.lightIntensity,
  };
}

function ambientFromOptions(options: SceneOptionsState): AmbientLight {
  return {
    color: options.ambientColor,
    intensity: options.ambientIntensity,
  };
}

function estimateAtlasFootprint(polygons: Polygon[]): AtlasEstimate {
  let atlasPolygons = 0;

  for (const polygon of polygons) {
    if (polygon.vertices.length < 3) continue;
    atlasPolygons += 1;
  }

  return {
    atlasPolygons,
  };
}

function measureDom(root: HTMLElement | null, renderMs: number): DomMetrics {
  if (!root) return { ...EMPTY_METRICS, renderMs };
  const polyEls = Array.from(root.querySelectorAll<HTMLElement>(".polycss-scene i"));
  return {
    measuredAt: performance.now(),
    renderMs,
    nodeCount: root.querySelectorAll("*").length,
    polyCount: polyEls.length,
    visiblePolyCount: polyEls.filter((el) => getComputedStyle(el).display !== "none").length,
  };
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="dn-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <output>{format(value)}</output>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="dn-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) {
  return (
    <div className={`dn-stat${tone ? ` dn-stat--${tone}` : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

// Light helper world units → CSS pixels conversion (matches the helper
// components in @polycss/react and @polycss/vue).
const LIGHT_HELPER_TILE = 50;

function lightHelperPosition(
  light: DirectionalLight,
  target: Vec3,
  distance: number,
): Vec3 {
  const [dx, dy, dz] = light.direction;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [
    (target[1] + (dx / len) * distance) * LIGHT_HELPER_TILE,
    (target[0] + (dy / len) * distance) * LIGHT_HELPER_TILE,
    (target[2] + (dz / len) * distance) * LIGHT_HELPER_TILE,
  ];
}

function VanillaScene({
  polygons,
  options,
  directionalLight,
  ambientLight,
  showAxes,
  showLight,
  helperScale,
  helperTarget,
  onBuild,
}: {
  polygons: Polygon[];
  options: SceneOptionsState;
  directionalLight: DirectionalLight;
  ambientLight: AmbientLight;
  showAxes: boolean;
  showLight: boolean;
  helperScale: number;
  helperTarget: Vec3;
  onBuild: (ms: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const controlsRef = useRef<ControlsHandle | null>(null);
  const meshHandleRef = useRef<MeshHandle | null>(null);
  const axesHandleRef = useRef<MeshHandle | null>(null);
  const lightHandleRef = useRef<MeshHandle | null>(null);
  const onBuildRef = useRef(onBuild);
  onBuildRef.current = onBuild;

  // Split things into "structural" (require destroying the scene) vs
  // "incremental" (can be applied via setOptions / setTransform). In
  // dynamic mode the chicken's atlas is light-independent, so we drop the
  // light from the structural deps — sliding the light then only flows
  // through the cheap setOptions effect, no flicker.
  const stableDirectionalForRebuild =
    options.textureLighting === "dynamic" ? null : directionalLight;
  const stableAmbientForRebuild =
    options.textureLighting === "dynamic" ? null : ambientLight;

  // Effect 1 — heavy: create the scene + add the chicken polygons.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";
    const started = performance.now();
    const sceneOptions: PolySceneOptions = {
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
      perspective: options.perspective,
      autoCenter: options.autoCenter,
      atlasScale: atlasScaleForQuality(options.textureQuality),
    };
    const scene = createPolyScene(host, sceneOptions);
    sceneRef.current = scene;
    meshHandleRef.current = scene.add({
      polygons,
      objectUrls: [],
      warnings: [],
      dispose: () => {},
    });
    requestAnimationFrame(() =>
      onBuildRef.current(performance.now() - started),
    );
    return () => {
      // Tear controls down BEFORE destroying the scene — otherwise the
      // controls' rAF tick could fire one more time against a stale handle.
      controlsRef.current?.destroy();
      controlsRef.current = null;
      axesHandleRef.current = null;
      lightHandleRef.current = null;
      meshHandleRef.current = null;
      sceneRef.current = null;
      scene.destroy();
    };
  }, [
    polygons,
    options.autoCenter,
    options.textureQuality,
    options.textureLighting,
    options.perspective,
    stableDirectionalForRebuild,
    stableAmbientForRebuild,
  ]);

  // Effect 2 — cheap: live transform + lighting updates via setOptions.
  // Sliding sliders only flows through this path.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      directionalLight,
      ambientLight,
      textureLighting: options.textureLighting,
    });
  }, [
    options.rotX,
    options.rotY,
    options.zoom,
    options.textureLighting,
    directionalLight,
    ambientLight,
  ]);

  // Effect 2.5 — vanilla controls. The React renderer wires interactive +
  // animate through <PolyCamera>; the vanilla path uses createPolyControls.
  // The handle is created lazily once the scene is ready and we're on the
  // vanilla renderer; subsequent prop changes flow through controls.update().
  useEffect(() => {
    if (options.renderer !== "vanilla") {
      controlsRef.current?.destroy();
      controlsRef.current = null;
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    if (!controlsRef.current) {
      controlsRef.current = createPolyControls(scene, {
        drag: options.interactive,
        wheel: options.interactive,
        animate: options.animate ? { speed: 0.3, axis: "y", pauseOnInteraction: true } : false,
      });
    } else {
      controlsRef.current.update({
        drag: options.interactive,
        wheel: options.interactive,
        animate: options.animate ? { speed: 0.3, axis: "y", pauseOnInteraction: true } : false,
      });
    }
    return () => {
      // Effect re-runs when deps change — destroy only on full unmount,
      // which is signaled by the scene Effect 1 cleanup destroying scene.
      // Until then, the next effect run will reuse + update controlsRef.
    };
  }, [options.renderer, options.interactive, options.animate, polygons]);

  // Effect 3 — axes helper. Add/remove based on toggle; rebuild when scale
  // changes (different bar lengths bake into different polygons).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showAxes) {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
      return;
    }
    axesHandleRef.current = scene.add(
      {
        polygons: axesHelperPolygons({ size: helperScale * 0.6 }),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      { excludeFromAutoCenter: true },
    );
    return () => {
      axesHandleRef.current?.dispose();
      axesHandleRef.current = null;
    };
  }, [showAxes, helperScale, polygons]);

  // Effect 4 — light helper. Octahedron at LOCAL origin so polygons stay
  // stable across light moves; the light direction only updates the
  // mesh wrapper transform.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!showLight) {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
      return;
    }
    const swatch = directionalLight.color ?? "#ffd54a";
    lightHandleRef.current = scene.add(
      {
        polygons: octahedronPolygons([0, 0, 0], helperScale * 0.05, swatch),
        objectUrls: [],
        warnings: [],
        dispose: () => {},
      },
      {
        position: lightHelperPosition(
          directionalLight,
          helperTarget,
          helperScale * 0.7,
        ),
        excludeFromAutoCenter: true,
      },
    );
    return () => {
      lightHandleRef.current?.dispose();
      lightHandleRef.current = null;
    };
    // directionalLight.color triggers a remount because the swatch is
    // baked into polygon data; direction is handled by Effect 5 below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLight, helperScale, directionalLight.color, polygons]);

  // Effect 5 — slide the light helper to the new orbit position whenever
  // direction or target/distance change. Only updates the wrapper
  // transform, no atlas work.
  useEffect(() => {
    const handle = lightHandleRef.current;
    if (!handle) return;
    handle.setTransform({
      position: lightHelperPosition(
        directionalLight,
        helperTarget,
        helperScale * 0.7,
      ),
    });
  }, [directionalLight, helperTarget, helperScale]);

  return <div className="dn-vanilla-host" ref={hostRef} />;
}

export default function DebugWorkbench() {
  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(DEFAULT_SCENE);
  const [parserOptions, setParserOptions] = useState<ParserOptionsState>(DEFAULT_PARSER);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<DomMetrics>(EMPTY_METRICS);
  const [vanillaBuildMs, setVanillaBuildMs] = useState(0);
  const disposeRef = useRef<(() => void) | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const renderStartRef = useRef(performance.now());

  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    setSceneOptions((current) => ({ ...current, ...partial }));
  }, []);

  const updateParser = useCallback((partial: Partial<ParserOptionsState>) => {
    setParserOptions((current) => ({ ...current, ...partial }));
  }, []);

  const selectedPreset = PRESETS.find((preset) => preset.id === presetId) ?? PRESETS[0];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const run = async () => {
      try {
        disposeRef.current?.();
        disposeRef.current = null;
        const next = await loadPresetModel(selectedPreset, parserOptions);
        if (cancelled) {
          next.dispose();
          return;
        }
        disposeRef.current = next.dispose;
        setLoaded(next);
      } catch (error) {
        if (cancelled) return;
        setLoaded(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedPreset, parserOptions]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
    };
  }, []);

  const directionalLight = useMemo(() => directionalFromOptions(sceneOptions), [sceneOptions]);
  const ambientLight = useMemo(() => ambientFromOptions(sceneOptions), [sceneOptions]);
  const atlasScale = atlasScaleForQuality(sceneOptions.textureQuality);

  const scenePolygons = useMemo(() => {
    const base = loaded?.polygons ?? [];
    if (!sceneOptions.showFloor) return base;
    const floor = buildFloor(base);
    return floor ? [...base, floor] : base;
  }, [loaded, sceneOptions.showFloor]);

  const helperBbox = useMemo(() => {
    const polygons = loaded?.polygons ?? [];
    if (polygons.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const polygon of polygons) {
      for (const v of polygon.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }, [loaded]);

  const helperScale = useMemo(() => {
    if (!helperBbox) return 30;
    return Math.max(
      helperBbox.maxX - helperBbox.minX,
      helperBbox.maxY - helperBbox.minY,
      helperBbox.maxZ - helperBbox.minZ,
      1,
    );
  }, [helperBbox]);

  const helperTarget = useMemo<[number, number, number]>(() => {
    if (!helperBbox) return [0, 0, 0];
    return [
      (helperBbox.minX + helperBbox.maxX) / 2,
      (helperBbox.minY + helperBbox.maxY) / 2,
      (helperBbox.minZ + helperBbox.maxZ) / 2,
    ];
  }, [helperBbox]);

  const atlasEstimate = useMemo(
    () => estimateAtlasFootprint(scenePolygons),
    [scenePolygons],
  );
  const hasAtlasFootprint = atlasEstimate.atlasPolygons > 0;

  useEffect(() => {
    renderStartRef.current = performance.now();
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setMetrics(measureDom(viewportRef.current, performance.now() - renderStartRef.current));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [scenePolygons, sceneOptions, vanillaBuildMs]);

  const resetToPreset = useCallback((id: string) => {
    const next = PRESETS.find((preset) => preset.id === id);
    setPresetId(id);
    if (!next) return;
    setParserOptions((current) => ({
      ...current,
      ...parserDefaultsFor(next),
    }));
    setSceneOptions((current) => ({
      ...current,
      zoom: next.zoom ?? current.zoom,
      rotX: next.rotX ?? current.rotX,
      rotY: next.rotY ?? current.rotY,
    }));
  }, []);

  const budgetTone =
    metrics.polyCount > 2500
      ? "warn"
      : metrics.polyCount < 900
        ? "good"
        : undefined;

  return (
    <div className="dn-root">
      <aside className="dn-sidebar dn-sidebar--left">
        <header className="dn-brand">
          <a href="/">polycss</a>
          <span>/debug/meshes</span>
        </header>
        <nav className="dn-debug-nav" aria-label="Debug pages">
          {DEBUG_NAV.map((item) => (
            <a
              key={item.path}
              href={item.path}
              className={item.path === "/debug/meshes" ? "active" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <section className="dn-panel">
          <h2>Model</h2>
          <label className="dn-field">
            <span>Preset</span>
            <select
              value={presetId}
              onChange={(event) => {
                resetToPreset(event.currentTarget.value);
              }}
            >
              {PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.category} - {preset.label}
                </option>
              ))}
            </select>
          </label>
          <RangeControl
            label="Target"
            value={parserOptions.targetSize}
            min={10}
            max={120}
            step={1}
            onChange={(value) => updateParser({ targetSize: value })}
            format={(value) => value.toFixed(0)}
          />
          <RangeControl
            label="Shift"
            value={parserOptions.gridShift}
            min={0}
            max={8}
            step={0.25}
            onChange={(value) => updateParser({ gridShift: value })}
            format={(value) => value.toFixed(2)}
          />
          <label className="dn-field dn-field--color">
            <span>Fallback</span>
            <input
              type="color"
              value={parserOptions.defaultColor}
              onChange={(event) => updateParser({ defaultColor: event.currentTarget.value })}
            />
            <code>{parserOptions.defaultColor}</code>
          </label>
          {loading && <p className="dn-note">Loading model...</p>}
          {loadError && <p className="dn-note dn-note--error">{loadError}</p>}
        </section>

        <section className="dn-panel">
          <h2>Renderer</h2>
          <div className="dn-segment">
            <button
              type="button"
              className={sceneOptions.renderer === "react" ? "active" : ""}
              onClick={() => updateScene({ renderer: "react" })}
            >
              React
            </button>
            <button
              type="button"
              className={sceneOptions.renderer === "vanilla" ? "active" : ""}
              onClick={() => updateScene({ renderer: "vanilla" })}
            >
              Vanilla
            </button>
          </div>
          <div className="dn-field dn-field--segment">
            <span>Texture</span>
            <div className="dn-segment">
              {(["baked", "dynamic"] as TextureLightingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={sceneOptions.textureLighting === mode ? "active" : ""}
                  onClick={() => updateScene({ textureLighting: mode })}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <label className="dn-field">
            <span>Quality</span>
            <select
              value={sceneOptions.textureQuality}
              onChange={(event) => updateScene({ textureQuality: event.currentTarget.value as TextureQuality })}
            >
              <option value="auto">Auto</option>
              <option value="full">Full - 1x atlas</option>
              <option value="balanced">Balanced - 0.75x</option>
              <option value="draft">Draft - 0.25x</option>
            </select>
          </label>
          <Toggle label="Auto center" checked={sceneOptions.autoCenter} onChange={(value) => updateScene({ autoCenter: value })} />
          <Toggle label="Interactive" checked={sceneOptions.interactive} onChange={(value) => updateScene({ interactive: value })} />
          <Toggle label="Auto rotate" checked={sceneOptions.animate} onChange={(value) => updateScene({ animate: value })} />
          <Toggle label="Floor" checked={sceneOptions.showFloor} onChange={(value) => updateScene({ showFloor: value })} />
          <Toggle label="Backfaces" checked={sceneOptions.showBackfaces} onChange={(value) => updateScene({ showBackfaces: value })} />
          <Toggle label="Axes" checked={sceneOptions.showAxes} onChange={(value) => updateScene({ showAxes: value })} />
          <Toggle label="Light" checked={sceneOptions.showLight} onChange={(value) => updateScene({ showLight: value })} />
        </section>

        <section className="dn-panel">
          <h2>Camera</h2>
          <RangeControl label="Zoom" value={sceneOptions.zoom} min={0.05} max={2.5} step={0.01} onChange={(value) => updateScene({ zoom: value })} format={(value) => value.toFixed(2)} />
          <RangeControl label="Rot X" value={sceneOptions.rotX} min={0} max={100} step={1} onChange={(value) => updateScene({ rotX: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <RangeControl label="Rot Y" value={sceneOptions.rotY} min={0} max={360} step={1} onChange={(value) => updateScene({ rotY: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <label className="dn-field">
            <span>Perspective</span>
            <select
              value={sceneOptions.perspective === false ? "none" : String(sceneOptions.perspective)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateScene({ perspective: value === "none" ? false : Number(value) });
              }}
            >
              <option value="none">None</option>
              <option value="1000">1000px</option>
              <option value="2000">2000px</option>
              <option value="4000">4000px</option>
              <option value="8000">8000px</option>
            </select>
          </label>
        </section>
      </aside>

      <main className="dn-main">
        <div className="dn-toolbar">
          <div>
            <b>{loaded?.label ?? "No model"}</b>
            <span>
              {loaded ? `${loaded.kind.toUpperCase()} - ${formatNumber(loaded.sourcePolygons)} source polygons` : "Drop a model or pick a preset"}
            </span>
          </div>
          <div className="dn-toolbar__chips">
            <span>{sceneOptions.renderer}</span>
            <span>light {sceneOptions.textureLighting}</span>
            <span>quality {sceneOptions.textureQuality}</span>
          </div>
        </div>

        <div className="dn-viewport" ref={viewportRef}>
          {sceneOptions.renderer === "vanilla" ? (
            <VanillaScene
              polygons={scenePolygons}
              options={sceneOptions}
              directionalLight={directionalLight}
              ambientLight={ambientLight}
              showAxes={sceneOptions.showAxes}
              showLight={sceneOptions.showLight}
              helperScale={helperScale}
              helperTarget={helperTarget}
              onBuild={setVanillaBuildMs}
            />
          ) : (
            <PolyCamera
              interactive={sceneOptions.interactive}
              zoom={sceneOptions.zoom}
              rotX={sceneOptions.rotX}
              rotY={sceneOptions.rotY}
              perspective={sceneOptions.perspective}
              animate={sceneOptions.animate ? 0.35 : false}
            >
              <PolyScene
                polygons={scenePolygons}
                autoCenter={sceneOptions.autoCenter}
                directionalLight={directionalLight}
                ambientLight={ambientLight}
                textureLighting={sceneOptions.textureLighting}
                atlasScale={atlasScale}
                debugShowBackfaces={sceneOptions.showBackfaces}
              >
                {sceneOptions.showAxes && <PolyAxesHelper size={helperScale * 0.6} />}
                {sceneOptions.showLight && (
                  <PolyDirectionalLightHelper
                    light={directionalLight}
                    target={helperTarget}
                    distance={helperScale * 0.7}
                    size={helperScale * 0.05}
                  />
                )}
              </PolyScene>
            </PolyCamera>
          )}
        </div>
      </main>

      <aside className="dn-sidebar dn-sidebar--right">
        <section className="dn-panel">
          <h2>Performance</h2>
          <div className="dn-stats">
            <Stat label={sceneOptions.renderer === "vanilla" ? "Build" : "Render"} value={formatMs(sceneOptions.renderer === "vanilla" ? vanillaBuildMs : metrics.renderMs)} />
            <Stat label="DOM nodes" value={formatNumber(metrics.nodeCount)} tone={budgetTone} />
            <Stat label="Polys" value={formatNumber(metrics.polyCount)} tone={budgetTone} />
            {hasAtlasFootprint && (
              <>
                <Stat label="Atlas polys" value={formatNumber(atlasEstimate.atlasPolygons)} tone={atlasEstimate.atlasPolygons > 2500 ? "warn" : undefined} />
              </>
            )}
          </div>
        </section>

        <section className="dn-panel">
          <h2>Directional light</h2>
          <RangeControl label="Azimuth" value={sceneOptions.lightAzimuth} min={0} max={360} step={1} onChange={(value) => updateScene({ lightAzimuth: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <RangeControl label="Elev." value={sceneOptions.lightElevation} min={-90} max={90} step={1} onChange={(value) => updateScene({ lightElevation: value })} format={(value) => `${value.toFixed(0)} deg`} />
          <RangeControl label="Intensity" value={sceneOptions.lightIntensity} min={0} max={2} step={0.05} onChange={(value) => updateScene({ lightIntensity: value })} format={(value) => value.toFixed(2)} />
          <label className="dn-field dn-field--color">
            <span>Color</span>
            <input type="color" value={sceneOptions.lightColor} onChange={(event) => updateScene({ lightColor: event.currentTarget.value })} />
            <code>{sceneOptions.lightColor}</code>
          </label>
        </section>

        <section className="dn-panel">
          <h2>Ambient light</h2>
          <RangeControl label="Intensity" value={sceneOptions.ambientIntensity} min={0} max={2} step={0.05} onChange={(value) => updateScene({ ambientIntensity: value })} format={(value) => value.toFixed(2)} />
          <label className="dn-field dn-field--color">
            <span>Color</span>
            <input type="color" value={sceneOptions.ambientColor} onChange={(event) => updateScene({ ambientColor: event.currentTarget.value })} />
            <code>{sceneOptions.ambientColor}</code>
          </label>
        </section>

        <section className="dn-panel">
          <h2>Notes</h2>
          <ul className="dn-list">
            <li>React mode tests `@polycss/react` components.</li>
            <li>Vanilla mode tests the imperative `polycss` API.</li>
          </ul>
          {loaded?.warnings.length ? (
            <ul className="dn-list dn-list--warn">
              {loaded.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          ) : null}
        </section>
      </aside>
    </div>
  );
}
