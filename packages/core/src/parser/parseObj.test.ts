import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseObj } from "./parseObj";
import { parseMtl } from "./parseMtl";

// Real chicken.obj from the website gallery — this is THE feature test.
// Same pattern as voxcss's parseMagicaVoxel.test.ts which loaded tree.vox.
function loadObjFile(name: string): string {
  const filePath = resolve(__dirname, "../../../../website/public/gallery/obj", name);
  return readFileSync(filePath, "utf8");
}

describe("parseObj — real fixture (chicken.obj)", () => {
  it("parses without throwing", () => {
    const text = loadObjFile("chicken.obj");
    expect(() => parseObj(text)).not.toThrow();
  });

  it("emits a non-empty polygon list", () => {
    // chicken has 338 face lines (mostly quads) → expect lots of triangles after fan triangulation
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text);
    expect(result.polygons.length).toBeGreaterThan(300);
  });

  it("metadata.triangleCount matches polygons.length", () => {
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text);
    expect(result.metadata?.triangleCount).toBe(result.polygons.length);
  });

  it("metadata.materials lists the 5 chicken materials in first-seen order", () => {
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text);
    // chicken.mtl declares 5 hex-named materials. Hex names DON'T go into the
    // palette assignment — they short-circuit to `#${name}`. So materials[]
    // here only contains non-hex names (which is none for chicken).
    expect(result.metadata?.materials).toEqual([]);
  });

  it("hex material names map directly to colors (no palette assignment)", () => {
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text);
    // chicken.obj uses hex names like "FF9800", "F44336", "1A1A1A"
    const colors = new Set(result.polygons.map((p) => p.color));
    expect(colors.has("#FF9800")).toBe(true); // orange beak
    expect(colors.has("#F44336")).toBe(true); // red comb
    expect(colors.has("#FFFFFF")).toBe(true); // white body
  });

  it("all triangles have exactly 3 vertices, all finite", () => {
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text);
    for (const p of result.polygons) {
      expect(p.vertices).toHaveLength(3);
      for (const v of p.vertices) {
        expect(v).toHaveLength(3);
        expect(Number.isFinite(v[0])).toBe(true);
        expect(Number.isFinite(v[1])).toBe(true);
        expect(Number.isFinite(v[2])).toBe(true);
      }
    }
  });

  it("mesh fits inside targetSize=60 bbox (default)", () => {
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text);
    const all = result.polygons.flatMap((p) => p.vertices);
    const xs = all.map((v) => v[0]);
    const ys = all.map((v) => v[1]);
    const zs = all.map((v) => v[2]);
    const span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      Math.max(...zs) - Math.min(...zs),
    );
    // largest bbox dim should equal targetSize (60) within rounding
    expect(span).toBeCloseTo(60, 1);
  });

  it("default gridShift=1 keeps all vertex coords ≥ 1 (no zero edges)", () => {
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text);
    const allCoords = result.polygons.flatMap((p) => p.vertices).flat();
    expect(Math.min(...allCoords)).toBeGreaterThanOrEqual(1);
  });

  it("custom targetSize is honored (target 100 → ~100-unit bbox)", () => {
    const text = loadObjFile("chicken.obj");
    const result = parseObj(text, { targetSize: 100, gridShift: 0 });
    const all = result.polygons.flatMap((p) => p.vertices);
    const span = Math.max(
      Math.max(...all.map((v) => v[0])) - Math.min(...all.map((v) => v[0])),
      Math.max(...all.map((v) => v[1])) - Math.min(...all.map((v) => v[1])),
      Math.max(...all.map((v) => v[2])) - Math.min(...all.map((v) => v[2])),
    );
    expect(span).toBeCloseTo(100, 1);
  });

  it("end-to-end with parseMtl: real .mtl colors override hex naming", () => {
    // The MTL gives Kd 0.91 0.05 0.03 for material "F44336" (red comb).
    // parseMtl computes Math.round(0.91*255)=232, Math.round(0.05*255)=13,
    // Math.round(0.03*255)=8 → "#e80d08". When we feed that as
    // materialColors, parseObj uses "#e80d08" (not "#F44336").
    const objText = loadObjFile("chicken.obj");
    const mtlText = readFileSync(
      resolve(__dirname, "../../../../website/public/gallery/obj/chicken.mtl"),
      "utf8",
    );
    const { colors } = parseMtl(mtlText);
    expect(colors["F44336"]).toBe("#e80d08");

    const result = parseObj(objText, { materialColors: colors });
    const polygonColors = new Set(result.polygons.map((p) => p.color));
    expect(polygonColors.has("#e80d08")).toBe(true);
    // The hex name short-circuit is bypassed → no "#F44336" in output
    expect(polygonColors.has("#F44336")).toBe(false);
  });

  it("excludeObjects filter actually drops faces (mesh has 1 'o' group)", () => {
    const text = loadObjFile("chicken.obj");
    const all = parseObj(text);
    // chicken has a single object "Cube.035_Cube.034" — excluding it drops everything
    const filtered = parseObj(text, { excludeObjects: ["Cube.035_Cube.034"] });
    expect(all.polygons.length).toBeGreaterThan(0);
    expect(filtered.polygons.length).toBe(0);
  });
});

// ── Targeted feature tests with minimal inline fixtures ───────────────────

describe("parseObj — empty input", () => {
  it("empty string returns an empty ParseResult with the documented shape", () => {
    const r = parseObj("");
    expect(r.polygons).toEqual([]);
    expect(r.objectUrls).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.metadata?.triangleCount).toBe(0);
    expect(r.metadata?.sourceBytes).toBe(0);
    expect(typeof r.dispose).toBe("function");
    expect(() => r.dispose()).not.toThrow();
    expect(() => r.dispose()).not.toThrow(); // idempotent
  });

  it("vertices without faces → empty result (faces are what produces polygons)", () => {
    const r = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\n");
    expect(r.polygons).toHaveLength(0);
  });

  it("objectUrls is always empty (parseObj never mints blob URLs)", () => {
    const r = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3");
    expect(r.objectUrls).toEqual([]);
  });
});

describe("parseObj — fan triangulation", () => {
  it("a quad face becomes 2 triangles", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4`;
    const r = parseObj(obj);
    expect(r.polygons).toHaveLength(2);
    for (const p of r.polygons) expect(p.vertices).toHaveLength(3);
  });

  it("a pentagon face becomes 3 triangles", () => {
    const obj = `v 0 1 0\nv 1 0 0\nv 0.5 -1 0\nv -0.5 -1 0\nv -1 0 0\nf 1 2 3 4 5`;
    const r = parseObj(obj);
    expect(r.polygons).toHaveLength(3);
  });

  it("fan vertex (index 0) is shared across all emitted triangles", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4`;
    const r = parseObj(obj);
    // Both emitted triangles should contain vertex 0 (post-permutation).
    // We check by finding a coord-tuple that appears in both polys' vertex lists.
    const inBoth = r.polygons[0].vertices.some((v0) =>
      r.polygons[1].vertices.some(
        (v1) => v0[0] === v1[0] && v0[1] === v1[1] && v0[2] === v1[2],
      ),
    );
    expect(inBoth).toBe(true);
  });
});

describe("parseObj — face index formats (v, v/vt, v/vt/vn, v//vn)", () => {
  it("vertex-only `f 1 2 3` parses correctly", () => {
    const r = parseObj(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3`);
    expect(r.polygons).toHaveLength(1);
  });

  it("`v/vt` parses, but UVs are only attached when texture is set", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3`;
    const r = parseObj(obj);
    expect(r.polygons).toHaveLength(1);
    // No usemtl + no materialTextures → no texture → no uvs (vt is parsed but unused)
    expect(r.polygons[0].uvs).toBeUndefined();
    expect(r.polygons[0].texture).toBeUndefined();
  });

  it("`v/vt/vn` parses, vn is ignored", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1`;
    const r = parseObj(obj);
    expect(r.polygons).toHaveLength(1);
  });

  it("`v//vn` parses (no vt), uvs stay undefined", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1`;
    const r = parseObj(obj);
    expect(r.polygons).toHaveLength(1);
    expect(r.polygons[0].uvs).toBeUndefined();
  });
});

describe("parseObj — usemtl color resolution", () => {
  const mkTri = (mat: string) =>
    `v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl ${mat}\nf 1 2 3`;

  it("default color is #888888 when no usemtl is in scope", () => {
    const r = parseObj(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3`);
    expect(r.polygons[0].color).toBe("#888888");
  });

  it("custom defaultColor is honored", () => {
    const r = parseObj(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3`, {
      defaultColor: "#abcdef",
    });
    expect(r.polygons[0].color).toBe("#abcdef");
  });

  it("hex-named material → color is #<name> (no palette lookup)", () => {
    const r = parseObj(mkTri("FF9800"));
    expect(r.polygons[0].color).toBe("#FF9800");
  });

  it("non-hex material → first palette slot, recorded in metadata.materials", () => {
    const r = parseObj(mkTri("Wood"));
    expect(r.polygons[0].color).toBe("#3b82f6"); // first DEFAULT_PALETTE entry
    expect(r.metadata?.materials).toEqual(["Wood"]);
  });

  it("two non-hex materials → distinct palette slots", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nv 2 0 0\nv 2 1 0\nusemtl A\nf 1 2 3\nusemtl B\nf 4 5 6`;
    const r = parseObj(obj);
    expect(r.polygons[0].color).toBe("#3b82f6");
    expect(r.polygons[1].color).toBe("#ef4444");
    expect(r.metadata?.materials).toEqual(["A", "B"]);
  });

  it("materialColors override beats both hex-name and palette", () => {
    const r = parseObj(mkTri("FF9800"), {
      materialColors: { FF9800: "#custom" },
    });
    expect(r.polygons[0].color).toBe("#custom");
  });

  it("custom palette is used for non-hex names", () => {
    const r = parseObj(mkTri("Foo"), { palette: ["#aabbcc"] });
    expect(r.polygons[0].color).toBe("#aabbcc");
  });

  it("materialTextures attaches texture + UVs when face has vt indices", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl Tex\nf 1/1 2/2 3/3`;
    const r = parseObj(obj, { materialTextures: { Tex: "img.png" } });
    expect(r.polygons[0].texture).toBe("img.png");
    expect(r.polygons[0].uvs).toEqual([[0, 0], [1, 0], [0, 1]]);
  });

  it("materialTextures + texture but face uses vertex-only `f` → texture set, uvs undefined", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Tex\nf 1 2 3`;
    const r = parseObj(obj, { materialTextures: { Tex: "img.png" } });
    expect(r.polygons[0].texture).toBe("img.png");
    expect(r.polygons[0].uvs).toBeUndefined();
  });
});

describe("parseObj — object (`o`) filtering", () => {
  const TWO_OBJECTS = `o Model
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
o Ground
v 5 5 0
v 6 5 0
v 5 6 0
f 4 5 6`;

  it("no filter → both objects are emitted", () => {
    expect(parseObj(TWO_OBJECTS).polygons).toHaveLength(2);
  });

  it("includeObjects keeps only the named object", () => {
    expect(parseObj(TWO_OBJECTS, { includeObjects: ["Model"] }).polygons).toHaveLength(1);
  });

  it("excludeObjects drops the named object", () => {
    expect(parseObj(TWO_OBJECTS, { excludeObjects: ["Ground"] }).polygons).toHaveLength(1);
  });

  it("faces before any `o` are kept by default but dropped when includeObjects is set", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\no Named\nv 0 0 1\nv 1 0 1\nv 0 1 1\nf 4 5 6`;
    expect(parseObj(obj).polygons).toHaveLength(2);
    expect(parseObj(obj, { includeObjects: ["Named"] }).polygons).toHaveLength(1);
  });
});

describe("parseObj — bbox ignores unreferenced vertices", () => {
  it("an excluded scenery object's verts don't inflate the bbox", () => {
    // The bbox-from-used-verts feature: when an object is excluded, its
    // vertices shouldn't count toward the targetSize fit calculation. We
    // verify the FIRST polygon (the kept "Model" triangle) ends up bigger
    // when the giant ground plane is excluded vs included.
    const obj = `o Model
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
o Ground
v -1000 -1000 0
v 1000 -1000 0
v 1000 1000 0
v -1000 1000 0
f 4 5 6 7`;
    const withGround = parseObj(obj, { targetSize: 60, gridShift: 0 });
    const withoutGround = parseObj(obj, {
      targetSize: 60,
      gridShift: 0,
      excludeObjects: ["Ground"],
    });
    // First polygon in both is the Model triangle. Measure its intrinsic
    // size — max edge length between its vertices (NOT distance from origin,
    // which would inflate when the triangle is offset by gridShift / large
    // bbox scaling).
    const triEdgeMax = (poly: { vertices: number[][] }) => {
      const v = poly.vertices;
      const dist = (a: number[], b: number[]) =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      return Math.max(dist(v[0], v[1]), dist(v[1], v[2]), dist(v[0], v[2]));
    };
    // With ground in bbox: model triangle gets squished to ~1/2000 of target.
    // Without ground: model triangle fills target.
    expect(triEdgeMax(withoutGround.polygons[0])).toBeGreaterThan(
      triEdgeMax(withGround.polygons[0]) * 100,
    );
  });
});

describe("parseObj — degenerate geometry", () => {
  it("a triangle with two coincident vertices is dropped", () => {
    const obj = `v 0 0 0\nv 0 0 0\nv 1 0 0\nf 1 2 3`;
    expect(parseObj(obj).polygons).toHaveLength(0);
  });

  it("a face referencing an out-of-bounds vertex is dropped (no crash)", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99`;
    expect(parseObj(obj).polygons).toHaveLength(0);
  });

  it("an all-coincident-vertices mesh produces no polygons (no crash on scale=0)", () => {
    const obj = `v 0 0 0\nv 0 0 0\nv 0 0 0\nf 1 2 3`;
    expect(parseObj(obj).polygons).toHaveLength(0);
  });

  it("a quad with 2 coincident verts → fan emits 1 valid + 1 degenerate; degenerate dropped", () => {
    const obj = `v 0 0 0\nv 1 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3 4`;
    const r = parseObj(obj);
    // Fan (1,2,3) is degenerate; (1,3,4) is valid → expect 1 polygon
    expect(r.polygons).toHaveLength(1);
  });
});

describe("parseObj — comment & blank-line handling", () => {
  it("# comments are skipped; blank lines are skipped", () => {
    const obj = `# header comment\nv 0 0 0\n\n# inline comment\nv 1 0 0\nv 0 1 0\n\nf 1 2 3\n`;
    expect(parseObj(obj).polygons).toHaveLength(1);
  });
});
