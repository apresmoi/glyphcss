export const buildReferenceDiagnosticPhase = (phase) => ({
  ...phase,
  schemaVersion: "glyph-reprojection-reference-phase/v1",
  status: "diagnostic-only",
  acceptance: false,
});
