export type MergeVoxelsOption = false | "2d" | "3d";

let didWarnMergeVoxelsLegacy = false;
function warnMergeVoxelsLegacyOnce(message: string): void {
  if (didWarnMergeVoxelsLegacy) return;
  didWarnMergeVoxelsLegacy = true;
  // Best-effort: avoid crashing in non-browser envs where `console` might be missing/mocked.
  try {
    console.warn(message);
  } catch {
    // ignore
  }
}

export function normalizeMergeVoxelsOption(option: MergeVoxelsOption | undefined): MergeVoxelsOption;
export function normalizeMergeVoxelsOption(option: unknown): MergeVoxelsOption;
export function normalizeMergeVoxelsOption(option: unknown): MergeVoxelsOption {
  if (option === "2d" || option === "3d" || option === false) return option;
  if (option === "3d-mask" || option === "3d-legacy") {
    warnMergeVoxelsLegacyOnce(
      `voxcss: mergeVoxels now supports "2d" and "3d"; received ${JSON.stringify(option)}, using "3d".`
    );
    return "3d";
  }
  return false;
}

export function is2dMerge(option: MergeVoxelsOption | undefined): boolean {
  return option === "2d";
}

export function is3dMerge(option: MergeVoxelsOption | undefined): boolean {
  return option === "3d";
}
