import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { rotateVec3 } from "@glyphcss/core";
import { parseFont } from "./parseFont";
import { composeText } from "./composeText";

function loadFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, "../test/fixtures", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const roboto = parseFont(loadFixture("Roboto-Bold.ttf"));

function bounds(polys: ReturnType<typeof composeText>) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p.vertices) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

describe("composeText", () => {
  it("renders a single line like textPolygons", () => {
    expect(composeText(roboto, "Poly").length).toBeGreaterThan(0);
  });

  it("stacks multiple lines taller (world X = screen-down)", () => {
    const one = bounds(composeText(roboto, "Poly"));
    const three = bounds(composeText(roboto, "Poly\nCSS\nText"));
    expect(three.maxX - three.minX).toBeGreaterThan((one.maxX - one.minX) * 2);
  });

  it("splits on \\n into independent lines", () => {
    const polys = composeText(roboto, "AB\nCD");
    expect(polys.length).toBeGreaterThan(0);
  });

  it("underline and strike add decoration polygons", () => {
    const plain = composeText(roboto, "Hi").length;
    const underlined = composeText(roboto, "Hi", { underline: true }).length;
    const struck = composeText(roboto, "Hi", { strike: true }).length;
    expect(underlined).toBeGreaterThan(plain);
    expect(struck).toBeGreaterThan(plain);
  });

  it("alignment shifts the short line's horizontal position", () => {
    const sumY = (polys: ReturnType<typeof composeText>) =>
      polys.reduce((s, p) => s + p.vertices.reduce((t, v) => t + v[1], 0), 0);
    const left = sumY(composeText(roboto, "wide line\nx", { align: "left" }));
    const right = sumY(composeText(roboto, "wide line\nx", { align: "right" }));
    // The short line slides right, so the total of world-Y (screen-right) grows.
    expect(right).toBeGreaterThan(left);
  });

  it("arc warp spreads the text wider than unwarped", () => {
    const flat = bounds(composeText(roboto, "WordArt"));
    const arced = bounds(composeText(roboto, "WordArt", { warp: { shape: "arc", amount: 0.8 } }));
    // The arc bows letters up/down, so the vertical (world X) extent grows.
    expect(arced.maxX - arced.minX).toBeGreaterThan(flat.maxX - flat.minX);
  });

  it("warp shapes change the geometry vs none", () => {
    const none = composeText(roboto, "Hi", { warp: { shape: "none" } });
    const wave = composeText(roboto, "Hi", { warp: { shape: "wave", amount: 0.7 } });
    const sum = (ps: ReturnType<typeof composeText>) =>
      ps.reduce((s, p) => s + p.vertices.reduce((t, v) => t + v[0] + v[1], 0), 0);
    expect(Math.abs(sum(none) - sum(wave))).toBeGreaterThan(1);
  });

  it("larger lineHeight increases vertical extent", () => {
    const tight = bounds(composeText(roboto, "A\nB", { lineHeight: 1 }));
    const loose = bounds(composeText(roboto, "A\nB", { lineHeight: 2 }));
    expect(loose.maxX - loose.minX).toBeGreaterThan(tight.maxX - tight.minX);
  });

  // ── regression: holes must never break ──────────────────────────────────
  it("never simplifies a glyph with holes, so the counter can't collapse", () => {
    // 'O' has a counter; its geometry must be identical at any simplify level.
    const exact = composeText(roboto, "O", { simplify: 0 });
    const coarse = composeText(roboto, "O", { simplify: 8 });
    expect(coarse.length).toBe(exact.length);
  });

  it("still simplifies hole-less glyphs (poly reduction works)", () => {
    const exact = composeText(roboto, "M", { simplify: 0 });
    const coarse = composeText(roboto, "M", { simplify: 8 });
    expect(coarse.length).toBeLessThan(exact.length);
  });

  it("round/bevel hold their counters too (inset never overruns the hole)", () => {
    for (const edge of ["round", "bevel"] as const) {
      expect(composeText(roboto, "o", { profile: { edge } }).length).toBeGreaterThan(0);
      expect(composeText(roboto, "B", { profile: { edge }, depth: 30 }).length).toBeGreaterThan(0);
    }
  });

  // ── regression: scale / merge / layered ─────────────────────────────────
  it("horizontal scale widens the run", () => {
    const a = bounds(composeText(roboto, "AV"));
    const b = bounds(composeText(roboto, "AV", { scale: [2, 1] }));
    expect(b.maxY - b.minY).toBeGreaterThan((a.maxY - a.minY) * 1.6);
  });

  it("vertical scale heightens the glyphs", () => {
    const a = bounds(composeText(roboto, "A"));
    const b = bounds(composeText(roboto, "A", { scale: [1, 2] }));
    expect(b.maxX - b.minX).toBeGreaterThan((a.maxX - a.minX) * 1.6);
  });

  it("cap triangles merge into convex polygons (fewer nodes, no concavity)", () => {
    const polys = composeText(roboto, "Poly", { depth: 20 });
    // Merge happened: some caps are now N-gons, not bare triangles.
    expect(polys.some((p) => p.vertices.length > 3)).toBe(true);
    // Every emitted polygon must stay convex — a concave merge would render as
    // a self-overlapping leaf. Check each polygon in its own plane.
    const isConvex3d = (vs: readonly [number, number, number][]): boolean => {
      const n = vs.length;
      if (n < 3) return false;
      const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const cross = (a: number[], b: number[]) => [
        a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
      ];
      let ref: number[] | null = null;
      for (let i = 0; i < n; i++) {
        const c = cross(sub(vs[(i + 1) % n], vs[i]), sub(vs[(i + 2) % n], vs[(i + 1) % n]));
        if (Math.hypot(...c) < 1e-6) continue; // collinear corner
        if (!ref) ref = c;
        else if (ref[0] * c[0] + ref[1] * c[1] + ref[2] * c[2] < 0) return false; // sign flip
      }
      return true;
    };
    expect(polys.every((p) => isConvex3d(p.vertices))).toBe(true);
  });

  it("flat shadow (depth 0) offsets a recolored back layer", () => {
    const polys = composeText(roboto, "o", { depth: 0, faces: { front: { color: "#ff0000" }, back: { color: "#00ff00", offset: [12, -12] } } });
    const colors = new Set(polys.map((p) => p.color));
    expect(colors.has("#ff0000")).toBe(true); // front
    expect(colors.has("#00ff00")).toBe(true); // offset back
  });

  // ── regression: WordArt fills / outline / flat-layer shadow ──────────────
  it("a face texture UV-maps the front cap across the whole word", () => {
    const tex = "data:image/png;base64,AAAA";
    const polys = composeText(roboto, "Hi", { faces: { front: { texture: tex } } });
    const faces = polys.filter((p) => p.texture === tex);
    expect(faces.length).toBeGreaterThan(0);
    // Every textured face carries one UV per vertex…
    expect(faces.every((p) => p.uvs?.length === p.vertices.length)).toBe(true);
    // …and the UVs span the whole word (reach both extremes of 0..1).
    const us = faces.flatMap((p) => p.uvs!.map((uv) => uv[0]));
    expect(Math.min(...us)).toBeLessThan(0.05);
    expect(Math.max(...us)).toBeGreaterThan(0.95);
    // Walls stay untextured.
    expect(polys.some((p) => !p.texture)).toBe(true);
  });

  it("solid (no faceTexture) leaves the face untextured but still authors UVs", () => {
    const polys = composeText(roboto, "Hi");
    // No texture is applied…
    expect(polys.every((p) => !p.texture)).toBe(true);
    // …but every polygon still carries a UV per vertex, so surface-locked
    // effects (`space: "auto"`) resolve the authored, mesh-local UV basis
    // instead of falling back to the generated world-surface mapping.
    expect(polys.every((p) => p.uvs?.length === p.vertices.length)).toBe(true);
  });

  it("outline adds a halo silhouette in the outline color", () => {
    const plain = composeText(roboto, "o").length;
    const polys = composeText(roboto, "o", { outline: { color: "#123456", width: 3 } });
    expect(polys.length).toBeGreaterThan(plain);
    expect(polys.some((p) => p.color === "#123456")).toBe(true);
  });

  it("textures each face independently (front / sides / back)", () => {
    const polys = composeText(roboto, "Hi", {
      depth: 20,
      faces: {
        front: { texture: "/t/dirt.svg" },
        sides: { texture: "/t/wood.svg" },
        back: { texture: "/t/brick.svg" },
      },
    });
    const urls = new Set(polys.map((p) => p.texture).filter(Boolean));
    expect(urls.has("/t/dirt.svg")).toBe(true);  // front cap
    expect(urls.has("/t/brick.svg")).toBe(true); // back cap
    expect(urls.has("/t/wood.svg")).toBe(true);  // side walls
  });

  it("tiling repeats the texture (UV > 1 + repeat wrap) vs stretch", () => {
    const stretched = composeText(roboto, "WWWW", { faces: { front: { texture: "/t/dirt.svg" } } });
    const tiled = composeText(roboto, "WWWW", { faces: { front: { texture: "/t/dirt.svg", tile: 20 } } });
    const maxU = (ps: ReturnType<typeof composeText>) =>
      Math.max(...ps.filter((p) => p.texture).flatMap((p) => p.uvs!.map((uv) => uv[0])));
    expect(maxU(stretched)).toBeLessThanOrEqual(1.0001); // normalized to word
    expect(maxU(tiled)).toBeGreaterThan(1.5);            // repeats across the word
    expect(tiled.find((p) => p.texture)?.textureWrap?.s).toBe("repeat");
  });

  it("axial faces band the solid by depth (front cap / body / back cap)", () => {
    const polys = composeText(roboto, "o", {
      depth: 30,
      faces: { front: { color: "#ff0000" }, sides: { color: "#00ff00" }, back: { color: "#0000ff" } },
    });
    const front = polys.filter((p) => p.color === "#ff0000");
    const side = polys.filter((p) => p.color === "#00ff00");
    const back = polys.filter((p) => p.color === "#0000ff");
    expect(front.length).toBeGreaterThan(0); // front cap (t≈0)
    expect(side.length).toBeGreaterThan(0);  // body walls (t≈0.5)
    expect(back.length).toBeGreaterThan(0);  // back cap (t≈1)
    // The front cap sits at the most-forward z; the back cap at the most-back.
    const frontZ = Math.max(...front.flatMap((p) => p.vertices.map((v) => v[2])));
    const backZ = Math.min(...back.flatMap((p) => p.vertices.map((v) => v[2])));
    expect(frontZ).toBeGreaterThan(backZ);
  });

  it("omitting `sides` makes the front meet the back (no side band)", () => {
    const withSide = composeText(roboto, "o", { depth: 30, faces: { front: { color: "#ff0000" }, sides: { color: "#00ff00" }, back: { color: "#0000ff" } } });
    const noSide = composeText(roboto, "o", { depth: 30, faces: { front: { color: "#ff0000" }, back: { color: "#0000ff" } } });
    expect(withSide.some((p) => p.color === "#00ff00")).toBe(true);   // has a side band
    expect(noSide.some((p) => p.color === "#00ff00")).toBe(false);    // none
    // Same geometry, but the side band's polys are now front/back instead.
    expect(noSide.length).toBe(withSide.length);
    expect(noSide.filter((p) => p.color !== "#00ff00").length).toBeGreaterThan(withSide.filter((p) => p.color !== "#00ff00").length);
  });

  it("a face set to `false` is covered by its neighbour (no hole, no own color)", () => {
    const faces = { front: { color: "#ff0000" }, sides: { color: "#00ff00" }, back: { color: "#0000ff" } };
    const full = composeText(roboto, "o", { depth: 20, faces });
    const noBack = composeText(roboto, "o", { depth: 20, faces: { ...faces, back: false } });
    // Geometry is intact (same polygon count → no hole at the back)…
    expect(noBack.length).toBe(full.length);
    // …the back has no color of its own…
    expect(noBack.some((p) => p.color === "#0000ff")).toBe(false);
    // …and the back cap is covered by the nearest active face (the side).
    expect(noBack.filter((p) => p.color === "#00ff00").length).toBeGreaterThan(full.filter((p) => p.color === "#00ff00").length);
  });

  it("an N-stop array distributes materials down the axis", () => {
    const polys = composeText(roboto, "I", {
      depth: 40,
      faces: [
        { at: 0, color: "#111111" },
        { at: 0.5, color: "#777777" },
        { at: 1, color: "#eeeeee" },
      ],
    });
    const colors = new Set(polys.map((p) => p.color));
    expect(colors.has("#111111")).toBe(true);
    expect(colors.has("#777777")).toBe(true);
    expect(colors.has("#eeeeee")).toBe(true);
  });

  it("custom cubic-bezier profile differs from a round edge", () => {
    // Pin equal segment counts so the comparison is apples-to-apples (the round
    // default is otherwise adaptive, while custom keeps a fixed default).
    const round = composeText(roboto, "o", { depth: 24, profile: { edge: "round", segments: 6 } });
    const custom = composeText(roboto, "o", { depth: 24, profile: { curve: [0.1, 0.9, 0.2, 1], segments: 6 } });
    const hash = (ps: ReturnType<typeof composeText>) => ps.map((p) => p.vertices.flat().join()).join("|");
    expect(round.length).toBe(custom.length);
    expect(hash(round)).not.toBe(hash(custom));
  });

  it("round edges pick fewer segments by default than a forced high count", () => {
    // The default round segment count is adaptive (small bevel → fewer rings),
    // so it never exceeds — and here undercuts — an explicit high count.
    const auto = composeText(roboto, "WordArt", { depth: 20, profile: { edge: "round" } });
    const dense = composeText(roboto, "WordArt", { depth: 20, profile: { edge: "round", segments: 6 } });
    expect(auto.length).toBeLessThan(dense.length);
    // An explicit count is always honored verbatim.
    const exact = composeText(roboto, "WordArt", { depth: 20, profile: { edge: "round", segments: 6 } });
    expect(dense.length).toBe(exact.length);
  });

  it("flat (depth 0) drops the side walls vs an extruded depth", () => {
    const walled = composeText(roboto, "o", { depth: 12, faces: { back: { color: "#00ff00" } } });
    const flat = composeText(roboto, "o", { depth: 0, faces: { back: { color: "#00ff00", offset: [10, -10] } } });
    expect(flat.length).toBeLessThan(walled.length);
    expect(flat.some((p) => p.color === "#00ff00")).toBe(true); // shadow layer kept
  });

  // ── kerning / baseline layout ────────────────────────────────────────────
  it("kerns a known tight pair (AV) below its unkerned advance sum", () => {
    // Ground truth from the font itself, independent of composeText: the
    // "AV" pair carries a real GPOS kerning rule, and it tightens the pair.
    const kernValue = roboto.kerning("A".codePointAt(0)!, "V".codePointAt(0)!);
    expect(kernValue).toBeLessThan(0);

    // The `underline` bar is drawn from `startX` to `startX + line.width`
    // (see composeText's `barShape` call), so its span *is* the measured
    // line width — a way to read the internal advance sum back out of the
    // emitted geometry instead of asserting on private state.
    const size = 100;
    const scale = size / roboto.unitsPerEm;
    const unkernedWidth =
      (roboto.glyph("A".codePointAt(0)!).advanceWidth + roboto.glyph("V".codePointAt(0)!).advanceWidth) * scale;

    const polys = composeText(roboto, "AV", { size, underline: true });
    const b = bounds(polys);
    const kernedWidth = b.maxY - b.minY; // world Y = plane x = the horizontal run

    expect(kernedWidth).toBeLessThan(unkernedWidth);
    // The shrink should match the kerning adjustment itself, not just be
    // some other, unrelated width change.
    expect(unkernedWidth - kernedWidth).toBeCloseTo(-kernValue * scale, 1);
  });

  it("drops a descender below the baseline instead of bottom-snapping", () => {
    // "n" is flat-bottomed and sits on the baseline; "o" has only the small
    // round-letter overshoot type designers add for optical alignment; "g"
    // has a real descender that must droop well below both. World X is
    // screen-down (see extrude.ts), so a larger maxX is lower on screen.
    const n = bounds(composeText(roboto, "n"));
    const o = bounds(composeText(roboto, "o"));
    const g = bounds(composeText(roboto, "g"));

    const descenderDrop = g.maxX - n.maxX;
    const overshoot = o.maxX - n.maxX;

    expect(descenderDrop).toBeGreaterThan(0);
    // If glyphs were bottom-snapped into a shared box instead of using their
    // own font-space y, the descender's lowest point would land on the same
    // line as every other glyph's — indistinguishable from "n"'s. It must
    // instead drop well past even a round letter's normal overshoot.
    expect(descenderDrop).toBeGreaterThan(overshoot * 5);
  });

  // ── regression: solid-color text UVs are surface-locked, not world-anchored ──
  it("authored UVs stay fixed as the mesh rotates, while world-space vertices don't", () => {
    // Solid color, no faceTexture — the WordArt repro config (matrix rain over
    // a flat-colored word). A `<GlyphMesh rotation={[rx, ry, rz]}>` applies
    // `rotateVec3` to each local vertex before the camera projects it; UVs are
    // untouched by that transform because they're authored in the glyph's own
    // 2D type-plane space upstream of it. A surface-locked effect resolving
    // `space: "auto"` reads those UVs, so its flow direction is invariant
    // under mesh rotation — the opposite invariant from the old fallback
    // (generated world-surface coordinates derived from rotated vertices),
    // which is what let the render mesh slide underneath a fixed-direction
    // rain instead of the rain turning with the glyph faces.
    const polysAtRest = composeText(roboto, "Glyph");
    expect(polysAtRest.some((p) => p.uvs !== undefined)).toBe(true);

    const rotate = (rx: number, ry: number, rz: number) => polysAtRest.map((p) => ({
      ...p,
      vertices: p.vertices.map((v) => rotateVec3(v, rx, ry, rz)),
    }));
    const restPose = rotate(0, 0, 0); // identity, still exercises the same mapping
    const spunPose = rotate(0, 47, 12); // an arbitrary later frame of a spinning mesh

    expect(polysAtRest.length).toBe(restPose.length);
    expect(restPose.length).toBe(spunPose.length);

    let uvInvariant = true;
    let worldVaries = false;
    for (let i = 0; i < polysAtRest.length; i++) {
      const rest = restPose[i]!;
      const spun = spunPose[i]!;
      // The authored UV is identical at both rotations — it never depended on
      // the vertex positions the rotation touched.
      if (JSON.stringify(rest.uvs) !== JSON.stringify(spun.uvs)) uvInvariant = false;
      // The world-space vertices — the only inputs the old generated-surface
      // fallback had to work with — genuinely differ once the mesh has turned.
      if (JSON.stringify(rest.vertices) !== JSON.stringify(spun.vertices)) worldVaries = true;
    }
    expect(uvInvariant).toBe(true);
    expect(worldVaries).toBe(true);
  });
});
