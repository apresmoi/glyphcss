export function canonicalReferenceResult(result: {
  warpRgb: ArrayLike<number>;
  reprojectionValid: ArrayLike<number>;
  disocclusion: ArrayLike<number>;
  atlasConfidence: ArrayLike<number>;
  state: { contentSha256: string };
}): string;
