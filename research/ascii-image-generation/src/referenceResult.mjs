const canonical = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(typeof value === "number" && Number.isFinite(value) ? Number(value.toPrecision(14)) || 0 : value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;

export const canonicalReferenceResult = (result) => canonical({
  warpRgb: Array.from(result.warpRgb),
  reprojectionValid: Array.from(result.reprojectionValid),
  disocclusion: Array.from(result.disocclusion),
  atlasConfidence: Array.from(result.atlasConfidence),
  stateSha256: result.state.contentSha256,
});
