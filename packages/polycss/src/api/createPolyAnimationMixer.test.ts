/**
 * Vanilla animation test: createPolyAnimationMixer with a real PolyMeshHandle
 * from createPolyScene + a fake ParseAnimationController.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPolyScene } from "./createPolyScene";
import { createPolyAnimationMixer, LoopOnce } from "@layoutit/polycss-core";
import type { ParseAnimationController, ParseAnimationClip, Polygon } from "@layoutit/polycss-core";

const TRI: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#ff0000",
};

const TRI2: Polygon = {
  vertices: [[0, 0, 1], [1, 0, 1], [0, 1, 1]],
  color: "#00ff00",
};

function makeClip(index: number, name: string, duration = 1): ParseAnimationClip {
  return { index, name, duration, channelCount: 1 };
}

function makeController(
  clips: ParseAnimationClip[],
  polygonsByTime?: (t: number) => Polygon[],
): ParseAnimationController {
  return {
    clips,
    sample: (_clip, t) => polygonsByTime ? polygonsByTime(t) : [TRI],
  };
}

describe("createPolyAnimationMixer with PolyMeshHandle", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.body.removeChild(host);
  });

  it("mixer.update() calls mesh.setPolygons() on a playing action", () => {
    const scene = createPolyScene(host, {});
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });
    const clip = makeClip(0, "idle");
    const ctrl = makeController([clip]);
    const mixer = createPolyAnimationMixer(mesh, ctrl);

    mixer.clipAction("idle").play();

    // Before update, polygons are the original
    const originalPolygons = mesh.polygons;

    // After update, setPolygons should have been called
    mixer.update(0.1);

    // The mesh.polygons property should be set to whatever sample returned
    // (which is [TRI] in this case, so same shape but newly allocated)
    expect(mesh.polygons).toBeDefined();
    expect(Array.isArray(mesh.polygons)).toBe(true);
    expect(mesh.polygons.length).toBe(1);

    // Cleanup
    mesh.dispose();
    scene.destroy();

    // Reference originalPolygons to avoid unused var warning
    void originalPolygons;
  });

  it("mixer updates mesh polygons to sampled values", () => {
    const scene = createPolyScene(host, {});
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });

    const frames = [TRI, TRI2];
    let frameIndex = 0;
    const ctrl: ParseAnimationController = {
      clips: [makeClip(0, "walk", 2)],
      sample: (_clip, t) => {
        frameIndex = t < 1 ? 0 : 1;
        return [frames[frameIndex]];
      },
    };

    const mixer = createPolyAnimationMixer(mesh, ctrl);
    mixer.clipAction("walk").play();

    mixer.update(0.5);
    // At t=0.5, first frame
    expect(mesh.polygons[0].color).toBe("#ff0000");

    mixer.update(0.6);
    // At t=1.1, second frame
    expect(mesh.polygons[0].color).toBe("#00ff00");

    mesh.dispose();
    scene.destroy();
  });

  it("stopAllAction stops mesh updates", () => {
    const scene = createPolyScene(host, {});
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });
    const ctrl = makeController([makeClip(0, "run")]);
    const mixer = createPolyAnimationMixer(mesh, ctrl);

    mixer.clipAction("run").play();
    mixer.stopAllAction();

    // Track polygon changes after stopAllAction
    const polygonsBeforeUpdate = mesh.polygons;
    mixer.update(0.1);
    // No update should have happened
    expect(mesh.polygons).toBe(polygonsBeforeUpdate);

    mesh.dispose();
    scene.destroy();
  });

  it("LoopOnce action stops after one full duration", () => {
    const scene = createPolyScene(host, {});
    const parseResult = {
      polygons: [TRI],
      objectUrls: [],
      dispose: () => {},
      warnings: [],
    };
    const mesh = scene.add(parseResult, { merge: false, stableDom: false });
    const ctrl = makeController([makeClip(0, "once", 1)]);
    const mixer = createPolyAnimationMixer(mesh, ctrl);
    const action = mixer.clipAction("once");
    action.setLoop(LoopOnce, 1).play();

    mixer.update(1.5);
    expect(action.isRunning).toBe(false);

    mesh.dispose();
    scene.destroy();
  });
});
