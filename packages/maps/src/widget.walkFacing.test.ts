/**
 * Walk mode: **the camera faces where the walker steps.**
 *
 * The one property that ties walk mode's two halves together, and the one
 * nothing else pins. `widget.walk.test.ts` asserts the STEP goes north at
 * heading 0; `widget.bearing.test.ts` asserts the CAMERA turns when the
 * bearing does. Neither compares them, so a swapped axis, a dropped
 * negation, or a second sign flip in the bearing chain would leave both
 * green while the reader gets the reported symptom: the ground sliding
 * SIDEWAYS under a camera pointed somewhere else.
 *
 * It is measured as an ANGLE, in the walker's own local tangent frame:
 *
 *  - the camera's forward is `walk.harness`'s `walkForward`, the view axis
 *    recovered from `eyeDepth`'s gradient — never re-derived from
 *    `rotX`/`rotY`, which would re-implement the thing under test and would
 *    be blind to `camera.mat` (where the bearing actually lives);
 *  - the step's is the azimuth of the displacement `view.center` actually
 *    took, through the widget's real `keydown` path and its real motion
 *    loop.
 *
 * Both are then read against the SAME north/east basis at the walker's own
 * lon/lat, so the comparison is a number a reader can check by hand.
 *
 * Four things this covers that a single forward probe would not:
 *
 *  1. **Both signs of both axes** (four cardinals plus two non-cardinals).
 *     A single-heading test cannot see a sign flip that is only wrong on one
 *     axis, which is exactly the shape the bearing gesture's reported
 *     reversal had.
 *  2. **The STRAFE is square to the facing.** `glyphMapWalkStep` folds
 *     forward and strafe into one azimuth, so a transposed `atan2` sends the
 *     strafe along the facing instead of across it.
 *  3. **PITCH does not turn the walker.** Looking up or down moves the view
 *     axis out of the tangent plane; its HEADING must not move with it, or
 *     raising the head steers.
 *  4. **The entry is the page's.** `/maps` enters through `mapWalkReason`'s
 *     altitude clause and then `map.setWalk({})`, so the fixture's span is
 *     inside {@link GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG} by assertion rather
 *     than by luck — a probe entered from orbit is a state the product
 *     cannot be in.
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { GLYPH_MAP_WALK_HORIZON_TILT_DEG, GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG } from "./walk";
import { walkForward } from "./walk.harness";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];
/** The page's own entry span (`/maps` gates on <= 0.05 deg), not an orbit one. */
const ENTRY_SPAN = 0.01;
const DEG = Math.PI / 180;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: ZURICH as [number, number], span: ENTRY_SPAN, cols: COLS, rows: ROWS },
  });
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

function key(host: HTMLElement, type: "keydown" | "keyup", k: string): void {
  host.ownerDocument!.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
}

async function frames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise<void>((r) => { requestAnimationFrame(() => r()); });
}

/**
 * The compass heading of a world vector, read in the local tangent frame at
 * `(lon, lat)` on `glyphMapGlobe`'s textbook sphere.
 *
 * Only the tangential part contributes, so this is well defined at any
 * PITCH: a view axis tipped 30 deg up has the same heading as a level one.
 */
function headingOf(v: readonly number[], lon: number, lat: number): number {
  const la = lat * DEG, lo = lon * DEG;
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const n = v[0]! * north[0]! + v[1]! * north[1]! + v[2]! * north[2]!;
  const e = v[0]! * east[0]! + v[1]! * east[1]! + v[2]! * east[2]!;
  return ((Math.atan2(e, n) / DEG) % 360 + 360) % 360;
}

/** The compass azimuth a lon/lat displacement went, over a metre-scale step. */
function stepHeading(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = b[1] - a[1];
  const dLon = (b[0] - a[0]) * Math.cos(a[1] * DEG);
  return ((Math.atan2(dLon, dLat) / DEG) % 360 + 360) % 360;
}

/** Signed difference of two compass headings, in `(-180, 180]`. */
function headingDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

/**
 * Hold `k` for a few motion frames and report where the walker went, plus
 * the camera heading it had while going there.
 */
async function stride(map: ReturnType<typeof mount>["map"], host: HTMLElement, k: string) {
  const before = map.getView().center as [number, number];
  const camHeading = headingOf(walkForward(map.scene.camera as never), before[0], before[1]);
  key(host, "keydown", k);
  await frames(4);
  key(host, "keyup", k);
  const after = map.getView().center as [number, number];
  const metres = Math.hypot(after[1] - before[1], (after[0] - before[0]) * Math.cos(before[1] * DEG))
    * DEG * 6_371_000;
  return { camHeading, stepHeading: stepHeading(before, after), metres };
}

describe("walk mode — the camera faces where the walker steps", () => {
  it("enters the way the page does: the fixture span is inside the entry gate", () => {
    expect(ENTRY_SPAN).toBeLessThanOrEqual(GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG);
  });

  // Four cardinals, because a sign flip on one axis is invisible on the
  // other three; plus two non-cardinals, because a transposed basis agrees
  // with the truth at every multiple of 90 deg and nowhere else.
  for (const bearing of [0, 90, 180, 270, 37, 213]) {
    it(`forward walks along the camera's own facing at bearing ${bearing}`, async () => {
      const { map, host, done } = mount();
      map.setWalk({ speed: 20 });
      map.setBearing(bearing);

      const { camHeading, stepHeading: went, metres } = await stride(map, host, "w");

      // The walker actually moved — an unmoved centre has an undefined
      // azimuth and would make every clause below vacuously true.
      expect(metres).toBeGreaterThan(0.05);
      // The camera is aimed where the reader asked.
      expect(Math.abs(headingDelta(camHeading, bearing))).toBeLessThan(0.05);
      // And the step went there too. THIS is the clause nothing else covers.
      expect(Math.abs(headingDelta(went, camHeading))).toBeLessThan(0.05);
      done();
    });
  }

  it("back walks against the facing, not across it", async () => {
    const { map, host, done } = mount();
    map.setWalk({ speed: 20 });
    map.setBearing(37);
    const { camHeading, stepHeading: went, metres } = await stride(map, host, "s");
    expect(metres).toBeGreaterThan(0.05);
    expect(Math.abs(headingDelta(went, camHeading + 180))).toBeLessThan(0.05);
    done();
  });

  it("strafe goes SQUARE to the facing — right on D, left on A", async () => {
    const { map, host, done } = mount();
    map.setWalk({ speed: 20 });
    map.setBearing(37);

    const right = await stride(map, host, "d");
    expect(right.metres).toBeGreaterThan(0.05);
    expect(Math.abs(headingDelta(right.stepHeading, right.camHeading + 90))).toBeLessThan(0.05);

    const left = await stride(map, host, "a");
    expect(left.metres).toBeGreaterThan(0.05);
    expect(Math.abs(headingDelta(left.stepHeading, left.camHeading - 90))).toBeLessThan(0.05);
    done();
  });

  // Looking up or down tips the view axis out of the tangent plane. Its
  // HEADING must not move with it, or raising the head steers the walk.
  for (const pitch of [-40, 40]) {
    it(`a pitch of ${pitch} deg does not steer the walk`, async () => {
      const { map, host, done } = mount();
      map.setWalk({ speed: 20 });
      map.setBearing(213);
      map.setTilt(GLYPH_MAP_WALK_HORIZON_TILT_DEG + pitch);
      expect(map.getWalk()!.pitch).toBeCloseTo(pitch, 6);

      const { camHeading, stepHeading: went, metres } = await stride(map, host, "w");
      expect(metres).toBeGreaterThan(0.05);
      expect(Math.abs(headingDelta(camHeading, 213))).toBeLessThan(0.05);
      expect(Math.abs(headingDelta(went, camHeading))).toBeLessThan(0.05);
      done();
    });
  }
});
