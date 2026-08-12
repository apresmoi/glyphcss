const percentile = (samples, p) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};

export function buildReferenceSignals(spans, transitionsPerRun, runs) {
  if (!spans.length || !Number.isInteger(transitionsPerRun) || transitionsPerRun <= 0 || spans.length !== transitionsPerRun * runs) throw new Error("REFERENCE_SIGNAL_TRACE_SHAPE");
  const coverage = Math.min(...spans.map((span) => span.coveredCells ? span.validCells / span.coveredCells : 1));
  const revealed = Math.max(...spans.map((span) => span.coveredCells ? span.disoccludedCells / span.coveredCells : 0));
  const resets = spans.filter((span) => span.run === 0 && span.reset).length;
  const measuredErrors = spans.filter((span) => Number.isFinite(span.validPixelError));
  const meanError = measuredErrors.reduce((sum, span) => sum + span.validPixelError, 0) / measuredErrors.length;
  const unavailable = (reason) => ({ value: null, reason });
  return {
    "presentation-p95": { value: percentile(spans.map((span) => span.presentationMs), .95) },
    coverage: { value: coverage },
    "valid-pixel-error": { value: meanError },
    "newly-revealed-area": { value: revealed },
    "disocclusion-recovery-latency": unavailable("This reprojection-only harness has no asynchronous recovery completion event."),
    "temporal-warp-error": { value: meanError },
    "correction-magnitude": unavailable("This reprojection-only harness accepts no refinement frames."),
    "reset-frequency": { value: resets / transitionsPerRun },
    "stale-result-rejection": unavailable("This reprojection-only harness submits no tagged refinement result."),
  };
}
