import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";

/**
 * `GlyphMapHandle.setTilt` — camera pitch decoupled from `view.center` for
 * BOTH sheet and orbit (globe) projections (MAPS.md §13 slice 5's "make
 * tilt work for orbit too"). See widget.ts's `setTilt` doc for the math:
 * an orbit tilt composes as an extra `rotateX` on top of
 * `cameraForCenter(lon, lat).rotX`, and drag subtracts it back out before
 * calling `centerForCamera` so `view.center` never drifts.
 */
function fire(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
}

describe("createGlyphMap — tilt (globe/orbit)", () => {
  it("defaults to head-on (tilt 0) — byte-identical camera.rotX to cameraForCenter alone", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const projection = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const map = createGlyphMap(host, {
      view: { center: [12, 34], span: 40, cols: 60, rows: 30 },
      projection,
    });
    const { rotX } = projection.cameraForCenter!(12, 34);
    expect(map.scene.camera.rotX).toBeCloseTo(rotX, 10);
    expect(map.getTilt()).toBe(0);
    map.destroy();
    host.remove();
  });

  it("setTilt pitches the camera without moving view.center", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const projection = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const map = createGlyphMap(host, {
      view: { center: [20, -15], span: 40, cols: 60, rows: 30 },
      projection,
    });
    const { rotX: baseRotX, rotY: baseRotY } = projection.cameraForCenter!(20, -15);

    map.setTilt(25);
    expect(map.scene.camera.rotX).toBeCloseTo(baseRotX + 25, 10);
    expect(map.scene.camera.rotY).toBeCloseTo(baseRotY, 10);
    // view.center is untouched by a pure tilt change.
    expect(map.getView().center[0]).toBeCloseTo(20, 10);
    expect(map.getView().center[1]).toBeCloseTo(-15, 10);
    expect(map.getTilt()).toBe(25);

    map.setTilt(-25);
    expect(map.scene.camera.rotX).toBeCloseTo(baseRotX - 25, 10);
    expect(map.getView().center[0]).toBeCloseTo(20, 10);
    expect(map.getView().center[1]).toBeCloseTo(-15, 10);

    map.destroy();
    host.remove();
  });

  it("setView re-applies the current tilt on top of the new center", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const projection = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 60, rows: 30 },
      projection,
    });
    map.setTilt(15);
    map.setView({ center: [60, 40] });
    const { rotX } = projection.cameraForCenter!(60, 40);
    expect(map.scene.camera.rotX).toBeCloseTo(rotX + 15, 10);
    expect(map.getView().center[0]).toBeCloseTo(60, 10);
    expect(map.getView().center[1]).toBeCloseTo(40, 10);
    map.destroy();
    host.remove();
  });

  it("a drag under a nonzero tilt reports view.center from the UNTILTED rotation (tilt subtracted before centerForCamera)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const projection = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const map = createGlyphMap(host, {
      view: { center: [5, 5], span: 40, cols: 60, rows: 30 },
      projection,
    });
    map.setTilt(35);
    fire(host, "pointerdown", 100, 100, 1);
    fire(host, "pointermove", 130, 145, 1); // an arbitrary two-axis drag
    const reportedCenter = map.getView().center;
    const rotXAfterDrag = map.scene.camera.rotX;
    const rotYAfterDrag = map.scene.camera.rotY;
    fire(host, "pointerup", 130, 145, 1);

    // Independently reconstruct the CORRECT center from the actual
    // post-drag camera rotation using the same public `centerForCamera`
    // the widget calls — with tilt subtracted back out, per the contract.
    const [expectedLon, expectedLat] = projection.centerForCamera!(rotXAfterDrag - 35, rotYAfterDrag);
    expect(reportedCenter[0]).toBeCloseTo(expectedLon, 8);
    expect(reportedCenter[1]).toBeCloseTo(expectedLat, 8);

    // And the buggy (un-subtracted) reading would have given a genuinely
    // DIFFERENT latitude — proving this assertion is actually sensitive to
    // the subtraction, not vacuously true at this tilt.
    const [, buggyLat] = projection.centerForCamera!(rotXAfterDrag, rotYAfterDrag);
    expect(Math.abs(buggyLat - expectedLat)).toBeGreaterThan(1);

    map.destroy();
    host.remove();
  });

  it("setTilt still works on a sheet projection (camera.rotX directly, unchanged behavior)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 40, rows: 20 },
      projection: glyphMapEquirectangular(),
      tilt: 10,
    });
    expect(map.scene.camera.rotX).toBe(10);
    map.setTilt(60);
    expect(map.scene.camera.rotX).toBe(60);
    expect(map.getTilt()).toBe(60);
    map.destroy();
    host.remove();
  });
});
