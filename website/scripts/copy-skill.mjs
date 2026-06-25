// Copy the canonical glyphcss CLI skill into public/ so it's served at
// /skill.md (single source of truth: packages/compile/SKILL.md).
import { copyFileSync } from "node:fs";
const src = "../packages/compile/SKILL.md";
const dest = "public/skill.md";
copyFileSync(src, dest);
console.log(`copied ${src} → website/${dest}`);
