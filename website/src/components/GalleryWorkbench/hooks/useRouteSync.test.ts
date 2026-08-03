import { describe, expect, it } from "vitest";
import { sceneCodec } from "./useRouteSync";
import type { SceneOptionsState } from "../types";

const DEFAULTS: SceneOptionsState = {
  animationPaused: false,
  animationTimeScale: 1,
  autoCenter: true,
  autoRotate: false,
  interactive: true,
  zoom: 42,
  rotX: 0,
  rotY: 0,
  perspective: false,
  lightAzimuth: 0,
  lightElevation: 0,
  lightIntensity: 1,
  lightColor: "#ffffff",
  ambientIntensity: 0.4,
  ambientColor: "#ffffff",
  target: [0, 0, 0],
  renderMode: "wireframe",
  featureEdges: 35,
  glyphPalette: "default",
  charMode: "ascii",
  wireframeJunctions: false,
  hiddenLines: "show",
  lineHeight: 1,
  density: 1,
  dragDensity: 1,
  useColors: true,
  smoothShading: false,
  creaseAngle: 35,
  dragMode: "orbit",
  fpvLook: true,
  fpvMove: true,
  fpvJump: true,
  fpvCrouch: true,
  fpvMoveSpeed: 4,
  fpvJumpVelocity: 5,
  fpvGravity: 14,
  fpvEyeHeight: 1.7,
  fpvCrouchHeight: 0.9,
  fpvLookSensitivity: 1,
  fpvInvertY: false,
  shadowEnabled: false,
  shadowOpacity: 0.25,
  shadowLift: 0.05,
  shadowColor: "#000000",
  shadowCast: false,
  shadowReceive: false,
  shadowFloor: false,
};

const REPRESENTATIVE: SceneOptionsState = {
  ...DEFAULTS,
  renderMode: "solid",
  charMode: "halfblock",
  glyphPalette: "calibrated",
  hiddenLines: "hide",
  dragMode: "fpv",
  rotX: 65.4321,
  rotY: -142.1,
  perspective: 900,
  lightAzimuth: 213.5,
  lightElevation: 48,
  lightIntensity: 1.3,
  lightColor: "#ff8844",
  ambientIntensity: 0.6,
  ambientColor: "#223344",
  target: [1.5, -2.25, 0.1],
  featureEdges: 20,
  density: 2.5,
  useColors: false,
  smoothShading: true,
  creaseAngle: 15,
  shadowEnabled: true,
  shadowOpacity: 0.5,
  shadowColor: "#112233",
  shadowCast: true,
  shadowReceive: true,
  shadowFloor: true,
  autoRotate: true,
  animationTimeScale: 0.5,
};

describe("gallery scene codec", () => {
  it("omits every field equal to default (zoom always omitted by design)", () => {
    expect(sceneCodec.encode(DEFAULTS)).toBe("p1");
  });

  it("round-trips a representative non-default state", () => {
    const decoded = sceneCodec.decode(sceneCodec.encode(REPRESENTATIVE));
    // `zoom` is never serialized by design (see useRouteSync.ts) — the
    // gallery auto-fits it, so exclude it from the round-trip comparison.
    // `decode` only returns the DIFF against defaults; merge over DEFAULTS
    // (as the real page does) before comparing to the full representative state.
    const { zoom: _zoom, ...expected } = REPRESENTATIVE;
    const { zoom: _defaultZoom, ...merged } = { ...DEFAULTS, ...decoded };
    expect(merged).toEqual(expected);
  });

  it("round-trips perspective=false and a numeric perspective", () => {
    expect(sceneCodec.decode(sceneCodec.encode({ ...DEFAULTS, perspective: false })).perspective).toBeUndefined();
    expect(sceneCodec.decode(sceneCodec.encode({ ...DEFAULTS, perspective: 640 })).perspective).toBe(640);
  });

  it("never throws on truncated payloads", () => {
    const full = sceneCodec.encode(REPRESENTATIVE);
    for (let i = 0; i < full.length; i++) {
      expect(() => sceneCodec.decode(full.slice(0, i))).not.toThrow();
    }
  });

  it("encodes well under the old ~200-char compact baseline for a busy state", () => {
    const packed = sceneCodec.encode(REPRESENTATIVE);
    expect(packed.length).toBeLessThan(200);
  });
});
