import { expect, it } from "vitest";
import {
  createGlyphDiagramsWorkbenchState,
  glyphDiagramsWorkbenchDensity,
  glyphDiagramsWorkbenchEffectiveDensity,
  glyphDiagramsWorkbenchWebGridSize,
  glyphDiagramsWorkbenchRenderOptions,
  glyphDiagramsWorkbenchSequenceRenderOptions,
  glyphDiagramsWorkbenchLanesRenderOptions,
  reduceGlyphDiagramsWorkbenchControls,
} from "./diagramsWorkbenchState";
import { decodeDiagramsUrlState, encodeDiagramsUrlState } from "../services/diagramsUrlState";

it("uses only explicit density to change cell size and keeps exact viewport budgets", () => {
  expect(glyphDiagramsWorkbenchWebGridSize({ width: 761.71875, height: 130 })).toEqual({ width: 100, height: 10 });
  expect(glyphDiagramsWorkbenchWebGridSize({ width: 761.71875, height: 130 }, 2)).toEqual({ width: 200, height: 20 });
  expect(glyphDiagramsWorkbenchWebGridSize(undefined, 2)).toEqual({ width: 192, height: 64 });
  const state = createGlyphDiagramsWorkbenchState();
  const controls = reduceGlyphDiagramsWorkbenchControls(state.controls, { type: "density", value: 2 });
  for (const options of [
    glyphDiagramsWorkbenchRenderOptions,
    glyphDiagramsWorkbenchSequenceRenderOptions,
    glyphDiagramsWorkbenchLanesRenderOptions,
  ]) {
    expect(options({ ...state, controls }, { width: 761.71875, height: 130 })).toMatchObject({
      width: 200,
      height: 20,
    });
    expect(options({ ...state, controls })).not.toHaveProperty("density");
    for (const target of ["terminal", "chat"] as const) {
      const fixed = { ...controls, target, overrides: { ...controls.overrides, width: 60, height: 20 } };
      expect(glyphDiagramsWorkbenchEffectiveDensity(fixed)).toBe(1);
      expect(glyphDiagramsWorkbenchDensity(fixed)).toBe(2);
      expect(options({ ...state, controls: fixed }, { width: 100, height: 100 })).toMatchObject({
        width: 60,
        height: 20,
      });
    }
  }
  expect(glyphDiagramsWorkbenchDensity({ ...controls, overrides: { density: Infinity } })).toBe(1);
  expect(glyphDiagramsWorkbenchDensity({ ...controls, overrides: { density: 100 } })).toBe(3.25);
});

it("persists explicit density across target changes and URL restoration", async () => {
  const state = createGlyphDiagramsWorkbenchState();
  const dense = reduceGlyphDiagramsWorkbenchControls(state.controls, { type: "density", value: 2.25 });
  const terminal = reduceGlyphDiagramsWorkbenchControls(dense, { type: "target", value: "terminal" });
  expect(reduceGlyphDiagramsWorkbenchControls(terminal, { type: "target", value: "web" })).toEqual(dense);
  const restored = await decodeDiagramsUrlState(await encodeDiagramsUrlState({ ...state, controls: terminal }));
  expect(restored?.controls).toEqual(terminal);
});

it.each(["dense", null, 0, 4])(
  "ignores malformed optional density %s while retaining the saved link",
  async (density) => {
    const state = createGlyphDiagramsWorkbenchState();
    const restored = await decodeDiagramsUrlState(
      await encodeDiagramsUrlState({
        ...state,
        controls: { ...state.controls, overrides: { density } },
      } as unknown as typeof state),
    );
    expect(restored).not.toBeNull();
    expect(restored?.controls.overrides).not.toHaveProperty("density");
  },
);
