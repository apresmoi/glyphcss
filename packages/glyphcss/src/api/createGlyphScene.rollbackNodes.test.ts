import { expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import { ensureGlyphAtlasFontFaceStyles } from "../styles/styles";

for (const encoding of ["plain", "spans", "atlas"] as const) {
  it(`restores ${encoding} child identities, bytes and styles without serializing on commit`, async () => {
    const host = document.createElement("div");
    document.body.append(host);
    await ensureGlyphAtlasFontFaceStyles(document);
    const camera = createGlyphOrthographicCamera({ zoom: 90 });
    const scene = createGlyphScene(host, {
      cols: 32, rows: 16, camera, mode: "solid", doubleSided: true,
      useColors: encoding !== "plain", colorEncoding: encoding === "atlas" ? "atlas" : "spans",
      atlasPalette: ["#802020"],
    });
    const polygons = [{ vertices: [[-2, -2, 0], [-2, 2, 0], [2, 2, 0], [2, -2, 0]] as [number, number, number][], color: "#802020" }];
    scene.add(polygons);
    scene.add(polygons, { density: 2 });
    const hotspot = scene.addHotspot({ id: "rollback", at: [1, 1, 0] });
    await Promise.resolve(); await Promise.resolve();
    scene.rerender();
    const pres = [...host.querySelectorAll("pre")];
    expect(pres.length).toBe(2);
    const states = pres.map((pre) => ({ html: pre.innerHTML, children: [...pre.childNodes], style: pre.getAttribute("style") }));
    expect(states.every((state) => state.children.length > 0)).toBe(true);
    const hotspotStyle = hotspot.el.getAttribute("style");
    const html = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
    const text = Object.getOwnPropertyDescriptor(Element.prototype, "textContent")!;
    for (const pre of pres) {
      Object.defineProperty(pre, "innerHTML", { configurable: true, get() { throw Error("serialized HTML"); }, set: html.set });
      Object.defineProperty(pre, "textContent", { configurable: true, get() { throw Error("serialized text"); }, set: text.set });
    }
    try {
      camera.rotY += 25;
      for (const stage of ["commit-style", "commit-insert", "commit-remove"]) {
        globalThis.__glyphRenderStage = (s) => { if (s === stage) throw Error(stage); };
        expect(() => scene.rerender()).toThrow(stage);
        delete globalThis.__glyphRenderStage;
        for (let i = 0; i < pres.length; i++) {
          const pre = pres[i]!, state = states[i]!;
          expect(html.get!.call(pre)).toBe(state.html);
          expect(pre.getAttribute("style")).toBe(state.style);
          expect(pre.childNodes.length).toBe(state.children.length);
          state.children.forEach((child, j) => expect(pre.childNodes[j]).toBe(child));
        }
        expect(hotspot.el.getAttribute("style")).toBe(hotspotStyle);
      }
      expect(() => scene.rerender()).not.toThrow();
      expect(html.get!.call(pres[0])).not.toBe(states[0]!.html);
    } finally {
      delete globalThis.__glyphRenderStage;
      for (const pre of pres) { Reflect.deleteProperty(pre, "innerHTML"); Reflect.deleteProperty(pre, "textContent"); }
      scene.destroy(); host.remove();
    }
  });
}
