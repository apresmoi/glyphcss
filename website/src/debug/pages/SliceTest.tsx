import { useEffect, useMemo, useRef, useState } from "react";
import type { Polygon } from "@polycss/react";
import {
  DebugLayout, DebugSection, DebugStats,
  Pills, Row,
} from "..";

// Voxel test fixtures — each face direction emits its own distinct color
// so any orientation/mirror bug after slice rasterization shows up.
//
// Color → expected face direction (when slice is OFF this is the ground truth):
//   red    +Z (top)         orange -Z (bottom)
//   blue   +X (right)       green  -X (left)
//   purple +Y (back)        yellow -Y (front)

const COLORS = {
  pZ: "#ff5555", nZ: "#ffaa00",
  pX: "#44aaff", nX: "#44dd44",
  pY: "#aa55ff", nY: "#ffdd00",
};

interface VoxelCell { x: number; y: number; z: number; }

/** Per-cell face emit with face-culling against `occupied`. Each face gets
 *  its direction-specific color so we can spot orientation bugs in slice. */
function cellsToPolygons(cells: VoxelCell[]): Polygon[] {
  const occupied = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`));
  const has = (x: number, y: number, z: number) => occupied.has(`${x},${y},${z}`);
  const polys: Polygon[] = [];
  for (const { x, y, z } of cells) {
    const x2 = x + 1, y2 = y + 1, z2 = z + 1;
    if (!has(x + 1, y, z))
      polys.push({ vertices: [[x2, y, z], [x2, y2, z], [x2, y2, z2], [x2, y, z2]], color: COLORS.pX });
    if (!has(x - 1, y, z))
      polys.push({ vertices: [[x, y2, z], [x, y, z], [x, y, z2], [x, y2, z2]], color: COLORS.nX });
    if (!has(x, y + 1, z))
      polys.push({ vertices: [[x, y2, z], [x, y2, z2], [x2, y2, z2], [x2, y2, z]], color: COLORS.pY });
    if (!has(x, y - 1, z))
      polys.push({ vertices: [[x2, y, z], [x2, y, z2], [x, y, z2], [x, y, z]], color: COLORS.nY });
    if (!has(x, y, z + 1))
      polys.push({ vertices: [[x, y, z2], [x2, y, z2], [x2, y2, z2], [x, y2, z2]], color: COLORS.pZ });
    if (!has(x, y, z - 1))
      polys.push({ vertices: [[x, y2, z], [x2, y2, z], [x2, y, z], [x, y, z]], color: COLORS.nZ });
  }
  return polys;
}

// ── Fixtures ────────────────────────────────────────────────────────────
// Each fixture is asymmetric so any axis-flip/mirror in slice mode is
// visually obvious (a symmetric shape can hide the bug).

function fxStaircase(): VoxelCell[] {
  // 3 steps in +X direction. From the side: |‾|_|‾|_|‾| (rising).
  // From above: ☐ at the lowest+nearest corner, growing higher going away.
  const out: VoxelCell[] = [];
  for (let s = 0; s < 3; s++) {
    for (let y = 0; y < 2; y++) {
      for (let z = 0; z <= s; z++) out.push({ x: s, y, z });
    }
  }
  return out;
}

function fxLShape(): VoxelCell[] {
  // 3x3 base + a 1x1x3 tower at the +X+Y corner. Tells us:
  //   - tower is in correct corner (not flipped to -X-Y)
  //   - tower's +X side and +Y side each show the right color
  const out: VoxelCell[] = [];
  for (let x = 0; x < 3; x++)
    for (let y = 0; y < 3; y++)
      out.push({ x, y, z: 0 });
  for (let z = 1; z <= 3; z++) out.push({ x: 2, y: 2, z });
  return out;
}

function fxArrow(): VoxelCell[] {
  // Arrow pointing in +X direction at z=0. Asymmetric on every axis.
  // shaft (4×1) + head (3×3 triangle made of 5 cells)
  const out: VoxelCell[] = [];
  // shaft
  for (let x = 0; x < 4; x++) out.push({ x, y: 1, z: 0 });
  // arrowhead
  out.push({ x: 4, y: 0, z: 0 });
  out.push({ x: 4, y: 1, z: 0 });
  out.push({ x: 4, y: 2, z: 0 });
  out.push({ x: 5, y: 1, z: 0 });
  return out;
}

function fxHouse(): VoxelCell[] {
  // 4×4 ground floor (z=0..1) + 4×4 walls hollow (z=1..3) + door notch.
  // Asymmetric in Z (door at front, -Y side).
  const out: VoxelCell[] = [];
  // solid floor
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 4; y++)
      out.push({ x, y, z: 0 });
  // walls
  for (let z = 1; z < 3; z++) {
    for (let x = 0; x < 4; x++) {
      out.push({ x, y: 0, z });   // front wall (-Y)
      out.push({ x, y: 3, z });   // back wall (+Y)
    }
    for (let y = 1; y < 3; y++) {
      out.push({ x: 0, y, z });   // left wall (-X)
      out.push({ x: 3, y, z });   // right wall (+X)
    }
  }
  // door notch: remove front wall at x=1 (cuts a 1×1 hole)
  return out.filter((c) => !(c.y === 0 && c.x === 1 && c.z === 1));
}

const FIXTURES = {
  staircase: { label: "Staircase (rises in +X)", build: fxStaircase },
  lshape:    { label: "L-shape (tower at +X+Y)", build: fxLShape },
  arrow:     { label: "Arrow (points +X)",       build: fxArrow },
  house:     { label: "House (door at -Y)",      build: fxHouse },
} as const;
type FixtureId = keyof typeof FIXTURES;

type MergeMode = "off" | "auto" | "slice";

export default function SliceTest() {
  const [fixture, setFixture] = useState<FixtureId>("lshape");
  const [merge, setMerge] = useState<MergeMode>("off");

  const polygons = useMemo(() => cellsToPolygons(FIXTURES[fixture].build()), [fixture]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{ destroy: () => void } | null>(null);

  // Mount via vanilla createPolyScene (the only path with `merge: "slice"`
  // wired today). Re-mounts when fixture or merge mode changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    sceneRef.current?.destroy();
    sceneRef.current = null;

    (async () => {
      const polycss = await import("polycss");
      if (cancelled) return;
      const s = polycss.createPolyScene(host, {
        rotX: 65,
        rotY: 45,
        zoom: 0.5,
        autoCenter: true,
        interactive: true,
        perspective: 8000,
        merge,
      });
      s.add({ polygons, dispose: () => {} });
      sceneRef.current = s;
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [polygons, merge]);

  return (
    <DebugLayout current="/debug/slice-test">
      <DebugSection title="Fixture">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Pills<FixtureId>
            value={fixture}
            onChange={setFixture}
            options={(Object.entries(FIXTURES) as [FixtureId, typeof FIXTURES[FixtureId]][])
              .map(([id, f]) => ({ value: id, label: f.label }))}
          />
        </div>
      </DebugSection>

      <DebugSection title="Merge mode">
        <Row label="merge">
          <Pills<MergeMode>
            value={merge}
            onChange={setMerge}
            options={[
              { value: "off",   label: "off (truth)" },
              { value: "auto",  label: "auto" },
              { value: "slice", label: "slice" },
            ]}
          />
        </Row>
        <div className="debug-help" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
          Toggle <code>off</code> ↔ <code>slice</code> rapidly. Anything that
          changes color, position, or orientation is a slice bug — report
          which face direction (top/bottom/+X/-X/+Y/-Y).
        </div>
      </DebugSection>

      <DebugSection title="Color → direction">
        <div style={{ fontSize: 11, lineHeight: 1.7 }}>
          <div><span style={{ color: COLORS.pZ }}>■</span> red — <strong>+Z top</strong></div>
          <div><span style={{ color: COLORS.nZ }}>■</span> orange — <strong>-Z bottom</strong></div>
          <div><span style={{ color: COLORS.pX }}>■</span> blue — <strong>+X right</strong></div>
          <div><span style={{ color: COLORS.nX }}>■</span> green — <strong>-X left</strong></div>
          <div><span style={{ color: COLORS.pY }}>■</span> purple — <strong>+Y back</strong></div>
          <div><span style={{ color: COLORS.nY }}>■</span> yellow — <strong>-Y front</strong></div>
          <hr style={{ border: 0, borderTop: "1px solid rgba(255,255,255,0.08)", margin: "8px 0" }} />
          <div style={{ color: "#94a3b8" }}>
            From iso (rotX=65, rotY=45) you start by seeing red, blue, yellow.
            Drag-rotate to inspect other directions.
          </div>
        </div>
      </DebugSection>

      <DebugStats voxelCount={polygons.length} extra={{ fixture, merge }} />

      <div ref={hostRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }} />
    </DebugLayout>
  );
}
