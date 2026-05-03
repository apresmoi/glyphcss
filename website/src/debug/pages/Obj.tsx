import { useMemo, useState } from "react";
import type { ObjParseOptions } from "@layoutit/voxcss";
import {
  DebugLayout, DebugSection, DebugStats, DebugScene,
  ModelPicker, useDecimation, useObjModel, useOrigin,
} from "..";

interface ModelDef {
  id: string;
  label: string;
  /** Bucket in the gallery-style picker. */
  category: string;
  url: string;
  options: ObjParseOptions;
  /** Initial camera framing — DebugScene state takes over after mount. */
  zoom: number;
  rotX: number;
  rotY: number;
}

/**
 * All OBJ debug models in one place. Each entry sets a sensible default
 * camera framing + parseObj options (target size, palette, default color).
 * Adding a new model = drop the .obj into public/gallery/obj/ and append
 * an entry here.
 */
const MODELS: ModelDef[] = [
  {
    id: "chicken",
    label: "Chicken",
    category: "Characters",
    url: "/gallery/obj/chicken.obj",
    options: { targetSize: 60, defaultColor: "#cccccc" },
    zoom: 0.15, rotX: 74.4, rotY: 301.6,
  },
  {
    id: "saucer",
    label: "Flying saucer",
    category: "Vehicles",
    url: "/gallery/obj/saucer.obj",
    options: { targetSize: 60, defaultColor: "#94a3b8" },
    zoom: 0.2, rotX: 67.0, rotY: 42.3,
  },
  {
    id: "wheelbarrow",
    label: "Wheelbarrow",
    category: "Objects",
    url: "/gallery/obj/wheelbarrow.obj",
    options: { targetSize: 60, palette: ["#b45309", "#374151", "#7c2d12"] },
    zoom: 0.2, rotX: 66.2, rotY: 36.1,
  },
  {
    id: "teapot",
    label: "Teapot",
    category: "Objects",
    url: "/gallery/obj/teapot.obj",
    options: { targetSize: 60, defaultColor: "#a3a3a3" },
    zoom: 0.2, rotX: 65, rotY: 45,
  },
  {
    id: "castle",
    label: "Castle",
    category: "Architecture",
    url: "/gallery/obj/castle.obj",
    // Castle's material names are already hex codes (e.g. "78909C") — parseObj
    // auto-detects this and uses them directly, no palette override needed.
    options: { targetSize: 60 },
    zoom: 0.15, rotX: 66.9, rotY: 68.5,
  },
  {
    id: "coliseum",
    label: "Coliseum",
    category: "Architecture",
    url: "/gallery/obj/coliseum.obj",
    options: { targetSize: 80, palette: ["#c9a876", "#a78760", "#8b6f47", "#6b5538"] },
    zoom: 0.15, rotX: 65, rotY: 45,
  },
];

const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export default function Obj() {
  const [modelId, setModelId] = useState("chicken");
  const model = MODEL_BY_ID[modelId] ?? MODELS[0];

  const { voxels: rawVoxels, loading, error } = useObjModel(model.url, model.options);
  const { voxels, method, reduction, panel } = useDecimation(rawVoxels);
  const origin = useOrigin(voxels);

  const pickerItems = useMemo(
    () => MODELS.map((m) => ({ id: m.id, label: m.label, category: m.category })),
    []
  );

  return (
    <DebugLayout current="/debug/obj">
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
            Loaded from <code>{model.url}</code> · {rawVoxels.length.toLocaleString()} triangles.
          </div>
        )}
      </DebugSection>

      {panel}

      <DebugStats
        voxelCount={voxels.length}
        extra={{
          model: model.label,
          method,
          source: rawVoxels.length.toLocaleString(),
          reduction: `${reduction}%`,
        }}
      />
      {/* `key` re-mounts DebugScene when switching models so its zoom / rot
          state resets to the new model's defaults instead of carrying over. */}
      <DebugScene
        key={model.id}
        voxels={voxels}
        origin={origin}
        defaultZoom={model.zoom}
        defaultRotX={model.rotX}
        defaultRotY={model.rotY}
      />
    </DebugLayout>
  );
}
