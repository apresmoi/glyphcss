export type MergeVoxelsOption = false | "2d" | "3d" | "poly";

export function normalizeMergeVoxelsOption(option: MergeVoxelsOption | undefined): MergeVoxelsOption;
export function normalizeMergeVoxelsOption(option: unknown): MergeVoxelsOption;
export function normalizeMergeVoxelsOption(option: unknown): MergeVoxelsOption {
  if (option === "2d" || option === "3d" || option === "poly" || option === false) return option;
  return false;
}

export function is2dMerge(option: MergeVoxelsOption | undefined): boolean {
  return option === "2d";
}

export function is3dMerge(option: MergeVoxelsOption | undefined): boolean {
  return option === "3d";
}

export function isPolyMerge(option: MergeVoxelsOption | undefined): boolean {
  return option === "poly";
}
