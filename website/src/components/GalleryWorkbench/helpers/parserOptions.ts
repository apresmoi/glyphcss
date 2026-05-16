import type { ObjParseOptions, GltfParseOptions, VoxParseOptions } from "@layoutit/polycss";
import type { ParserOptionsState } from "../types";

export function mergeParserOptions(
  base: ObjParseOptions | GltfParseOptions | VoxParseOptions | undefined,
  parser: ParserOptionsState,
): ObjParseOptions & GltfParseOptions & VoxParseOptions {
  return {
    ...(base ?? {}),
    targetSize: parser.targetSize,
    gridShift: parser.gridShift,
    defaultColor: parser.defaultColor,
  };
}
