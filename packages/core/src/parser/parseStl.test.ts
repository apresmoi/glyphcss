import { describe, expect, it } from "vitest";
import { parseStl } from "./parseStl";

type TestVec3 = [number, number, number];

const ASCII_TRIANGLE = [
  "solid one",
  "  facet normal 0 0 1",
  "    outer loop",
  "      vertex 0 0 0",
  "      vertex 1 0 0",
  "      vertex 0 1 0",
  "    endloop",
  "  endfacet",
  "endsolid one",
  "",
].join("\n");

function buildBinaryStl(options?: {
  headerText?: string;
  headerBytes?: Uint8Array;
  normal?: [number, number, number];
  vertices?: [[number, number, number], [number, number, number], [number, number, number]];
  attributeByteCount?: number;
  triangles?: Array<{
    normal?: [number, number, number];
    vertices?: [[number, number, number], [number, number, number], [number, number, number]];
    attributeByteCount?: number;
  }>;
}): ArrayBuffer {
  const triangles = options?.triangles ?? [{
    normal: options?.normal,
    vertices: options?.vertices,
    attributeByteCount: options?.attributeByteCount,
  }];
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  if (options?.headerBytes) {
    bytes.set(options.headerBytes.slice(0, 80), 0);
  } else {
    const header = options?.headerText ?? "binary stl";
    for (let i = 0; i < Math.min(80, header.length); i += 1) {
      bytes[i] = header.charCodeAt(i);
    }
  }
  view.setUint32(80, triangles.length, true);

  let offset = 84;
  for (const triangle of triangles) {
    const normal = triangle.normal ?? [0, 0, 1];
    const vertices = triangle.vertices ?? [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    for (const value of normal) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    for (const vertex of vertices) {
      for (const value of vertex) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    view.setUint16(offset, triangle.attributeByteCount ?? 0, true);
    offset += 2;
  }
  return buf;
}

function magicsHeader(r: number, g: number, b: number, a = 255): Uint8Array {
  const bytes = new Uint8Array(80);
  const prefix = "creator COLOR=";
  for (let index = 0; index < prefix.length; index += 1) {
    bytes[index] = prefix.charCodeAt(index);
  }
  bytes[prefix.length] = r;
  bytes[prefix.length + 1] = g;
  bytes[prefix.length + 2] = b;
  bytes[prefix.length + 3] = a;
  return bytes;
}

function subVec(a: TestVec3, b: TestVec3): TestVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossVec(a: TestVec3, b: TestVec3): TestVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotVec(a: TestVec3, b: TestVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function scaleVec(v: TestVec3, scale: number): TestVec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale];
}

function triangleNormal(vertices: [TestVec3, TestVec3, TestVec3]): TestVec3 {
  const normal = crossVec(subVec(vertices[1], vertices[0]), subVec(vertices[2], vertices[0]));
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return [normal[0] / len, normal[1] / len, normal[2] / len];
}

function asciiFacet(vertices: [TestVec3, TestVec3, TestVec3], normal = triangleNormal(vertices)): string[] {
  return [
    `facet normal ${normal[0]} ${normal[1]} ${normal[2]}`,
    "outer loop",
    `vertex ${vertices[0][0]} ${vertices[0][1]} ${vertices[0][2]}`,
    `vertex ${vertices[1][0]} ${vertices[1][1]} ${vertices[1][2]}`,
    `vertex ${vertices[2][0]} ${vertices[2][1]} ${vertices[2][2]}`,
    "endloop",
    "endfacet",
  ];
}

function asciiSolid(name: string, facets: string[][]): string {
  return [`solid ${name}`, ...facets.flat(), `endsolid ${name}`, ""].join("\n");
}

function parsedSignedVolume(polygons: ReturnType<typeof parseStl>["polygons"]): number {
  let volume = 0;
  for (const polygon of polygons) {
    const [a, b, c] = polygon.vertices as [TestVec3, TestVec3, TestVec3];
    volume += dotVec(a, crossVec(b, c)) / 6;
  }
  return volume;
}

function parsedNormal(polygon: ReturnType<typeof parseStl>["polygons"][number]): TestVec3 {
  return triangleNormal(polygon.vertices as [TestVec3, TestVec3, TestVec3]);
}

describe("parseStl", () => {
  it("parses an ASCII triangle", () => {
    const result = parseStl(ASCII_TRIANGLE);

    expect(result.polygons).toHaveLength(1);
    expect(result.polygons[0].vertices).toEqual([
      [1, 1, 1],
      [61, 1, 1],
      [1, 61, 1],
    ]);
    expect(result.polygons[0].color).toBe("#888888");
    expect(result.metadata?.triangleCount).toBe(1);
    expect(result.metadata?.sourceBytes).toBe(ASCII_TRIANGLE.length);
    expect(result.metadata?.meshes).toEqual(["one"]);
    expect(result.metadata?.stlSolids).toEqual([{ name: "one", start: 0, count: 1 }]);
    expect(result.metadata?.stlTopology).toEqual({
      componentCount: 1,
      repairedTriangleCount: 0,
      outwardComponentCount: 0,
      suppliedNormalComponentCount: 0,
      inconsistentSharedEdgeCount: 0,
      nonManifoldSharedEdgeCount: 0,
    });
    expect(result.warnings).toEqual([]);
  });

  it("parses a binary triangle", () => {
    const buf = buildBinaryStl();
    const result = parseStl(buf);

    expect(result.polygons).toHaveLength(1);
    expect(result.polygons[0].vertices).toEqual([
      [1, 1, 1],
      [61, 1, 1],
      [1, 61, 1],
    ]);
    expect(result.metadata?.sourceBytes).toBe(buf.byteLength);
    expect(result.metadata?.stlHeader).toBe("binary stl");
    expect(result.metadata?.meshes).toBeUndefined();
  });

  it("parses binary STL even when its header starts with solid", () => {
    const result = parseStl(buildBinaryStl({ headerText: "solid binary header" }));
    expect(result.polygons).toHaveLength(1);
    expect(result.metadata?.stlHeader).toBe("solid binary header");
    expect(result.metadata?.meshes).toBeUndefined();
  });

  it("parses binary STL with an overdeclared triangle count", () => {
    const buf = buildBinaryStl();
    new DataView(buf).setUint32(80, 2, true);

    const result = parseStl(buf);

    expect(result.polygons).toHaveLength(1);
    expect(result.warnings).toContain(
      "parseStl: binary STL declared 2 triangles but contains 1 complete triangle record",
    );
  });

  it("parses binary STL with trailing bytes", () => {
    const source = new Uint8Array(buildBinaryStl());
    const withTrailingBytes = new Uint8Array(source.byteLength + 3);
    withTrailingBytes.set(source);
    withTrailingBytes.set([1, 2, 3], source.byteLength);

    const result = parseStl(withTrailingBytes);

    expect(result.polygons).toHaveLength(1);
    expect(result.warnings).toContain("parseStl: ignored 3 trailing binary bytes");
  });

  it("supports the Magics binary STL color extension", () => {
    const result = parseStl(buildBinaryStl({
      headerBytes: magicsHeader(10, 20, 30),
      triangles: [
        {
          vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
          attributeByteCount: 0x8000,
        },
        {
          vertices: [[0, 0, 1], [1, 0, 1], [0, 1, 1]],
          attributeByteCount: 31,
        },
      ],
    }));

    expect(result.polygons.map((polygon) => polygon.color)).toEqual(["#0a141e", "#ff0000"]);
    expect(result.metadata?.stlHeader).toContain("COLOR=");
    expect(result.metadata?.stlColor).toEqual({
      format: "magics",
      defaultColor: "#0a141e",
      alpha: 1,
      coloredTriangleCount: 1,
      defaultColorTriangleCount: 1,
    });
    expect(result.warnings.some((warning) => warning.includes("attribute byte count"))).toBe(false);
  });

  it("accepts Uint8Array input", () => {
    const buf = buildBinaryStl();
    const wrapped = new Uint8Array(buf, 0, buf.byteLength);
    const result = parseStl(wrapped);
    expect(result.polygons).toHaveLength(1);
  });

  it("applies targetSize, gridShift, defaultColor, and z-up identity axes", () => {
    const result = parseStl(ASCII_TRIANGLE, {
      targetSize: 10,
      gridShift: 2,
      defaultColor: "#ff00aa",
      upAxis: "z",
    });

    expect(result.polygons[0]).toEqual({
      vertices: [
        [2, 2, 2],
        [12, 2, 2],
        [2, 12, 2],
      ],
      color: "#ff00aa",
    });
  });

  it("can remap y-up source axes using the cyclic OBJ/glTF transform", () => {
    const source = [
      "solid y",
      "facet normal 1 0 0",
      "outer loop",
      "vertex 0 0 0",
      "vertex 0 1 0",
      "vertex 0 0 2",
      "endloop",
      "endfacet",
      "endsolid y",
      "",
    ].join("\n");

    const result = parseStl(source, { targetSize: 2, gridShift: 0, upAxis: "y" });
    expect(result.polygons[0].vertices).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [2, 0, 0],
    ]);
  });

  it("preserves ASCII solid groups as STL metadata", () => {
    const source = [
      asciiSolid("first", [
        asciiFacet([[0, 0, 0], [1, 0, 0], [0, 1, 0]]),
      ]).trimEnd(),
      asciiSolid("second", [
        asciiFacet([[0, 0, 1], [1, 0, 1], [0, 1, 1]]),
      ]),
    ].join("\n");

    const result = parseStl(source);

    expect(result.polygons).toHaveLength(2);
    expect(result.metadata?.meshes).toEqual(["first", "second"]);
    expect(result.metadata?.stlSolids).toEqual([
      { name: "first", start: 0, count: 1 },
      { name: "second", start: 1, count: 1 },
    ]);
  });

  it("warns and skips malformed ASCII facets", () => {
    const source = [
      "solid mixed",
      "facet normal 0 0 1",
      "outer loop",
      "vertex 0 0 0",
      "vertex 1 0 0",
      "endloop",
      "endfacet",
      "facet normal 0 0 1",
      "outer loop",
      "vertex 0 0 0",
      "vertex 1 0 0",
      "vertex 0 1 0",
      "endloop",
      "endfacet",
      "endsolid mixed",
      "",
    ].join("\n");

    const result = parseStl(source);
    expect(result.polygons).toHaveLength(1);
    expect(result.warnings).toContain("parseStl: skipped 1 malformed ASCII facet");
  });

  it("skips degenerate triangles and warns", () => {
    const source = [
      "solid degenerate",
      "facet normal 0 0 1",
      "outer loop",
      "vertex 0 0 0",
      "vertex 1 0 0",
      "vertex 0 1 0",
      "endloop",
      "endfacet",
      "facet normal 0 0 0",
      "outer loop",
      "vertex 0 0 0",
      "vertex 0 0 0",
      "vertex 0 0 0",
      "endloop",
      "endfacet",
      "endsolid degenerate",
      "",
    ].join("\n");

    const result = parseStl(source);
    expect(result.polygons).toHaveLength(1);
    expect(result.warnings).toContain("parseStl: skipped 1 degenerate triangle");
  });

  it("throws on empty input", () => {
    expect(() => parseStl("")).toThrow("empty input");
    expect(() => parseStl(new ArrayBuffer(0))).toThrow("empty input");
  });

  it("throws when all facets are degenerate", () => {
    const source = [
      "solid degenerate",
      "facet normal 0 0 0",
      "outer loop",
      "vertex 0 0 0",
      "vertex 0 0 0",
      "vertex 0 0 0",
      "endloop",
      "endfacet",
      "endsolid degenerate",
      "",
    ].join("\n");

    expect(() => parseStl(source)).toThrow("no valid facets after filtering");
  });

  it("throws when ASCII input has no valid facets", () => {
    expect(() => parseStl("solid empty\nendsolid empty\n")).toThrow("no valid ascii facets");
  });

  it("skips ASCII facets with non-finite coordinates", () => {
    const source = asciiSolid("mixed", [
      asciiFacet([[0, 0, 0], [1, 0, 0], [0, 1, 0]]),
      ASCII_TRIANGLE.replace("vertex 1 0 0", "vertex NaN 0 0").split("\n").slice(1, -2),
    ]);

    const result = parseStl(source);

    expect(result.polygons).toHaveLength(1);
    expect(result.warnings).toContain("parseStl: skipped 1 malformed ASCII facet");
  });

  it("throws after filtering when all ASCII facets have malformed coordinates", () => {
    const source = ASCII_TRIANGLE.replace("vertex 1 0 0", "vertex NaN 0 0");
    expect(() => parseStl(source)).toThrow("no valid ascii facets");
  });

  it("skips loose ASCII numeric tokens", () => {
    const source = ASCII_TRIANGLE.replace("vertex 1 0 0", "vertex 1abc 0 0");
    expect(() => parseStl(source)).toThrow("no valid ascii facets");
  });

  it("rejects non-decimal ASCII numeric tokens", () => {
    const source = ASCII_TRIANGLE.replace("vertex 1 0 0", "vertex 0x1 0 0");
    expect(() => parseStl(source)).toThrow("no valid ascii facets");
  });

  it("validates geometry normalization options", () => {
    expect(() => parseStl(ASCII_TRIANGLE, { targetSize: 0 })).toThrow("targetSize must be greater than 0");
    expect(() => parseStl(ASCII_TRIANGLE, { targetSize: Number.POSITIVE_INFINITY })).toThrow("targetSize must be finite");
    expect(() => parseStl(ASCII_TRIANGLE, { gridShift: Number.NaN })).toThrow("gridShift must be finite");
    expect(() => parseStl(ASCII_TRIANGLE, { upAxis: "x" as "z" })).toThrow('upAxis must be "z" or "y"');
    expect(() => parseStl(ASCII_TRIANGLE, { defaultColor: "" })).toThrow("defaultColor must be a non-empty string");
    expect(() => parseStl(ASCII_TRIANGLE, { defaultColor: 42 as unknown as string })).toThrow("defaultColor must be a non-empty string");
    expect(() => parseStl(null as unknown as string)).toThrow("source must be an ArrayBuffer, Uint8Array, or ASCII string");
  });

  it("warns and ignores malformed ASCII normals", () => {
    const source = ASCII_TRIANGLE.replace("facet normal 0 0 1", "facet normal 0x0 0 1");
    const result = parseStl(source);

    expect(result.polygons).toHaveLength(1);
    expect(result.warnings).toContain("parseStl: ignored 1 malformed ASCII facet normal");
  });

  it("warns when supplied normals disagree with triangle winding", () => {
    const source = ASCII_TRIANGLE.replace("facet normal 0 0 1", "facet normal 0 0 -1");
    const result = parseStl(source);
    expect(result.warnings).toContain("parseStl: 1 supplied normal disagrees with triangle winding");
  });

  it("orients closed inverted components outward", () => {
    const a: TestVec3 = [0, 0, 0];
    const b: TestVec3 = [1, 0, 0];
    const c: TestVec3 = [0, 1, 0];
    const d: TestVec3 = [0, 0, 1];
    const outwardFacets: Array<[TestVec3, TestVec3, TestVec3]> = [
      [a, c, b],
      [a, b, d],
      [a, d, c],
      [b, c, d],
    ];
    const source = asciiSolid(
      "inverted",
      outwardFacets.map((vertices) => asciiFacet([vertices[0], vertices[2], vertices[1]], triangleNormal(vertices))),
    );

    const result = parseStl(source);

    expect(result.polygons).toHaveLength(4);
    expect(parsedSignedVolume(result.polygons)).toBeGreaterThan(0);
    expect(result.warnings).toContain("parseStl: repaired winding on 4 triangles");
    expect(result.warnings).toContain("parseStl: oriented 1 closed component outward");
    expect(result.warnings.some((warning) => warning.includes("supplied normal"))).toBe(false);
  });

  it("repairs inconsistent neighboring triangle winding on open surfaces", () => {
    const a: TestVec3 = [0, 0, 0];
    const b: TestVec3 = [1, 0, 0];
    const c: TestVec3 = [1, 1, 0];
    const d: TestVec3 = [0, 1, 0];
    const source = asciiSolid("open", [
      asciiFacet([a, b, c], [0, 0, 1]),
      asciiFacet([c, a, d], [0, 0, 1]),
    ]);

    const result = parseStl(source);

    expect(result.polygons).toHaveLength(2);
    expect(result.polygons.map((polygon) => parsedNormal(polygon)[2])).toEqual([1, 1]);
    expect(result.warnings).toContain("parseStl: repaired winding on 1 triangle");
    expect(result.warnings.some((warning) => warning.includes("closed component"))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("supplied normal"))).toBe(false);
  });

  it("does not flip outward closed winding just to satisfy bad supplied normals", () => {
    const a: TestVec3 = [0, 0, 0];
    const b: TestVec3 = [1, 0, 0];
    const c: TestVec3 = [0, 1, 0];
    const d: TestVec3 = [0, 0, 1];
    const outwardFacets: Array<[TestVec3, TestVec3, TestVec3]> = [
      [a, c, b],
      [a, b, d],
      [a, d, c],
      [b, c, d],
    ];
    const source = asciiSolid(
      "bad-normals",
      outwardFacets.map((vertices) => asciiFacet(vertices, scaleVec(triangleNormal(vertices), -1))),
    );

    const result = parseStl(source);

    expect(parsedSignedVolume(result.polygons)).toBeGreaterThan(0);
    expect(result.warnings).toContain("parseStl: 4 supplied normals disagree with triangle winding");
    expect(result.warnings.some((warning) => warning.includes("repaired winding"))).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("closed component"))).toBe(false);
  });

  it("orients open connected components from consistent supplied normals", () => {
    const v000: TestVec3 = [0, 0, 0];
    const v100: TestVec3 = [1, 0, 0];
    const v110: TestVec3 = [1, 1, 0];
    const v010: TestVec3 = [0, 1, 0];
    const v001: TestVec3 = [0, 0, 1];
    const v101: TestVec3 = [1, 0, 1];
    const v111: TestVec3 = [1, 1, 1];
    const v011: TestVec3 = [0, 1, 1];
    const outwardFacets: Array<[TestVec3, TestVec3, TestVec3]> = [
      [v000, v010, v110],
      [v000, v110, v100],
      [v000, v100, v101],
      [v000, v101, v001],
      [v100, v110, v111],
      [v100, v111, v101],
      [v110, v010, v011],
      [v110, v011, v111],
      [v010, v000, v001],
      [v010, v001, v011],
    ];
    const source = asciiSolid(
      "open-inverted",
      outwardFacets.map((vertices) => asciiFacet([vertices[0], vertices[2], vertices[1]], triangleNormal(vertices))),
    );

    const result = parseStl(source, { targetSize: 1, gridShift: 0 });

    expect(result.polygons).toHaveLength(outwardFacets.length);
    for (let i = 0; i < outwardFacets.length; i += 1) {
      expect(dotVec(parsedNormal(result.polygons[i]), triangleNormal(outwardFacets[i]))).toBeGreaterThan(0.99);
    }
    expect(result.warnings).toContain("parseStl: repaired winding on 10 triangles");
    expect(result.warnings).toContain("parseStl: oriented 1 open component from supplied normals");
    expect(result.metadata?.stlTopology).toEqual({
      componentCount: 1,
      repairedTriangleCount: 10,
      outwardComponentCount: 0,
      suppliedNormalComponentCount: 1,
      inconsistentSharedEdgeCount: 0,
      nonManifoldSharedEdgeCount: 0,
    });
    expect(result.warnings.some((warning) => warning.includes("supplied normal") && warning.includes("disagree"))).toBe(false);
  });

  it("warns when binary attribute byte counts are ignored", () => {
    const result = parseStl(buildBinaryStl({ attributeByteCount: 7 }));
    expect(result.warnings).toContain("parseStl: ignored non-zero binary attribute byte count on 1 triangle");
  });

  it("throws when binary coordinates are non-finite", () => {
    const source = buildBinaryStl({
      vertices: [[0, 0, 0], [Number.POSITIVE_INFINITY, 0, 0], [0, 1, 0]],
    });
    expect(() => parseStl(source)).toThrow("non-finite coordinate");
  });

  it("warns and ignores non-finite binary normals", () => {
    const result = parseStl(buildBinaryStl({ normal: [Number.NaN, 0, 1] }));
    expect(result.polygons).toHaveLength(1);
    expect(result.warnings).toContain("parseStl: ignored 1 non-finite binary normal");
  });
});
