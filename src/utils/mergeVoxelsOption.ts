export type MergeVoxelsOption = false | "2d" | "3d" | "3d-mask";

export function normalizeMergeVoxelsOption(option: MergeVoxelsOption | undefined): MergeVoxelsOption;
export function normalizeMergeVoxelsOption(option: unknown): MergeVoxelsOption;
export function normalizeMergeVoxelsOption(option: unknown): MergeVoxelsOption {
  if (option === "2d" || option === "3d" || option === "3d-mask" || option === false) return option;
  return false;
}

export function is2dMerge(option: MergeVoxelsOption | undefined): boolean {
  return option === "2d";
}

export function is3dMerge(option: MergeVoxelsOption | undefined): boolean {
  return option === "3d";
}

export function is3dMask(option: MergeVoxelsOption | undefined): boolean {
  return option === "3d-mask";
}
