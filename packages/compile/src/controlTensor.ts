import { packGlyphControlTensor } from "glyphcss";

/** Node boundary for B32. It intentionally delegates to the browser-safe packer byte-for-byte. */
export const packGlyphControlTensorForNode = packGlyphControlTensor;
