import path from "node:path";

// V8's transcendental Math functions (sin, cos, atan2, pow, ...) return
// different last bits per platform, and the rendered grids are hashed exactly.
// The unsuffixed goldens were recorded on darwin-arm64 from the pinned old
// code. The `.linux-x64.json` goldens were recorded from the current code on
// CI's platform and are the exact regression guards there.
export function platformGolden(file: string): string {
  return process.platform === "linux" && process.arch === "x64"
    ? file.replace(/\.json$/, ".linux-x64.json")
    : file;
}

export const goldenPath = (name: string) => platformGolden(path.resolve(__dirname, name));
