import { describe, expect, it } from "vitest";
import { buildReferenceDiagnosticPhase } from "../src/referenceDiagnostic.mjs";

describe("reference diagnostic phase sealing", () => {
  it("cannot be overridden by hostile phase fields", () => {
    expect(buildReferenceDiagnosticPhase({
      phase: "complete",
      schemaVersion: "hostile/v1",
      status: "pass",
      acceptance: true,
    })).toEqual({
      phase: "complete",
      schemaVersion: "glyph-reprojection-reference-phase/v1",
      status: "diagnostic-only",
      acceptance: false,
    });
  });
});
