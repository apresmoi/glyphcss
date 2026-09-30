// ── Dock option tables (module-level so identities are stable across renders) ──
export const WEIGHT_OPTS: Record<string, number> = Object.fromEntries(
  [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => [String(w), w]),
);

export const CASE_OPTS: { value: string; label: string; title: string }[] = [
  { value: "as-typed", label: "Aa", title: "As typed" },
  { value: "upper", label: "AB", title: "UPPERCASE" },
  { value: "lower", label: "ab", title: "lowercase" },
  { value: "title", label: "Ab", title: "Title Case" },
];

export const ALIGN_OPTS: { value: string; label: string; title: string }[] = [
  { value: "left", label: "L", title: "Left" },
  { value: "center", label: "C", title: "Center" },
  { value: "right", label: "R", title: "Right" },
];

export const PROFILE_OPTS: Record<string, string> = {
  "Flat (slab)": "flat",
  Bevel: "bevel",
  "Round in": "round",
  "Round out": "roundup",
  "Custom curve": "custom",
};

export const WARP_OPTS: Record<string, string> = {
  None: "none",
  "Arch up": "arch",
  "Arch down": "archDown",
  "Arc (circle)": "arc",
  Wave: "wave",
  Bulge: "bulge",
  "Cone (taper)": "cone",
  "Slant up": "slantUp",
  "Slant down": "slantDown",
};

export const FILL_OPTS: Record<string, string> = {
  Solid: "solid",
  Gradient: "gradient",
  Rainbow: "rainbow",
  Texture: "texture",
  Image: "image",
};

export const FACE_FILL_OPTS: Record<string, string> = { Solid: "solid", Texture: "texture", None: "none" };
