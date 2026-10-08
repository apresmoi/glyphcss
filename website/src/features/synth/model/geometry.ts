import {
  createGlyphOrthographicCamera,
  resolveGeometry,
  type GlyphGeometryName,
  type GlyphMeshTransform,
  type GlyphSceneHandle,
} from "glyphcss";
import {
  PYRAMID_STAGE_SIZE,
  STAGE_CAMERA_ROT_X,
  STAGE_CAMERA_ROT_Y,
  synthDefaults,
  type Params,
  type Polys,
} from "./parameters";
import { MAX_VOICES } from "./urlState";

// A flat square in the world XY plane with 0..1 UVs — a clean 2D surface for
// previews and the scene-filling "plane" shape.
export function flatQuad(size: number): Polys {
  const p = {
    vertices: [
      [-size, -size, 0],
      [size, -size, 0],
      [size, size, 0],
      [-size, size, 0],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  };
  return [p] as unknown as Polys;
}

// Give each face its own local 0..1 UV (project onto the face plane, normalize to
// the face's bbox) so surface effects map PER-FACE — each face reads like its own
// plane, patterns centre on it — instead of a world-continuous wrap.
export type V3 = [number, number, number];

export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const vcross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const vnorm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function withFaceUvs(polys: Polys): Polys {
  return (polys as unknown as { vertices: V3[] }[]).map((p) => {
    const vs = p.vertices;
    if (vs.length < 3) return p;
    const n = vnorm(vcross(vsub(vs[1], vs[0]), vsub(vs[2], vs[0])));
    const u = vnorm(vsub(vs[1], vs[0]));
    const v = vcross(n, u);
    const proj = vs.map((w) => {
      const d = vsub(w, vs[0]);
      return [vdot(d, u), vdot(d, v)] as [number, number];
    });
    let mnu = Infinity,
      mxu = -Infinity,
      mnv = Infinity,
      mxv = -Infinity;
    for (const [pu, pv] of proj) {
      if (pu < mnu) mnu = pu;
      if (pu > mxu) mxu = pu;
      if (pv < mnv) mnv = pv;
      if (pv > mxv) mxv = pv;
    }
    const su = mxu - mnu || 1,
      sv = mxv - mnv || 1;
    return { ...p, uvs: proj.map(([pu, pv]) => [(pu - mnu) / su, (pv - mnv) / sv]) };
  }) as unknown as Polys;
}

// The `pyramid` stage: an UNCENTERED corner tetrahedron, object-space
// vertices EXACTLY (0,0,0), (s,0,0), (0,s,0), (0,0,s) — NOT recentered on
// the mesh's own centroid the way `resolveGeometry`'s other shapes center on
// `center`. This is a binding contract, not a cosmetic choice
// (VOLUMETRIC-2.md §3): the Sierpinski recipe's uniform `phase: -1/2`
// selectors pick each axis's UPPER half of a `[0,1]`-aligned window, and
// that only lands in the right octants when the window's own corner sits AT
// the domain origin. A centered window (this shape's own bounding-box
// centroid at the origin, like every other stage here) would put the solid
// mass in the wrong octants — and a linear field has no origin-shift knob
// that could compensate; `originU/V/W` are ignored by linear fields
// entirely (see AGENTS.md's field-synth section). Presentation — framing,
// centering on screen, picking a flattering angle — is the CAMERA's job via
// the stage hint table below, never these vertices.
//
// Each face is wound CCW-from-outside (outward normal away from the solid's
// interior), matching every hand-authored geometry helper in
// `packages/core/src/helpers` (e.g. `tetrahedronPolygons`/`cubePolygons`).
function cornerTetraPolygons(s: number): Polys {
  const O: V3 = [0, 0, 0],
    A: V3 = [s, 0, 0],
    B: V3 = [0, s, 0],
    C: V3 = [0, 0, s];
  const faces: V3[][] = [
    [A, B, C], // opposite O
    [O, B, A], // opposite C (z=0 plane)
    [O, C, B], // opposite A (x=0 plane)
    [O, A, C], // opposite B (y=0 plane)
  ];
  return faces.map((vertices) => ({ vertices })) as unknown as Polys;
}

export function shapePolys(name: string): Polys {
  if (name === "plane") return flatQuad(3);
  if (name === "pyramid") return withFaceUvs(cornerTetraPolygons(PYRAMID_STAGE_SIZE));
  return withFaceUvs(resolveGeometry(name as GlyphGeometryName, { size: 3 }));
}

export const isFlat = (name: string) => name === "plane";

// Duplicates `createGlyphScene.ts`'s `applyTransform` rotation math exactly
// (Rz first on the point, then Ry, then Rx — matrix product Rx*Ry*Rz) so the
// bbox math below previews the SAME rotated shape the renderer will actually
// produce. There is no exported rotate-only utility to reuse; this is
// deliberately kept in lockstep with that function's composition order, not
// a generic decomposition assumption.
function rotateOnly([vx, vy, vz]: V3, [rxDeg, ryDeg, rzDeg]: V3): V3 {
  const DEG2RAD = Math.PI / 180;
  const rx = rxDeg * DEG2RAD,
    ry = ryDeg * DEG2RAD,
    rz = rzDeg * DEG2RAD;
  const cosX = Math.cos(rx),
    sinX = Math.sin(rx);
  const cosY = Math.cos(ry),
    sinY = Math.sin(ry);
  const cosZ = Math.cos(rz),
    sinZ = Math.sin(rz);
  let x = vx,
    y = vy,
    z = vz;
  let nx = cosZ * x - sinZ * y;
  let ny = sinZ * x + cosZ * y;
  let nz = z;
  x = cosY * nx + sinY * nz;
  y = ny;
  z = -sinY * nx + cosY * nz;
  nx = x;
  ny = cosX * y - sinX * z;
  nz = sinX * y + cosX * z;
  return [nx, ny, nz];
}

// The corner tetra's O -> centroid(A,B,C) axis is the (1,1,1) direction — the
// classic Sierpinski look wants the OPPOSITE of that as "up": apex (O) above
// a base (face ABC) parallel to the ground, i.e. the direction FROM the base
// TOWARD the apex, centroid(ABC) -> O, mapped onto world +Z.
//
// +Z (not +Y) is the correct target, and this is a claim about the REAL
// runtime camera, not the unused `project()` in
// packages/core/src/math/projection.ts (that function is exported from
// `@glyphcss/core` but nothing in the render path — `createGlyphScene`,
// `compileScene`, `rasterize` — ever calls it; a prior version of this file
// cited its `row = rows*cy - v[1]*r*persp` formula as "glyphcss's native
// vertical axis", which does not describe what actually renders). The camera
// every mesh here is actually projected through is
// `createGlyphOrthographicCamera` (packages/glyphcss/src/api/
// createGlyphCamera.ts, vendored from voxcss): it axis-swaps world into a
// CSS-like frame, then applies `rotateZ(rotY)` (yaw) followed by
// `rotateX(rotX)` (pitch) — see `rotateVec3Voxcss` there. Under that
// composition, world Z is untouched by the yaw step (the Z-rotation only
// mixes world X/Y) and only gets foreshortened by pitch afterward, so its
// projected column is IDENTICALLY zero and its row is a clean
// `-sin(rotX)`/`cos(rotX)` split for every yaw angle — the one world axis
// whose screen reading never drifts sideways as the camera orbits. World Y
// has no such invariance (it mixes into both screen axes once rotY != 0),
// so aligning to it left the corner tetra's three base corners scattered
// above and below the apex under the page's actual default camera (rotX 58,
// rotY 32) instead of forming a clean base band beneath it — confirmed by
// projecting this shape's actual committed world vertices through the real
// `createGlyphOrthographicCamera` (not a hand-reproduced formula): two of
// the three base corners landed at a SMALLER row than the apex, i.e. above
// it on screen. This also matches `cubePolygons`' own `[4,5,6,7], // +Z
// (top)` face comment and AGENTS.md's "`+Z` = up, matching every native
// primitive's `+Z (top)` convention" (the fonts-package doc this appears
// in) — `+Y` was never the right target. `conePolygons`/`pyramidPolygons`
// happen to use Y as their own local height parameter, but that is an
// unrelated per-helper authoring choice that stays invisible for a
// rotationally symmetric shape (a cone's visible silhouette still reads
// "pointy end up" from most angles no matter which axis is nominally
// "up"); it only breaks visibly for an asymmetric 4-vertex shape like this
// one, where "upright" is a strict per-vertex ordering, not just a
// silhouette impression.
//
// That base->apex direction is -(1,1,1)/sqrt(3), regardless of the tetra's
// size `s` (a pure direction). Solved as the minimal (shortest-arc)
// axis-angle rotation from that source vector to +Z via Rodrigues' formula,
// then decomposed into the XYZ Euler triple `applyTransform` actually
// composes (R = Rx*Ry*Rz applied to the point): ry = asin(R02), rx =
// atan2(-R12, R22), rz = atan2(-R01, R00) — the standard closed-form
// extraction for this exact matrix layout, valid here since asin's
// principal branch keeps cos(ry) >= 0 (no gimbal-lock special case needed
// for this particular source/target pair). Numerically verified (see
// synthKit.test.ts): apex ends up above the base plane, the base is
// parallel to the ground, rebuilding R from the returned angles reproduces
// the same target vector, AND — the arbiter that actually matters —
// projecting the resulting world vertices through the real
// `createGlyphOrthographicCamera` at the page's default camera angle puts
// the apex at a strictly smaller row than all three base corners.
function alignCornerTetraApexEuler(): V3 {
  const source = vnorm([-1, -1, -1]);
  const target: V3 = [0, 0, 1];
  const axis = vcross(source, target);
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  const cosAngle = Math.min(1, Math.max(-1, vdot(source, target)));
  const angle = Math.acos(cosAngle);
  const [ux, uy, uz] = axisLen > 1e-12 ? vnorm(axis) : [1, 0, 0];
  const c = Math.cos(angle),
    s = Math.sin(angle),
    t = 1 - c;
  const r00 = t * ux * ux + c,
    r01 = t * ux * uy - s * uz,
    r02 = t * ux * uz + s * uy;
  const r12 = t * uy * uz - s * ux;
  const r22 = t * uz * uz + c;
  const RAD2DEG = 180 / Math.PI;
  const ry = Math.asin(Math.min(1, Math.max(-1, r02)));
  const rx = Math.atan2(-r12, r22);
  const rz = Math.atan2(-r01, r00);
  return [rx * RAD2DEG, ry * RAD2DEG, rz * RAD2DEG];
}

const CORNER_TETRA_APEX_EULER: V3 = alignCornerTetraApexEuler();

// The pyramid stage's corner tetra is deliberately UNCENTERED in object
// space (see `cornerTetraPolygons` above — a binding contract for the
// Sierpinski recipe's `[0,1]^3` window, not to be touched). Left alone it
// also renders lying on one of its right-angle faces, off-center, and
// spinning about an off-axis, off-center pivot — not the classic Sierpinski
// "apex up" look. Fixed entirely in WORLD space, via the mesh's transform
// (`createGlyphScene`'s `applyTransform` captures `objectVertices` BEFORE
// this transform is applied, so the field recipe never sees it): rotate by
// `CORNER_TETRA_APEX_EULER` so the apex sits above a ground-parallel base,
// then translate ONLY ALONG THAT SAME AXIS (world Z) to center the shape
// vertically.
//
// Two prior versions both translated OFF that axis and both wobbled under
// orbit:
//   - 529a09e centered the 4 rotated corners' 3D world-space AABB.
//   - 783fa79 centered the rotated shape's screen-PROJECTED silhouette
//     bbox, but only at ONE fixed camera pose (rotX 58, rotY 32) — exact at
//     that pose, confirmed via Playwright, but the solved translation has
//     nonzero world X/Y components (a tetrahedron's 4-vertex bbox isn't
//     centered on its own 3-fold symmetry axis).
//
// The corner tetra has a 3-fold symmetry axis running apex (O, always at
// local/world (0,0,0) — `rotateOnly` fixes the origin) through the base
// centroid; `alignCornerTetraApexEuler`'s rotation puts that axis exactly
// on world Z (the base corners A/B/C land 120° apart around it, same
// height — see `alignCornerTetraApexEuler`'s doc). `createGlyphOrthographicCamera`'s
// camera orbits around its `target`, which this stage never sets (default
// world origin) — so ANY translation off the object's own symmetry axis
// moves that axis off the camera's pivot, and the object's screen position
// then swings through a circle/ellipse as rotY (yaw, i.e. spin/orbit)
// varies — the live "eccentric rotation" bug. A translation ALONG the axis
// (pure world Z) leaves the axis exactly where it was (still the line
// x=0,y=0 through the pivot), so it is invariant to camera rotation: for
// ANY rotX/rotY, `rotateVec3Voxcss` sends a pure-Z world vector to a
// rotated vector whose first (CSS-Y/col) component is IDENTICALLY zero
// (rotateZ(rotY) leaves cz alone; rotateX(rotX) only ever mixes cy/cz, not
// cx) — verified in synthKit.test.ts. Centering along Z therefore holds
// simultaneously for every camera angle, not just the one it's solved at.
//
// `dz` is still solved against the real camera (not reproduced by hand) at
// the page's default pose, matching 783fa79's approach for the ONE degree
// of freedom that pose can determine (vertical placement) — the resulting
// row offset from a pure-Z translation is independent of rotY, so this
// single-pose solve is exact for every yaw, and only rotX (pitch) — which
// orbit ping-pongs within a bounded range, not through a full spin — moves
// the row bbox at all, and only by the shape's own bounded vertical extent.
function solveVerticalCenteringZ(rotatedCorners: V3[]): number {
  const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: 1 });
  // Unit cell metrics, zero screen center: `project` then returns the raw
  // rotated vector [rx, ry, rz] with nothing else (grid size, cell size,
  // center) mixed in — exactly the camera's rotation matrix applied to `v`.
  const metrics = { cellWidth: 1, cellHeight: 1, centerCol: 0, centerRow: 0 };
  const projRaw = (v: V3): V3 => {
    const [c, r, d] = camera.project(v, 2, 2, 1, metrics);
    return [c, r, d ?? 0];
  };
  let minRow = Infinity,
    maxRow = -Infinity;
  for (const v of rotatedCorners) {
    const [, row] = projRaw(v);
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }
  const rowCenter = (minRow + maxRow) / 2;
  // A world-Z translation of `dz` shifts every corner's projected row by
  // `dz * projRaw([0,0,1])[1]` (linearity) and its col by exactly 0 (see
  // doc above) — solve for the `dz` that zeroes the row bbox center.
  const rowPerZ = projRaw([0, 0, 1])[1];
  return -rowCenter / rowPerZ;
}

const PYRAMID_STAGE_ROTATED_CORNERS: V3[] = (() => {
  const s = PYRAMID_STAGE_SIZE;
  return (
    [
      [0, 0, 0],
      [s, 0, 0],
      [0, s, 0],
      [0, 0, s],
    ] as V3[]
  ).map((v) => rotateOnly(v, CORNER_TETRA_APEX_EULER));
})();

const PYRAMID_STAGE_POSITION: V3 = [0, 0, solveVerticalCenteringZ(PYRAMID_STAGE_ROTATED_CORNERS)];

export function shapeTransform(name: string): GlyphMeshTransform {
  if (name === "pyramid") return { rotation: CORNER_TETRA_APEX_EULER, position: PYRAMID_STAGE_POSITION };
  return {};
}

// Applies a `GlyphMeshTransform` to one point exactly like `createGlyphScene`'s
// (unexported) `applyTransform`: scale, then rotate Rz->Ry->Rx (`rotateOnly`
// above), then translate. `frameObject` needs this so its projected bbox
// matches what actually renders for a mesh with a non-identity transform
// (e.g. the pyramid stage) — projecting the mesh's own untransformed local
// vertices there measures the WRONG silhouette (wrong size, and for a
// shape whose transform includes rotation, a differently-shaped one too).
function applyMeshTransformPoint(v: V3, transform: GlyphMeshTransform): V3 {
  const [sx, sy, sz] =
    transform.scale === undefined
      ? [1, 1, 1]
      : typeof transform.scale === "number"
        ? [transform.scale, transform.scale, transform.scale]
        : transform.scale;
  const rotated = transform.rotation
    ? rotateOnly([v[0] * sx, v[1] * sy, v[2] * sz], transform.rotation as V3)
    : [v[0] * sx, v[1] * sy, v[2] * sz];
  const [px, py, pz] = (transform.position as V3 | undefined) ?? [0, 0, 0];
  return [rotated[0] + px, rotated[1] + py, rotated[2] + pz];
}

// Frame the object by setting the camera zoom so its projected bbox fills ~`fill`
// of the grid. MUST project with the same MEASURED cell metrics the renderer uses
// (`metrics`), else the default cell (BASE_TILE/cellAspect) is ~4× off and the zoom
// massively overshoots. Call after a render so the <pre> reflects the real cell.
// `transform`: the SAME `GlyphMeshTransform` passed to `scene.add()` for these
// `polys` — required so the projected bbox measures the actually-rendered
// (world-space) mesh, not its untransformed local geometry (see
// `applyMeshTransformPoint`'s doc; every non-pyramid stage has an identity
// transform today, so this is a no-op for them).
// `cover`: fit the SMALLER axis exactly at `fill` and overscan the larger one
// (like CSS `background-size: cover`) instead of the default `contain` behaviour
// (fit the LARGER axis, margin on the smaller one). Used for the fullscreen plane
// so its texture reaches every edge of a non-square viewport instead of framing
// with letterbox bars.
export function frameObject(
  scene: GlyphSceneHandle,
  camera: {
    zoom: number;
    project: (v: [number, number, number], c: number, r: number, a: number, m?: unknown) => number[];
  },
  polys: Polys,
  fill = 0.72,
  cover = false,
  transform: GlyphMeshTransform = {},
): void {
  const o = scene.getOptions();
  const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
  let metrics: { cellWidth: number; cellHeight: number } | undefined;
  if (pre) {
    const r = pre.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) metrics = { cellWidth: r.width / o.cols, cellHeight: r.height / o.rows };
  }
  camera.zoom = 1;
  let minc = Infinity,
    maxc = -Infinity,
    minr = Infinity,
    maxr = -Infinity;
  for (const p of polys)
    for (const rawV of p.vertices) {
      const v = applyMeshTransformPoint(rawV as V3, transform);
      const pr = camera.project(v, o.cols, o.rows, o.cellAspect, metrics);
      if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
      if (pr[0]! < minc) minc = pr[0]!;
      if (pr[0]! > maxc) maxc = pr[0]!;
      if (pr[1]! < minr) minr = pr[1]!;
      if (pr[1]! > maxr) maxr = pr[1]!;
    }
  const w = maxc - minc,
    h = maxr - minr;
  if (w > 0 && h > 0) {
    const zc = (fill * o.cols) / w,
      zr = (fill * o.rows) / h;
    camera.zoom = cover ? Math.max(zc, zr) : Math.min(zc, zr);
  }
}

// Isolate one voice into osc-1 (amp 1) so a card can preview its solo contribution.
// Colored through the SAME path the real render uses: when per-voice colors is
// ON, osc-1 carries the voice's own `color{slot}` and `voiceColors: true`, so
// `fieldSynth`'s evaluate() resolves the preview's color from that single active
// voice (matching the trendline, which already reads `color{slot}`) — no CSS
// override needed. When OFF, it falls back to the main `color`/`colorB`/`gradient`,
// same as the rest of the scene.
export function soloParams(params: Params, slot: number): Params {
  const base = synthDefaults();
  for (let k = 1; k <= MAX_VOICES; k++) base[`amp${k}`] = 0;
  base.field1 = params[`field${slot}`];
  base.wave1 = params[`wave${slot}`];
  base.angle1 = params[`angle${slot}`];
  base.originU1 = params[`originU${slot}`];
  base.originV1 = params[`originV${slot}`];
  base.originW1 = params[`originW${slot}`];
  base.duty1 = params[`duty${slot}`];
  base.phase1 = params[`phase${slot}`];
  base.freq1 = params[`freq${slot}`];
  base.speed1 = params[`speed${slot}`];
  base.amp1 = 1;
  // The menger/sierpinski recursion depth is per-voice (`iter${slot}`), not
  // covered by any of the field/wave/freq copies above — omitted, a solo
  // preview always showed the schema default (3) regardless of the voice's
  // own `iter` knob.
  base.iter1 = params[`iter${slot}`];
  // The solo voice always lands on layer 1 (a solo preview is always a
  // single active voice, and layer 1 is the only populated layer) — but its
  // SOURCE layer's shaping must come along, or a thresholded/inverted layer
  // previews as if it were the flat, unshaped default (repro: a voice on
  // `layer2: 3` with threshold+invert solos as `layer1: 1` with none of that
  // shaping active, discarding it entirely). Copying the source layer's
  // combine/threshold/invert/blend/amp onto layer 1's own shaping slot
  // reproduces exactly how that voice folds in the real patch.
  base.layer1 = 1;
  const sourceLayer = Math.round(Number(params[`layer${slot}`] ?? 1));
  base.layerCombine1 = params[`layerCombine${sourceLayer}`] ?? base.layerCombine1;
  base.layerThresholdOn1 = params[`layerThresholdOn${sourceLayer}`] ?? base.layerThresholdOn1;
  base.layerThreshold1 = params[`layerThreshold${sourceLayer}`] ?? base.layerThreshold1;
  base.layerInvert1 = params[`layerInvert${sourceLayer}`] ?? base.layerInvert1;
  base.layerBlend1 = params[`layerBlend${sourceLayer}`] ?? base.layerBlend1;
  base.layerAmp1 = params[`layerAmp${sourceLayer}`] ?? base.layerAmp1;
  base.space = params.space;
  base.scale = params.scale;
  base.glyphs = params.glyphs;
  base.voiceColors = params.voiceColors === true;
  base.color1 = params[`color${slot}`];
  base.color = params.color;
  base.colorB = params.colorB;
  base.gradient = params.gradient;
  base.gain = 1;
  base.bias = 0.5;
  return base;
}
