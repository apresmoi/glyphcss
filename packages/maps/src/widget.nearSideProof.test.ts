import { expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";

it("memoizes origin depth and invalidates on in-place target and matrix changes", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const p = glyphMapGlobe();
  const map = createGlyphMap(host, { view: { center: [0, 0], span: 1, cols: 40, rows: 20 }, projection: p, layers: [] });
  try {
    await map.idle();
    const camera = map.scene.camera, project = camera.project;
    const spy = vi.spyOn(camera, "project");
    const visible = p.visible!;
    let checks = 0;
    p.visible = (world, depth) => {
      checks++;
      expect(depth([0, 0, 0])).toBe(project([0, 0, 0], 40, 20, 2)[2]);
      return visible(world, depth);
    };
    const probe = () => {
      spy.mockClear();
      for (let i = 0; i < 5; i++) map.project([0.01 * i, 0]);
      const origins = spy.mock.calls.filter(([v]) => v[0] === 0 && v[1] === 0 && v[2] === 0);
      expect(origins).toHaveLength(1);
    };
    probe();
    camera.target[0] += 0.5; probe();
    camera.useMat = true; camera.mat = [1, 0, 0, 0, 1, 0, 0, 0, 1]; probe();
    camera.mat[6] = 0.3; probe();
    expect(checks).toBe(20);
    p.visible = (world, depth) => depth(world) >= 0;
    spy.mockImplementation((v, ...args) => {
      if (v[0] === 0 && v[1] === 0 && v[2] === 0) throw new Error("unrequested origin projection");
      return project(v, ...args);
    });
    expect(() => map.project([0.01, 0])).not.toThrow();
  } finally { map.destroy(); host.remove(); vi.restoreAllMocks(); }
});
