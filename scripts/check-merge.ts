import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseMagicaVoxel } from "../src/utils/parseMagicaVoxel.ts";
import { sceneController } from "../src/controller/sceneController.ts";
import { buildPlaneShellMesh, buildPlaneShellMeshOverpaint } from "../src/core/domRenderer.ts";

type Axis = "x" | "y" | "z";
type Face = "t" | "b" | "bl" | "br" | "fl" | "fr";

type WallsMask = Record<Face, boolean>;

function parseArgs(argv: string[]): {
  file: string;
  rotX?: number;
  rotY?: number;
  projection?: "cubic" | "dimetric";
  showWalls?: boolean;
  showFloor?: boolean;
  includeHiddenFaces?: boolean;
} {
  const out: ReturnType<typeof parseArgs> = {
    file: "docs/scene_army.vox"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (!arg.startsWith("--")) {
      out.file = arg;
      continue;
    }

    const next = argv[i + 1];
    const readValue = () => {
      if (next === undefined || next.startsWith("--")) return undefined;
      i += 1;
      return next;
    };

    if (arg === "--rotX") {
      const value = readValue();
      if (value !== undefined) out.rotX = Number(value);
      continue;
    }
    if (arg === "--rotY") {
      const value = readValue();
      if (value !== undefined) out.rotY = Number(value);
      continue;
    }
    if (arg === "--projection") {
      const value = readValue();
      if (value === "cubic" || value === "dimetric") out.projection = value;
      continue;
    }
    if (arg === "--showWalls") {
      out.showWalls = true;
      continue;
    }
    if (arg === "--showFloor") {
      out.showFloor = true;
      continue;
    }
    if (arg === "--includeHiddenFaces") {
      out.includeHiddenFaces = true;
      continue;
    }
  }

  return out;
}

function countPlaneQuads(mesh: { planes: Array<{ axis: Axis; groups: Array<{ face: Face; rects: unknown[] }> }> }, walls?: WallsMask) {
  const hidden = walls ?? { t: false, b: false, bl: false, br: false, fl: false, fr: false };
  const axis: Record<Axis, number> = { x: 0, y: 0, z: 0 };
  const face: Record<Face, number> = { t: 0, b: 0, bl: 0, br: 0, fl: 0, fr: 0 };
  let total = 0;

  for (const plane of mesh.planes) {
    for (const group of plane.groups) {
      if (hidden[group.face]) continue;
      const count = group.rects.length;
      total += count;
      axis[plane.axis] += count;
      face[group.face] += count;
    }
  }

  return { total, axis, face };
}

function getLayerStats(mesh: {
  planes: Array<{ axis: Axis; plane: number; groups: Array<{ face: Face; rects: unknown[]; layer?: number }> }>;
}) {
  const rectsByLayer = new Map<number, number>();
  const groupsByLayer = new Map<number, number>();
  const maxLayerByPlaneFace = new Map<string, number>();

  for (const plane of mesh.planes) {
    for (const group of plane.groups) {
      const layer = group.layer ?? 0;
      rectsByLayer.set(layer, (rectsByLayer.get(layer) ?? 0) + group.rects.length);
      groupsByLayer.set(layer, (groupsByLayer.get(layer) ?? 0) + 1);

      const key = `${plane.axis}:${plane.plane}:${group.face}`;
      const currentMax = maxLayerByPlaneFace.get(key) ?? 0;
      if (layer > currentMax) maxLayerByPlaneFace.set(key, layer);
    }
  }

  const maxLayer = Math.max(0, ...Array.from(rectsByLayer.keys()));
  const planeFaceLayers: Record<number, number> = {};
  for (const value of maxLayerByPlaneFace.values()) {
    planeFaceLayers[value] = (planeFaceLayers[value] ?? 0) + 1;
  }

  return { rectsByLayer, groupsByLayer, maxLayer, planeFaceLayers };
}

function formatWalls(mask: WallsMask | undefined): string {
  if (!mask) return "(none)";
  const entries: Array<[Face, boolean]> = [
    ["t", mask.t],
    ["b", mask.b],
    ["bl", mask.bl],
    ["br", mask.br],
    ["fl", mask.fl],
    ["fr", mask.fr]
  ];
  return entries
    .map(([key, value]) => `${key}:${value ? "hide" : "show"}`)
    .join(" ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);
  const buffer = await readFile(filePath);
  const parsed = parseMagicaVoxel(buffer);

  const controller = sceneController({
    camera: {
      ...(Number.isFinite(args.rotX) ? { rotX: args.rotX } : {}),
      ...(Number.isFinite(args.rotY) ? { rotY: args.rotY } : {})
    }
  });

  const baseState = {
    voxels: parsed.voxels,
    rows: parsed.rows,
    cols: parsed.cols,
    depth: parsed.depth,
    projection: args.projection ?? "cubic",
    showWalls: !!args.showWalls,
    showFloor: !!args.showFloor
  } as const;

  const wallMaskSnapshot = controller.applySceneState({
    ...baseState,
    mergeVoxels: false
  });
  const walls = wallMaskSnapshot.context.walls as WallsMask | undefined;
  const includeHiddenFaces = !!args.includeHiddenFaces;
  const effectiveWalls = includeHiddenFaces
    ? ({ t: false, b: false, bl: false, br: false, fl: false, fr: false } as WallsMask)
    : walls;

  const snapshot = wallMaskSnapshot;
  const results = [
    { label: "shell-pure", mesh: buildPlaneShellMesh(snapshot) },
    {
      label: "shell-overpaint",
      mesh: buildPlaneShellMeshOverpaint(snapshot)
    },
    {
      label: "shell-overpaint-all-greedy",
      mesh: buildPlaneShellMeshOverpaint(snapshot, { overpaintStrategy: "greedy" })
    },
    {
      label: "shell-overpaint-all-target-cover",
      mesh: buildPlaneShellMeshOverpaint(snapshot, { overpaintStrategy: "target-cover" })
    }
  ].map((entry) => ({ label: entry.label, mesh: entry.mesh, quads: countPlaneQuads(entry.mesh, effectiveWalls) }));

  console.log(`file: ${args.file}`);
  console.log(`dims: rows=${parsed.rows} cols=${parsed.cols} depth=${parsed.depth}`);
  console.log(`walls: ${formatWalls(walls)}${includeHiddenFaces ? " (ignoring hidden faces)" : ""}`);

  for (const result of results) {
    const { total, axis, face } = result.quads;
    console.log(
      `${result.label}: ${total} quads (axis x:${axis.x} y:${axis.y} z:${axis.z}) (face t:${face.t} b:${face.b} bl:${face.bl} br:${face.br} fl:${face.fl} fr:${face.fr})`
    );
  }

  const overpaint = results.find((result) => result.label === "shell-overpaint");
  if (overpaint) {
    const layerStats = getLayerStats(overpaint.mesh);
    const layerKeys = Array.from(layerStats.rectsByLayer.keys()).sort((a, b) => a - b);
    console.log(
      `overpaint layers: maxLayer=${layerStats.maxLayer} (${layerKeys.map((layer) => `${layer}:${layerStats.rectsByLayer.get(layer)} rects`).join(", ")})`
    );
    const planeFaceKeys = Object.keys(layerStats.planeFaceLayers)
      .map((value) => Number(value))
      .sort((a, b) => a - b);
    console.log(
      `overpaint per plane-face max layer: ${planeFaceKeys.map((layer) => `${layer}:${layerStats.planeFaceLayers[layer]}`).join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
