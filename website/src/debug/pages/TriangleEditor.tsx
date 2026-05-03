import { useMemo, useState } from "react";
import type { Voxel } from "@layoutit/voxcss/react";
import {
  DebugLayout, DebugSection, DebugStats, DebugScene,
  useOrigin,
  PLATONIC_PALETTE as PALETTE, triangleToVoxel,
  genTetrahedron, genCube, genOctahedron,
  genIcosahedron, genDodecahedron, genCuboctahedron,
} from "..";
import type { Vec3, RawTriangle } from "..";

interface TriangleDef {
  id: string;
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  color: string;
}

let nextId = 1;
const newId = () => `t${nextId++}`;

const toVoxel = (t: TriangleDef): Voxel =>
  triangleToVoxel({ v0: t.v0, v1: t.v1, v2: t.v2, color: t.color }, 1);

const wrapWithIds = (raws: RawTriangle[]): TriangleDef[] =>
  raws.map((r) => ({ id: newId(), ...r }));

// Six irregular triangles, each tucked into its own ~5×5 zone of the floor
// so their bboxes don't overlap. Tilted in z to keep the 3D feel. Makes it
// obvious that voxcss accepts ANY triangle without the demo turning into
// visual mush.
const startingTriangles: TriangleDef[] = [
  { id: newId(), v0: [0,  0, 0], v1: [4,  1, 2], v2: [1,  4, 3], color: PALETTE[0] },
  { id: newId(), v0: [6,  0, 1], v1: [10, 2, 0], v2: [7,  4, 4], color: PALETTE[1] },
  { id: newId(), v0: [12, 1, 3], v1: [16, 0, 0], v2: [13, 4, 5], color: PALETTE[2] },
  { id: newId(), v0: [1,  6, 2], v1: [4,  7, 5], v2: [0, 10, 0], color: PALETTE[3] },
  { id: newId(), v0: [7,  6, 4], v1: [10, 9, 1], v2: [6, 10, 6], color: PALETTE[4] },
  { id: newId(), v0: [13, 6, 0], v1: [16, 8, 3], v2: [12, 10, 5], color: PALETTE[5] },
];

const PRESETS: { label: string; gen: () => RawTriangle[] }[] = [
  { label: "Tet", gen: genTetrahedron },
  { label: "Cube", gen: genCube },
  { label: "Oct", gen: genOctahedron },
  { label: "Icos", gen: genIcosahedron },
  { label: "Dodec", gen: genDodecahedron },
  { label: "Cuboct", gen: genCuboctahedron },
];

export default function TriangleEditor() {
  const [triangles, setTriangles] = useState<TriangleDef[]>(startingTriangles);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const voxels = useMemo(() => triangles.map(toVoxel), [triangles]);
  const origin = useOrigin(voxels);

  const updateVertex = (id: string, vi: 0 | 1 | 2, axis: 0 | 1 | 2, value: number) => {
    setTriangles((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t };
      const v: Vec3 = [...next[`v${vi}` as "v0" | "v1" | "v2"]];
      v[axis] = value;
      next[`v${vi}` as "v0" | "v1" | "v2"] = v;
      return next;
    }));
  };
  const updateColor = (id: string, color: string) =>
    setTriangles((prev) => prev.map((t) => t.id === id ? { ...t, color } : t));
  const removeTriangle = (id: string) =>
    setTriangles((prev) => prev.filter((t) => t.id !== id));
  const duplicateTriangle = (id: string) =>
    setTriangles((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx + 1), { ...prev[idx], id: newId() }, ...prev.slice(idx + 1)];
    });
  // Swapping v1 and v2 reverses the winding, which flips the cross product —
  // the front face becomes the back face. Useful when a triangle is invisible
  // from outside the solid because it was wound CW instead of CCW.
  const invertTriangle = (id: string) =>
    setTriangles((prev) => prev.map((t) =>
      t.id === id ? { ...t, v1: t.v2, v2: t.v1 } : t
    ));
  const addTriangle = () => {
    const last = triangles[triangles.length - 1]?.color;
    const lastIdx = last ? PALETTE.indexOf(last) : -1;
    const color = PALETTE[(lastIdx + 1 + PALETTE.length) % PALETTE.length];
    setTriangles((prev) => [...prev, { id: newId(), v0: [0, 0, 0], v1: [4, 0, 0], v2: [0, 4, 0], color }]);
  };
  const copyAll = async () => {
    // The truth is the actual voxcss Voxel[] — what the renderer eats.
    // Anything else (the editor's TriangleDef format) is just a UI convenience.
    const text = JSON.stringify(voxels, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`Copied ${voxels.length} voxels`);
    } catch {
      setCopyStatus("Copy failed");
    }
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  return (
    <DebugLayout current="/debug/triangle-editor">
      <DebugSection title="Triangles">
        <button className="debug-btn" onClick={addTriangle} style={{ width: "100%" }}>+ Add triangle</button>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="debug-btn" onClick={copyAll} style={{ flex: 1 }} title="Copy the rendered voxcss Voxel[] as JSON">
            📋 Copy JSON
          </button>
          <button className="debug-btn" onClick={() => setTriangles([])} style={{ flex: 1 }}>Clear</button>
        </div>
        {copyStatus && (
          <div style={{ fontSize: 11, color: "#86efac", fontFamily: "monospace" }}>{copyStatus}</div>
        )}
        <div style={{ fontSize: 11, opacity: 0.6 }}>Replace with a preset:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="debug-btn"
              onClick={() => setTriangles(wrapWithIds(p.gen()))}
              title={`Replace with a ${p.label.toLowerCase()}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </DebugSection>

      <DebugSection title={`List (${triangles.length})`}>
        {triangles.map((t, i) => (
          <div key={t.id} style={{
            paddingBottom: 8,
            marginBottom: 8,
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="color"
                  value={t.color}
                  onChange={(e) => updateColor(t.id, e.target.value)}
                  className="debug-color-swatch"
                  title="Click to change color"
                />
                <strong style={{ fontSize: 12 }}>#{i + 1}</strong>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button className="debug-btn" style={{ padding: "2px 6px" }} onClick={() => invertTriangle(t.id)} title="Flip winding (swap front/back face)">⇄</button>
                <button className="debug-btn" style={{ padding: "2px 6px" }} onClick={() => duplicateTriangle(t.id)} title="Duplicate">⎘</button>
                <button className="debug-btn" style={{ padding: "2px 6px" }} onClick={() => removeTriangle(t.id)} title="Delete">×</button>
              </div>
            </div>
            <VertexRow label="v0" v={t.v0} onChange={(axis, val) => updateVertex(t.id, 0, axis, val)} />
            <VertexRow label="v1" v={t.v1} onChange={(axis, val) => updateVertex(t.id, 1, axis, val)} />
            <VertexRow label="v2" v={t.v2} onChange={(axis, val) => updateVertex(t.id, 2, axis, val)} />
          </div>
        ))}
      </DebugSection>

      <DebugStats voxelCount={voxels.length} extra={{ triangles: triangles.length }} />
      <DebugScene voxels={voxels} origin={origin} defaultShowFloor />
    </DebugLayout>
  );
}

function VertexRow({ label, v, onChange }: { label: string; v: Vec3; onChange: (axis: 0 | 1 | 2, val: number) => void }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4, fontSize: 11, fontFamily: "monospace" }}>
      <span style={{ minWidth: 18, opacity: 0.6 }}>{label}</span>
      {(["x", "y", "z"] as const).map((name, axisIdx) => (
        <span key={name} style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ opacity: 0.5 }}>{name}</span>
          <input
            type="number"
            step={1}
            value={v[axisIdx]}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (Number.isFinite(n)) onChange(axisIdx as 0 | 1 | 2, n);
            }}
            style={{
              width: "100%", minWidth: 0,
              background: "rgba(255,255,255,0.06)", color: "white",
              border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3,
              padding: "2px 4px", fontFamily: "monospace", fontSize: 11,
            }}
          />
        </span>
      ))}
    </div>
  );
}
