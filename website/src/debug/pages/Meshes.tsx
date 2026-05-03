import { useMemo, useState } from "react";
import type { GltfParseOptions, ObjParseOptions } from "@layoutit/voxcss";
import {
  DebugLayout, DebugSection, DebugStats, DebugScene,
  ModelPicker, useDecimation, useObjModel, useOrigin,
} from "..";

interface BaseModelDef {
  id: string;
  label: string;
  /** Bucket in the gallery-style picker. */
  category: string;
  /** Initial camera framing — DebugScene state takes over after mount. */
  zoom: number;
  rotX: number;
  rotY: number;
}

interface ObjModelDef extends BaseModelDef {
  format: "obj";
  url: string;
  /** Optional companion .mtl URL — parseMtl runs on it, colors merged in. */
  mtlUrl?: string;
  options?: ObjParseOptions;
}

interface GltfModelDef extends BaseModelDef {
  format: "glb";
  url: string;
  options?: GltfParseOptions;
}

type ModelDef = ObjModelDef | GltfModelDef;

/**
 * All mesh-import debug models in one place. Each entry sets a sensible
 * default camera framing + parser options. Add a new model = drop the file
 * into public/gallery/obj/ or public/gallery/glb/ and append an entry here.
 */
const MODELS: ModelDef[] = [
  {
    id: "chicken",
    label: "Chicken",
    category: "Characters",
    format: "obj",
    url: "/gallery/obj/chicken.obj",
    // The .mtl ships proper Kd colors. parseMtl reads them and parseObj
    // uses them via materialColors — overrides the hex-name auto-detection.
    mtlUrl: "/gallery/obj/chicken.mtl",
    options: { targetSize: 60, defaultColor: "#cccccc" },
    zoom: 0.15, rotX: 74.4, rotY: 301.6,
  },
  {
    id: "rock1",
    label: "Rock (UV-mapped)",
    category: "Environment",
    format: "obj",
    url: "/gallery/obj/rock1.obj",
    // .mtl ships `map_Kd rock1-surface.jpg` — parseMtl picks it up,
    // useObjModel resolves the path against the .mtl URL, parseObj attaches
    // `texture` and `uvs` per triangle. Triangle.tsx detects uvs + texture
    // and renders via the UV-mapped <image> + <clipPath> path.
    mtlUrl: "/gallery/obj/rock1.mtl",
    options: { targetSize: 40, defaultColor: "#8b6f47" },
    zoom: 0.6, rotX: 65, rotY: 45,
  },
  {
    id: "tree",
    label: "Tree",
    category: "Environment",
    format: "glb",
    url: "/gallery/glb/tree.glb",
    // FBX2glTF preserved the source's Z-up convention instead of converting
    // to the glTF-standard Y-up, so we tell parseGltf to skip the Y/Z swap.
    // Node transforms are applied during parse, so world-space coords follow
    // glTF's spec (+Y up). Default upAxis: "y" is correct now.
    options: { targetSize: 60 },
    zoom: 0.3, rotX: 65, rotY: 45,
  },
  {
    id: "saucer",
    label: "Flying saucer",
    category: "Vehicles",
    format: "obj",
    url: "/gallery/obj/saucer.obj",
    options: { targetSize: 60, defaultColor: "#94a3b8" },
    zoom: 0.2, rotX: 67.0, rotY: 42.3,
  },
  {
    id: "wheelbarrow",
    label: "Wheelbarrow",
    category: "Objects",
    format: "obj",
    url: "/gallery/obj/wheelbarrow.obj",
    mtlUrl: "/gallery/obj/wheelbarrow.mtl",
    options: { targetSize: 60 },
    zoom: 0.2, rotX: 66.2, rotY: 36.1,
  },
  {
    id: "teapot",
    label: "Teapot",
    category: "Objects",
    format: "obj",
    url: "/gallery/obj/teapot.obj",
    options: { targetSize: 60, defaultColor: "#a3a3a3" },
    zoom: 0.2, rotX: 65, rotY: 45,
  },
  {
    id: "castle",
    label: "Castle",
    category: "Architecture",
    format: "obj",
    url: "/gallery/obj/castle.obj",
    options: { targetSize: 60 },
    zoom: 0.15, rotX: 66.9, rotY: 68.5,
  },
  {
    id: "coliseum",
    label: "Coliseum",
    category: "Architecture",
    format: "obj",
    url: "/gallery/obj/coliseum.obj",
    options: { targetSize: 80, palette: ["#c9a876", "#a78760", "#8b6f47", "#6b5538"] },
    zoom: 0.15, rotX: 65, rotY: 45,
  },
];

const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

function loadOptionsFor(model: ModelDef) {
  if (model.format === "obj") {
    return { format: "obj" as const, url: model.url, mtlUrl: model.mtlUrl, options: model.options };
  }
  return { format: "glb" as const, url: model.url, options: model.options };
}

export default function Meshes() {
  const [modelId, setModelId] = useState("chicken");
  const model = MODEL_BY_ID[modelId] ?? MODELS[0];

  const { voxels: rawVoxels, loading, error } = useObjModel(loadOptionsFor(model));
  const { voxels, method, reduction, panel } = useDecimation(rawVoxels);
  const origin = useOrigin(voxels);

  const pickerItems = useMemo(
    () => MODELS.map((m) => ({ id: m.id, label: m.label, category: m.category })),
    []
  );

  return (
    <DebugLayout current="/debug/meshes">
      <DebugSection title="Model">
        <ModelPicker
          items={pickerItems}
          value={modelId}
          onChange={setModelId}
          searchPlaceholder="Search models"
        />
        {loading && <div className="debug-help">Loading <code>{model.url}</code>…</div>}
        {error && <div className="debug-help" style={{ color: "#fca5a5" }}>{error}</div>}
        {!loading && !error && (
          <div className="debug-help">
            Loaded {model.format.toUpperCase()} from <code>{model.url}</code>
            {" · "}{rawVoxels.length.toLocaleString()} triangles.
          </div>
        )}
      </DebugSection>

      {panel}

      <DebugStats
        voxelCount={voxels.length}
        extra={{
          model: model.label,
          format: model.format,
          method,
          source: rawVoxels.length.toLocaleString(),
          reduction: `${reduction}%`,
        }}
      />
      <DebugScene
        key={model.id}
        voxels={voxels}
        origin={origin}
        defaultShowFloor
        defaultZoom={model.zoom}
        defaultRotX={model.rotX}
        defaultRotY={model.rotY}
      />
    </DebugLayout>
  );
}
