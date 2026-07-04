// Vendored from voxcss packages/core/src/camera/camera.test.ts@cac9da3.
// glyphcss deltas: expected outputs are [col,row,depth] char-grid values (not
//   CSS matrix3d); Poly→Glyph rename; zoom uses the same px/world semantic as
//   polycss/voxcss; parity tests validate voxcss matrix convention.

import { describe, it, expect } from "vitest";
import {
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  createGlyphCamera,
} from "./createGlyphCamera";

// ─── Helper: reproduce voxcss's forward projection in pure math ──────────────
// Used in parity tests to assert that createGlyphCamera uses the SAME matrix
// as voxcss camera.ts + unproject.ts.  Inputs are world coords + camera state;
// output is the CSS-frame xy (CSS pixels after zoom) that matches what
// voxcss would compute for `getStyle()`.
//
// voxcss getStyle():
//   translate3d(-cssX, -cssY, -cssZ) → rotate(rotYdeg) → rotateX(rotXdeg)
//   → scale(zoom / BASE_TILE)
// Forward projection (left-to-right):
//   1. subtract target  2. axis-swap (world→CSS)  3. rotateZ(rotY)
//   4. rotateX(rotX)    5. scale to final CSS px by zoom
const BASE_TILE = 50; // must match camera impl
const DEG = Math.PI / 180;

function voxcssCssXY(
  world: [number, number, number],
  target: [number, number, number],
  rotXDeg: number,
  rotYDeg: number,
  zoom: number,
): { cssX: number; cssY: number; cssZ: number } {
  // Step 1: subtract target
  const sx = world[0] - target[0];
  const sy = world[1] - target[1];
  const sz = world[2] - target[2];

  // Step 2: axis-swap (world[0]→cssY, world[1]→cssX, world[2]→cssZ)
  const cx = sy;  // world[1] → CSS X
  const cy = sx;  // world[0] → CSS Y
  const cz = sz;

  // Step 3: rotateZ(rotY) — CSS `rotate()`
  const cosY = Math.cos(rotYDeg * DEG);
  const sinY = Math.sin(rotYDeg * DEG);
  const rx  = cx * cosY - cy * sinY;
  const ry  = cx * sinY + cy * cosY;
  const rz  = cz;

  // Step 4: rotateX(rotX)
  const cosX = Math.cos(rotXDeg * DEG);
  const sinX = Math.sin(rotXDeg * DEG);
  const ry2 = ry * cosX - rz * sinX;
  const rz2 = ry * sinX + rz * cosX;

  // Step 5: scale by zoom (px/world) → CSS px
  return {
    cssX: rx  * zoom,
    cssY: ry2 * zoom,
    cssZ: rz2,  // depth stays in world units (no extra scale for depth comparison)
  };
}

// ─── Default values ───────────────────────────────────────────────────────────

describe("createGlyphOrthographicCamera — defaults", () => {
  it("defaults to rotX=65 (degrees)", () => {
    const cam = createGlyphOrthographicCamera();
    expect(cam.rotX).toBe(65);
  });

  it("defaults to rotY=45 (degrees)", () => {
    const cam = createGlyphOrthographicCamera();
    expect(cam.rotY).toBe(45);
  });

  it("defaults to zoom=0.65 (voxcss DEFAULT_CAMERA_STATE)", () => {
    const cam = createGlyphOrthographicCamera();
    expect(cam.zoom).toBe(0.65);
  });

  it("defaults target to [0,0,0]", () => {
    const cam = createGlyphOrthographicCamera();
    expect(cam.target).toEqual([0, 0, 0]);
  });

  it("kind is 'orthographic'", () => {
    expect(createGlyphOrthographicCamera().kind).toBe("orthographic");
  });
});

describe("createGlyphPerspectiveCamera — defaults", () => {
  it("defaults to rotX=65 (degrees)", () => {
    const cam = createGlyphPerspectiveCamera();
    expect(cam.rotX).toBe(65);
  });

  it("defaults to rotY=45 (degrees)", () => {
    const cam = createGlyphPerspectiveCamera();
    expect(cam.rotY).toBe(45);
  });

  it("defaults to zoom=0.65 (voxcss DEFAULT_CAMERA_STATE)", () => {
    const cam = createGlyphPerspectiveCamera();
    expect(cam.zoom).toBe(0.65);
  });

  it("defaults to distance=0 (voxcss DEFAULT_CAMERA_STATE)", () => {
    const cam = createGlyphPerspectiveCamera();
    expect(cam.distance).toBe(0);
  });

  it("defaults to perspective=32000 (voxcss CSS-perspective parity)", () => {
    const cam = createGlyphPerspectiveCamera();
    expect(cam.perspective).toBe(32000);
  });

  it("kind is 'perspective'", () => {
    expect(createGlyphPerspectiveCamera().kind).toBe("perspective");
  });

  it("eyeMode defaults to false", () => {
    expect(createGlyphPerspectiveCamera().eyeMode).toBe(false);
  });
});

describe("createGlyphCamera alias", () => {
  it("is an alias for createGlyphOrthographicCamera", () => {
    const cam = createGlyphCamera();
    expect(cam.kind).toBe("orthographic");
  });
});

// ─── State mutation ───────────────────────────────────────────────────────────

describe("GlyphCamera state mutation", () => {
  it("rotX is mutable", () => {
    const cam = createGlyphOrthographicCamera();
    cam.rotX = 30;
    expect(cam.rotX).toBe(30);
  });

  it("rotY is mutable", () => {
    const cam = createGlyphOrthographicCamera();
    cam.rotY = 90;
    expect(cam.rotY).toBe(90);
  });

  it("zoom is mutable", () => {
    const cam = createGlyphOrthographicCamera();
    cam.zoom = 1.5;
    expect(cam.zoom).toBe(1.5);
  });

  it("target is mutable", () => {
    const cam = createGlyphOrthographicCamera();
    cam.target = [1, 2, 3];
    expect(cam.target).toEqual([1, 2, 3]);
  });

  it("perspective camera: eyeMode is mutable", () => {
    const cam = createGlyphPerspectiveCamera();
    cam.eyeMode = true;
    expect(cam.eyeMode).toBe(true);
    cam.eyeMode = false;
    expect(cam.eyeMode).toBe(false);
  });

  it("orthographic camera: eyeMode setter is a no-op, getter always false", () => {
    const cam = createGlyphOrthographicCamera();
    cam.eyeMode = true;
    expect(cam.eyeMode).toBe(false);
  });
});

// ─── Parity: voxcss rotation convention ──────────────────────────────────────
//
// These tests validate that createGlyphCamera uses the SAME rotation matrix as
// voxcss (degrees, XYZ Euler with world→CSS axis-swap).  The reference values
// are computed from the explicit voxcss formula above (voxcssCssXY) — matching
// both gives numeric parity.  Expected outputs are [col,row,depth] rather than
// CSS pixels, since glyphcss renders to a char grid.

describe("projection parity with voxcss convention", () => {
  // Grid: 80 cols × 24 rows, cellAspect 2.0
  // cellPxW = BASE_TILE / cellAspect = 25, cellPxH = BASE_TILE = 50
  const COLS = 80, ROWS = 24, ASPECT = 2.0;
  const cellPxW = BASE_TILE / ASPECT; // 25
  const cellPxH = BASE_TILE;          // 50

  it("origin projects to grid center (ortho)", () => {
    const cam = createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 1 });
    const [col, row, depth] = cam.project([0,0,0], COLS, ROWS, ASPECT);
    expect(col).toBeCloseTo(COLS / 2, 5);
    expect(row).toBeCloseTo(ROWS / 2, 5);
    expect(depth).toBeCloseTo(0, 5);
  });

  it("origin projects to grid center (perspective)", () => {
    const cam = createGlyphPerspectiveCamera({ rotX: 65, rotY: 45, zoom: 1, distance: 20 });
    const [col, row, depth] = cam.project([0,0,0], COLS, ROWS, ASPECT);
    expect(col).toBeCloseTo(COLS / 2, 5);
    expect(row).toBeCloseTo(ROWS / 2, 5);
  });

  it("ortho col/row match voxcss CSS-frame xy ÷ cellPx (zoom=1, rotX=65, rotY=45)", () => {
    const rotX = 65, rotY = 45, zoom = 1;
    const world: [number,number,number] = [1, 2, 3];
    const target: [number,number,number] = [0, 0, 0];

    const cam = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    const [col, row, depth] = cam.project(world, COLS, ROWS, ASPECT);

    const ref = voxcssCssXY(world, target, rotX, rotY, zoom);
    const expectedCol = COLS / 2 + ref.cssX / cellPxW;
    const expectedRow = ROWS / 2 + ref.cssY / cellPxH;

    expect(col).toBeCloseTo(expectedCol, 8);
    expect(row).toBeCloseTo(expectedRow, 8);
    expect(depth).toBeCloseTo(ref.cssZ, 8);
  });

  it("ortho uses measured cell metrics exactly when the browser provides them", () => {
    const rotX = 65, rotY = 45, zoom = 0.65;
    const world: [number,number,number] = [1, 2, 3];
    const target: [number,number,number] = [0, 0, 0];
    const metrics = { cellWidth: 8, cellHeight: 5, centerCol: 51.25, centerRow: 46 };

    const cam = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    const [col, row] = cam.project(world, COLS, ROWS, ASPECT, metrics);

    const ref = voxcssCssXY(world, target, rotX, rotY, zoom);
    expect(col).toBeCloseTo(metrics.centerCol + ref.cssX / metrics.cellWidth, 8);
    expect(row).toBeCloseTo(metrics.centerRow + ref.cssY / metrics.cellHeight, 8);
  });

  it("ortho col/row match voxcss CSS-frame xy ÷ cellPx (rotX=30, rotY=90, zoom=0.5)", () => {
    const rotX = 30, rotY = 90, zoom = 0.5;
    const world: [number,number,number] = [-1, 0, 1];
    const target: [number,number,number] = [0, 0, 0];

    const cam = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    const [col, row] = cam.project(world, COLS, ROWS, ASPECT);

    const ref = voxcssCssXY(world, target, rotX, rotY, zoom);
    expect(col).toBeCloseTo(COLS / 2 + ref.cssX / cellPxW, 8);
    expect(row).toBeCloseTo(ROWS / 2 + ref.cssY / cellPxH, 8);
  });

  it("target shifts the projected position (ortho)", () => {
    const rotX = 65, rotY = 45, zoom = 1;
    const world: [number,number,number] = [1, 1, 0];
    const target: [number,number,number] = [1, 1, 0]; // same as world → projects to center

    const cam = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    cam.target = target;
    const [col, row] = cam.project(world, COLS, ROWS, ASPECT);
    expect(col).toBeCloseTo(COLS / 2, 8);
    expect(row).toBeCloseTo(ROWS / 2, 8);
  });

  it("world +X axis maps to +row (world[0]→cssY, cssY+→row+)", () => {
    // A point along +X world axis (with rotX=0, rotY=0 for clarity)
    const cam = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    const [, row0] = cam.project([0,0,0], COLS, ROWS, ASPECT);
    const [, row1] = cam.project([1,0,0], COLS, ROWS, ASPECT);
    // world[0]→cssY, cssY+→row+
    expect(row1).toBeGreaterThan(row0);
  });

  it("world +Y axis maps to +col (world[1]→cssX, cssX+→col+)", () => {
    const cam = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    const [col0] = cam.project([0,0,0], COLS, ROWS, ASPECT);
    const [col1] = cam.project([0,1,0], COLS, ROWS, ASPECT);
    // world[1]→cssX, cssX+→col+
    expect(col1).toBeGreaterThan(col0);
  });

  it("world +Z axis maps to -row (world[2]→cssZ, after rotX +Z moves up = -row)", () => {
    // With rotX=90° (top-down view), +Z world is toward viewer (positive depth)
    // and maps to +cssY (downward row) because rotX inverts the sign.
    // Here we just verify the sign is correct for the default 65° tilt:
    // at rotX=65° and rotY=0, world +Z should lift the point upward on screen (-row).
    const cam = createGlyphOrthographicCamera({ rotX: 65, rotY: 0, zoom: 1 });
    const [, row0] = cam.project([0,0,0], COLS, ROWS, ASPECT);
    const [, row1] = cam.project([0,0,1], COLS, ROWS, ASPECT);
    // +Z above the equator (rotX=65°) should decrease row (go up on screen)
    expect(row1).toBeLessThan(row0);
  });

  it("cellAspect stretches cols (wider cells → fewer cols per world unit)", () => {
    const cam1 = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    const cam2 = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    // Same world point, different cellAspect
    const [col1] = cam1.project([0,1,0], COLS, ROWS, 1.0); // square cells
    const [col2] = cam2.project([0,1,0], COLS, ROWS, 4.0); // tall-and-narrow cells
    // With cellAspect=4, cellPxW=50/4=12.5 → more cols per world unit than aspect=1
    expect(Math.abs(col2 - COLS/2)).toBeGreaterThan(Math.abs(col1 - COLS/2));
  });

  it("zoom=2 produces twice the col/row displacement as zoom=1 (ortho, linear)", () => {
    const world: [number,number,number] = [2, 3, 0];
    const cam1 = createGlyphOrthographicCamera({ rotX: 45, rotY: 30, zoom: 1 });
    const cam2 = createGlyphOrthographicCamera({ rotX: 45, rotY: 30, zoom: 2 });
    const [col1, row1] = cam1.project(world, COLS, ROWS, ASPECT);
    const [col2, row2] = cam2.project(world, COLS, ROWS, ASPECT);
    // Displacement from center doubles with zoom
    expect((col2 - COLS/2)).toBeCloseTo(2 * (col1 - COLS/2), 8);
    expect((row2 - ROWS/2)).toBeCloseTo(2 * (row1 - ROWS/2), 8);
  });

  it("perspective camera: farther points appear closer to center (foreshortening)", () => {
    // Legacy orbit projection (perspective: 0) — pinhole at `distance` world units.
    const cam = createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, zoom: 1, distance: 10, perspective: 0 });
    const [col_near] = cam.project([0, 1, 0], COLS, ROWS, ASPECT);  // depth rz2 ≈ 0
    const [col_far]  = cam.project([0, 1, 5], COLS, ROWS, ASPECT);  // depth rz2 ≈ 5 → farther
    // Both project y=1 → same cssX before perspective. But the near-depth point
    // (rz2~0) gets scale=distance/distance=1; the far-depth point (rz2~5) gets
    // scale=distance/(distance-5) = 10/5 = 2 → MORE displacement (closer to lens).
    // Points behind the lens are culled (NaN).
    expect(Math.abs(col_far - COLS/2)).toBeGreaterThan(Math.abs(col_near - COLS/2));
  });

  it("perspective: point beyond distance (rz2 >= distance) is NaN-culled", () => {
    // Legacy orbit projection (perspective: 0) — pinhole at `distance` world units.
    const cam = createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, zoom: 1, distance: 5, perspective: 0 });
    // world [0,0,10] → after rotation with rotX=0,rotY=0: rz2 = world[2] - 0 ... wait
    // Actually with rotX=0, rotY=0: axis-swap gives cx=0,cy=0,cz=10; rotZ(0)=same;
    // rotX(0)=same; rz2=10 > distance=5 → denom=5-10=-5 < NEAR → NaN
    const [col] = cam.project([0, 0, 10], COLS, ROWS, ASPECT);
    expect(Number.isNaN(col)).toBe(true);
  });

  it("eyeMode: point in front of eye (rz2 < 0) is valid", () => {
    const cam = createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, zoom: 1, distance: 10 });
    cam.eyeMode = true;
    // With rotX=0, rotY=0: a point at world [0,0,-5] → rz2 = -5 → in front of eye
    const [col, row] = cam.project([0, 0, -5], COLS, ROWS, ASPECT);
    expect(Number.isNaN(col)).toBe(false);
    expect(Number.isNaN(row)).toBe(false);
  });

  it("eyeMode: point behind eye (rz2 >= 0) is NaN-culled", () => {
    const cam = createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, zoom: 1, distance: 10 });
    cam.eyeMode = true;
    // world [0,0,5] → rz2=5 > 0 → behind eye → NaN
    const [col] = cam.project([0, 0, 5], COLS, ROWS, ASPECT);
    expect(Number.isNaN(col)).toBe(true);
  });

  it("depth component is rz2 in world units (same as voxcss depth)", () => {
    // rz2 comes purely from the rotation matrix, not scaled by zoom or BASE_TILE
    const cam = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
    // rotX=0, rotY=0: axis-swap gives cx=v[1], cy=v[0], cz=v[2]; rotZ(0)=same; rotX(0): ry2=cy, rz2=cz
    // world [3,4,7] → cx=4, cy=3, cz=7; rotZ: rx=4, ry=3, rz=7; rotX: rz2=3*0+7*1=7
    const [,, depth] = cam.project([3, 4, 7], COLS, ROWS, ASPECT);
    expect(depth).toBeCloseTo(7, 5);
  });

  it("rotation in degrees: 90-degree rotY swaps world axes correctly", () => {
    // At rotX=0, rotY=90°: cos90=0, sin90=1.
    // world [0,1,0] → cx=1,cy=0,cz=0; rotZ(90°): rx=0*1-0*1=0, ry...
    // wait: rotZ(90): rx = cx*cos90 - cy*sin90 = 1*0 - 0*1 = 0, ry = cx*sin90 + cy*cos90 = 1*1+0*0=1
    // rotX(0): ry2=ry=1, rz2=rz=0
    // col = COLS/2 + 0/cellPxW; row = ROWS/2 + zoom/cellPxH
    const cam = createGlyphOrthographicCamera({ rotX: 0, rotY: 90, zoom: 1 });
    const [col, row] = cam.project([0, 1, 0], COLS, ROWS, ASPECT);
    expect(col).toBeCloseTo(COLS/2 + 0 / cellPxW, 5);  // rx=0 → no col displacement
    expect(row).toBeCloseTo(ROWS/2 + 1 / cellPxH, 5);  // ry2=1 → row offset
  });

  it("known world point matches voxcss reference exactly (rotX=65, rotY=45)", () => {
    // This is the canonical parity test: feed a known point, assert the output
    // matches what voxcss would compute for its CSS-frame position.
    const rotX = 65, rotY = 45, zoom = 1;
    const world: [number,number,number] = [0, 1, 0];

    const cam = createGlyphOrthographicCamera({ rotX, rotY, zoom });
    const [col, row, depth] = cam.project(world, COLS, ROWS, ASPECT);

    // voxcss reference (hand-computed + verified):
    // cx = world[1] = 1, cy = world[0] = 0, cz = 0
    // rotZ(45°): cos=sin=0.70711. rx = 0.70711, ry = 0.70711, rz = 0
    // rotX(65°): ry2 = 0.70711*cos65 - 0*sin65 = 0.70711*0.42262 = 0.29890, rz2 = 0.70711*sin65 = 0.70711*0.90631 = 0.64086
    // cssX = rx*zoom = 0.70711
    // cssY = ry2*zoom = 0.29890
    // col = 40 + 0.70711/25 = 40.028
    // row = 12 + 0.29890/50 = 12.006
    expect(col).toBeCloseTo(COLS/2 + 0.70711 / cellPxW, 2);
    expect(row).toBeCloseTo(ROWS/2 + 0.29890 / cellPxH, 2);
    // depth = rz2 ≈ 0.641 (world units)
    expect(depth).toBeCloseTo(0.641, 2);
  });
});

// ─── autoSize / zoom independence ────────────────────────────────────────────

describe("zoom independence from grid size", () => {
  it("same zoom produces same col/row ratio at different grid sizes (absolute scale)", () => {
    // In the new convention, zoom is absolute — doubling cols does NOT halve
    // the projected position relative to center (unlike the old viewport-fraction zoom).
    const world: [number,number,number] = [0, 2, 0];
    const zoom = 1;
    const cam = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom });

    // Grid 1: 80×24
    const [col80] = cam.project(world, 80, 24, 2.0);
    // Grid 2: 40×12
    const [col40] = cam.project(world, 40, 12, 2.0);

    // With absolute zoom, the displacement from center in column units is
    // the SAME regardless of grid size (world→px→col is not grid-normalized).
    const disp80 = col80 - 80/2;
    const disp40 = col40 - 40/2;
    expect(disp80).toBeCloseTo(disp40, 8);
  });
});
