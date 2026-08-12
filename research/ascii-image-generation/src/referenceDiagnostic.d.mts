export function buildReferenceDiagnosticPhase(phase: Record<string, unknown>): Record<string, unknown> & {
  schemaVersion: "glyph-reprojection-reference-phase/v1";
  status: "diagnostic-only";
  acceptance: false;
};
