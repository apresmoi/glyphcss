import { encodeRgbaToPng, encodeRgbToPng } from "@layoutit/voxcss-core";

export function rgbaToPngBlob(rgba: Uint8Array, width: number, height: number): Blob {
  const bytes = encodeRgbaToPng(rgba, width, height);
  return new Blob([bytes as BlobPart], { type: "image/png" });
}

export function rgbToPngBlob(rgb: Uint8Array, width: number, height: number): Blob {
  const bytes = encodeRgbToPng(rgb, width, height);
  return new Blob([bytes as BlobPart], { type: "image/png" });
}
