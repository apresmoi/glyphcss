/**
 * `createGlyphMap` must pass its own view centre as the transition ANCHOR
 * (`GlyphMapProjectionTransitionOptions.anchor`), because that anchor is what
 * ENGAGES `transition.ts`'s globe<->sheet UNWRAP path. With no anchor an
 * orbit<->sheet pair silently falls back to the plain per-vertex lerp, and the
 * lerp is what the user sees as "a zoom in and zoom out": a sphere and a flat
 * sheet do not share a world scale, so lerping their projected positions blows
 * the apparent size up mid-flight and collapses it again.
 *
 * This asserts the BEHAVIOUR, not the call: apparent size — the screen-cell
 * distance between two points one degree apart at the view centre — must stay
 * bounded by its own endpoints across the whole transition, instead of bulging
 * past them. Deleting the `{ anchor: view.center }` argument in
 * `applyProjectionFrame` turns it red.
 */
import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";

const CENTER: [number, number] = [0, 20];

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: CENTER, span: 40, cols: 40, rows: 20 },
    projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
    tilt: 0,
  });
  return { host, map };
}

/** Screen-cell distance between the view centre and a point 1 degree east of it. */
function apparentSize(map: ReturnType<typeof createGlyphMap>): number {
  const a = map.project(CENTER);
  const b = map.project([CENTER[0] + 1, CENTER[1]]);
  return Math.hypot(b.col - a.col, b.row - a.row);
}

describe("createGlyphMap — a globe<->sheet transition takes the UNWRAP path, not the lerp", () => {
  it("keeps apparent size bounded by its own endpoints across the whole flight", async () => {
    const { host, map } = mount();

    const start = apparentSize(map);
    expect(start).toBeGreaterThan(0);

    const done = map.setProjection(glyphMapEquirectangular(), { durationMs: 300 });

    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 45));
      samples.push(apparentSize(map));
    }
    await done;
    const end = apparentSize(map);
    expect(end).toBeGreaterThan(0);

    const peak = Math.max(...samples);
    const ceiling = Math.max(start, end);
    // The unwrap develops the sphere onto its own tangent plane at the anchor,
    // so apparent size moves monotonically between the two endpoints' values.
    // The plain lerp instead blows it far past both (measured ~50x at t=0.5),
    // which is the zoom-in/zoom-out this anchor exists to remove.
    expect(peak).toBeLessThan(ceiling * 1.5);

    map.destroy();
    host.remove();
  });
});
