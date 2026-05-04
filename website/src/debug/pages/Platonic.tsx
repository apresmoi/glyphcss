import { useMemo, useState } from "react";
import {
  DebugLayout, DebugSection, DebugStats, DebugScene,
  Pills, Row, useOrigin,
  SHAPE_GENERATORS, POLYGON_GENERATORS,
  triangleToVoxel, polygonToVoxel,
} from "..";
import type { ShapeName } from "..";

const SOLIDS: ShapeName[] = [
  "tetrahedron", "cube", "octahedron",
  "dodecahedron", "icosahedron", "cuboctahedron",
];

// Solids whose face count actually drops in polygon mode (i.e., they have
// non-triangle faces). For tet/oct/icos polygon mode is a no-op.
const HAS_POLYGON_FACES: Record<ShapeName, boolean> = {
  tetrahedron: false,
  cube: true,
  octahedron: false,
  icosahedron: false,
  dodecahedron: true,
  cuboctahedron: true,
};

type Mode = "triangles" | "polygons";

export default function Platonic() {
  const [solid, setSolid] = useState<ShapeName>("tetrahedron");
  const [mode, setMode] = useState<Mode>("triangles");

  const voxels = useMemo(() => {
    if (mode === "polygons") {
      return POLYGON_GENERATORS[solid]().map(polygonToVoxel);
    }
    return SHAPE_GENERATORS[solid]().map(triangleToVoxel);
  }, [solid, mode]);
  const origin = useOrigin(voxels);

  const triCount = useMemo(() => SHAPE_GENERATORS[solid]().length, [solid]);
  const polyCount = useMemo(() => POLYGON_GENERATORS[solid]().length, [solid]);
  const reduction = triCount === 0 ? 0 : Math.round((1 - polyCount / triCount) * 100);

  return (
    <DebugLayout current="/debug/platonic">
      <DebugSection title="Solid">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          <Pills value={solid} onChange={setSolid} options={SOLIDS} />
        </div>
      </DebugSection>

      <DebugSection title="Render">
        <Row label="As">
          <Pills<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "triangles", label: "triangles" },
              { value: "polygons", label: "polygons" },
            ]}
          />
        </Row>
        <div className="debug-help">
          {HAS_POLYGON_FACES[solid] ? (
            <>
              <div className="debug-help__title">{triCount} → {polyCount} faces ({reduction}% fewer)</div>
              <div>
                {solid === "cube" && "Each square face is a single 4-vertex polygon instead of 2 fan-triangulated triangles."}
                {solid === "dodecahedron" && "Each pentagon is a single 5-vertex polygon instead of 3 fan-triangulated triangles."}
                {solid === "cuboctahedron" && "6 squares + 8 triangles, each a single polygon — no fan triangulation on the squares."}
              </div>
            </>
          ) : (
            "All faces are already triangles, so polygon mode is a no-op for this solid (same DOM count, same render)."
          )}
        </div>
      </DebugSection>

      <DebugStats voxelCount={voxels.length} extra={{ solid, mode }} />
      <DebugScene voxels={voxels} origin={origin} defaultZoom={0.7} />
    </DebugLayout>
  );
}
