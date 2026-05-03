import { useMemo, useState } from "react";
import type { Voxel } from "@layoutit/voxcss/react";
import {
  DebugLayout, DebugSection, DebugStats, DebugScene,
  Row, Pills, useOrigin,
} from "..";

/**
 * Demonstrates multi-cell-spanning voxels (x2 / y2 / z2) for each shape
 * type that supports them, plus how the merge-voxels pills affect rendering.
 *
 *  - cube: span on any axis → flat slabs, walls, columns.
 *  - ramp: span on z → wider slope; rot picks which side faces up.
 *  - wedge: corner ramp, spans z by default.
 *  - spike: corner pyramid, spans z.
 */
// All voxels start at x=1, y=1 (not 0) — CSS Grid line "0" is invalid per
// spec; voxels at gridArea "0/0/..." get auto-placed and end up overlapping
// each other instead of where you put them. Voxcss avoids this everywhere
// with a 1-cell PAD on the scene; for hand-crafted scenes like this we
// shift the coords ourselves.
const VOXELS: Voxel[] = [
  // Row of 1×1 cubes (no span) — baseline reference.
  { x: 1, y: 1, z: 0, color: "#3b82f6" },
  { x: 1, y: 2, z: 0, color: "#3b82f6" },
  { x: 1, y: 3, z: 0, color: "#3b82f6" },

  // Multi-cell cube: a 4-wide / 1-deep / 1-tall slab.
  { x: 1, y: 5, z: 0, x2: 2, y2: 9, z2: 1, color: "#22c55e" },

  // Tall column: 1×1 footprint, 4 cells high.
  { x: 3, y: 1, z: 0, x2: 4, y2: 2, z2: 4, color: "#f97316" },

  // Big cube: 3×3×3.
  { x: 5, y: 5, z: 0, x2: 8, y2: 8, z2: 3, color: "#a855f7" },

  // Ramp spanning 3 cells on its axis (rot=0 → +Y slope), z-span 2.
  { x: 5, y: 1, z: 0, x2: 8, y2: 4, z2: 2, shape: "ramp", rot: 0, color: "#eab308" },

  // Wedge: 2-cell square base, 2 cells tall.
  { x: 9, y: 1, z: 0, x2: 11, y2: 3, z2: 2, shape: "wedge", rot: 90, color: "#ef4444" },

  // Spike: 2-cell square base, 2 cells tall — pyramid.
  { x: 9, y: 5, z: 0, x2: 11, y2: 7, z2: 2, shape: "spike", rot: 0, color: "#06b6d4" },

  // A wider/lower ramp on the other side, rot=180 → -Y slope.
  { x: 9, y: 9, z: 0, x2: 12, y2: 12, z2: 1, shape: "ramp", rot: 180, color: "#ec4899" },

  // ── Adjacent ramps — toggle 2d merge to watch them consolidate ──────
  // Ramps merge in 2d mode when they share rotation + color. Y-ramps
  // (rot 0/180) merge across X; X-ramps (rot 90/270) merge across Y.
  { x: 1, y: 11, z: 0, x2: 2, y2: 14, z2: 1, shape: "ramp", rot: 0, color: "#7c3aed" },
  { x: 2, y: 11, z: 0, x2: 3, y2: 14, z2: 1, shape: "ramp", rot: 0, color: "#7c3aed" },
  { x: 3, y: 11, z: 0, x2: 4, y2: 14, z2: 1, shape: "ramp", rot: 0, color: "#7c3aed" },

  // ── Pyramid from 4 spikes ────────────────────────────────────────────
  // Each spike is a corner pyramid; placing 4 around a 2×2 footprint with
  // the right rotations puts all four apexes at the shared center corner,
  // forming a proper square pyramid.
  //   apex-by-rot:  0 → (x2, y, z2)   90 → (x, y, z2)
  //                180 → (x, y2, z2) 270 → (x2, y2, z2)
  // For a pyramid centered at (15, 3, z2):
  //   (13,1)-(15,3) rot=270 → apex (15, 3, z2) ✓
  //   (15,1)-(17,3) rot=180 → apex (15, 3, z2) ✓
  //   (13,3)-(15,5) rot=0   → apex (15, 3, z2) ✓
  //   (15,3)-(17,5) rot=90  → apex (15, 3, z2) ✓
  { x: 13, y: 1, z: 0, x2: 15, y2: 3, z2: 5, shape: "spike", rot: 270, color: "#dc2626" },
  { x: 15, y: 1, z: 0, x2: 17, y2: 3, z2: 5, shape: "spike", rot: 180, color: "#dc2626" },
  { x: 13, y: 3, z: 0, x2: 15, y2: 5, z2: 5, shape: "spike", rot: 0,   color: "#dc2626" },
  { x: 15, y: 3, z: 0, x2: 17, y2: 5, z2: 5, shape: "spike", rot: 90,  color: "#dc2626" },
];

type Merge = false | "2d" | "3d";

export default function Spans() {
  const [merge, setMerge] = useState<Merge>(false);
  const voxels = useMemo(() => VOXELS, []);
  const origin = useOrigin(voxels);

  return (
    <DebugLayout current="/debug/spans">
      <DebugSection title="Spans">
        <div className="debug-help">
          A handful of voxels that demonstrate <code>x2 / y2 / z2</code>:
          multi-cell cubes, slabs, columns, plus shape voxels (ramp, wedge,
          spike) that span multiple cells on z and/or their footprint.
        </div>
        <Row label="Merge">
          <Pills<Merge>
            value={merge}
            onChange={setMerge}
            options={[
              { value: false, label: "off" },
              { value: "2d", label: "2d" },
              { value: "3d", label: "3d" },
            ]}
          />
        </Row>
        <div className="debug-help">
          {merge === false && "Off: every voxel renders as its own DOM element. Spans become CSS Grid areas."}
          {merge === "2d" && "2d: per-Z-layer same-color cube/ramp merge. Triangles, wedges, spikes pass through unchanged."}
          {merge === "3d" && "3d: slice/brush rendering for cubes — fewest DOM elements. Non-cube shapes are dropped in this mode."}
        </div>
      </DebugSection>

      <DebugStats voxelCount={voxels.length} extra={{ merge: merge || "off" }} />
      <DebugScene
        voxels={voxels}
        origin={origin}
        defaultZoom={1.4}
        defaultShowFloor
        voxScene={{ mergeVoxels: merge }}
      />
    </DebugLayout>
  );
}
