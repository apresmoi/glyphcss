import { describe, expect, it } from "vitest";
import type { Polygon } from "../types";
import {
  cameraCullNormalGroupsFromPolygons,
  cameraCullVisibleSignature,
  isVoxelCameraCullableNormalGroups,
  polygonCssSurfaceNormal,
  polygonFacesCamera,
} from "./cameraBackfaceCulling";

function triangle(): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
  };
}

function backTriangle(): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
    ],
  };
}

function sideTriangle(): Polygon {
  return {
    vertices: [
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
  };
}

function rotatedSideTriangle(deg: number): Polygon {
  const r = deg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const rotate = (v: [number, number, number]): [number, number, number] => [
    v[0] * c - v[1] * s,
    v[0] * s + v[1] * c,
    v[2],
  ];
  return {
    vertices: sideTriangle().vertices.map(rotate),
  };
}

describe("cameraBackfaceCulling", () => {
  it("computes normals in glyphcss CSS space", () => {
    expect(polygonCssSurfaceNormal(triangle())).toEqual([0, 0, 1]);
    expect(polygonCssSurfaceNormal(backTriangle())).toEqual([0, 0, -1]);
  });

  it("recognizes voxel normal sets", () => {
    const groups = cameraCullNormalGroupsFromPolygons([
      triangle(),
      backTriangle(),
      sideTriangle(),
    ]);

    expect(isVoxelCameraCullableNormalGroups(groups)).toBe(true);
  });

  it("rejects non-axis normal sets", () => {
    const groups = cameraCullNormalGroupsFromPolygons([
      triangle(),
      rotatedSideTriangle(15),
    ]);

    expect(isVoxelCameraCullableNormalGroups(groups)).toBe(false);
  });

  it("tests whether a polygon faces the camera after scene rotation", () => {
    expect(polygonFacesCamera(triangle(), { rotX: 0, rotY: 0 })).toBe(true);
    expect(polygonFacesCamera(backTriangle(), { rotX: 0, rotY: 0 })).toBe(false);
    expect(polygonFacesCamera(backTriangle(), { rotX: 180, rotY: 0 })).toBe(true);
  });

  it("builds stable signatures from visible normal groups", () => {
    const groups = cameraCullNormalGroupsFromPolygons([
      triangle(),
      backTriangle(),
    ]);

    expect(cameraCullVisibleSignature(groups, { rotX: 0, rotY: 0 })).toBe("0.0000,0.0000,1.0000");
    expect(cameraCullVisibleSignature(groups, { rotX: 180, rotY: 0 })).toBe("0.0000,0.0000,-1.0000");
  });
});
