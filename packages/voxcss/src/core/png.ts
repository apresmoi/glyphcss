const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHUNK_IHDR = new Uint8Array([0x49, 0x48, 0x44, 0x52]);
const CHUNK_IDAT = new Uint8Array([0x49, 0x44, 0x41, 0x54]);
const CHUNK_IEND = new Uint8Array([0x49, 0x45, 0x4e, 0x44]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function writeUint32BE(buf: Uint8Array, offset: number, value: number): number {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
  return offset + 4;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(type: Uint8Array, data?: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < type.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ type[i]) & 0xff] ^ (crc >>> 8);
  }
  if (data) {
    for (let i = 0; i < data.length; i += 1) {
      crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZlibStore(payload: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blocks = Math.ceil(payload.length / MAX_BLOCK);
  const zlibLen = 2 + payload.length + blocks * 5 + 4;
  const out = new Uint8Array(zlibLen);
  let offset = 0;

  // zlib header (CMF/FLG) with "fastest" compression flags; valid for stored blocks too.
  out[offset++] = 0x78;
  out[offset++] = 0x01;

  let cursor = 0;
  while (cursor < payload.length) {
    const remaining = payload.length - cursor;
    const blockLen = Math.min(MAX_BLOCK, remaining);
    const final = cursor + blockLen >= payload.length;

    out[offset++] = final ? 0x01 : 0x00; // BFINAL + BTYPE=00 (stored)
    out[offset++] = blockLen & 0xff;
    out[offset++] = (blockLen >>> 8) & 0xff;
    const nlen = (~blockLen) & 0xffff;
    out[offset++] = nlen & 0xff;
    out[offset++] = (nlen >>> 8) & 0xff;

    out.set(payload.subarray(cursor, cursor + blockLen), offset);
    offset += blockLen;
    cursor += blockLen;
  }

  const checksum = adler32(payload);
  offset = writeUint32BE(out, offset, checksum);
  return out;
}

function writeChunk(buf: Uint8Array, offset: number, type: Uint8Array, data?: Uint8Array): number {
  const len = data?.length ?? 0;
  offset = writeUint32BE(buf, offset, len);
  buf.set(type, offset);
  offset += 4;
  if (data?.length) {
    buf.set(data, offset);
    offset += data.length;
  }
  const checksum = crc32(type, data);
  offset = writeUint32BE(buf, offset, checksum);
  return offset;
}

export function encodeRgbaToPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("voxcss: encodeRgbaToPng requires a positive width and height.");
  }
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w !== width || h !== height) {
    throw new Error("voxcss: encodeRgbaToPng requires integer width and height.");
  }
  const expectedLen = w * h * 4;
  if (rgba.length !== expectedLen) {
    throw new Error(`voxcss: encodeRgbaToPng expected ${expectedLen} bytes, got ${rgba.length}.`);
  }

  const rowBytes = w * 4;
  const scanlineBytes = rowBytes + 1;
  const payload = new Uint8Array(h * scanlineBytes);
  let cursor = 0;
  for (let y = 0; y < h; y += 1) {
    payload[cursor++] = 0x00; // filter=none
    const srcStart = y * rowBytes;
    payload.set(rgba.subarray(srcStart, srcStart + rowBytes), cursor);
    cursor += rowBytes;
  }

  const idat = buildZlibStore(payload);

  const ihdr = new Uint8Array(13);
  let ihdrOffset = 0;
  ihdrOffset = writeUint32BE(ihdr, ihdrOffset, w);
  ihdrOffset = writeUint32BE(ihdr, ihdrOffset, h);
  ihdr[ihdrOffset++] = 8; // bit depth
  ihdr[ihdrOffset++] = 6; // color type: RGBA
  ihdr[ihdrOffset++] = 0; // compression method
  ihdr[ihdrOffset++] = 0; // filter method
  ihdr[ihdrOffset++] = 0; // interlace method

  const totalLen = PNG_SIGNATURE.length + (4 + 4 + ihdr.length + 4) + (4 + 4 + idat.length + 4) + (4 + 4 + 0 + 4);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  out.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  offset = writeChunk(out, offset, CHUNK_IHDR, ihdr);
  offset = writeChunk(out, offset, CHUNK_IDAT, idat);
  offset = writeChunk(out, offset, CHUNK_IEND);

  return out;
}

export function encodeRgbToPng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("voxcss: encodeRgbToPng requires a positive width and height.");
  }
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w !== width || h !== height) {
    throw new Error("voxcss: encodeRgbToPng requires integer width and height.");
  }
  const expectedLen = w * h * 3;
  if (rgb.length !== expectedLen) {
    throw new Error(`voxcss: encodeRgbToPng expected ${expectedLen} bytes, got ${rgb.length}.`);
  }

  const rowBytes = w * 3;
  const scanlineBytes = rowBytes + 1;
  const payload = new Uint8Array(h * scanlineBytes);
  let cursor = 0;
  for (let y = 0; y < h; y += 1) {
    payload[cursor++] = 0x00; // filter=none
    const srcStart = y * rowBytes;
    payload.set(rgb.subarray(srcStart, srcStart + rowBytes), cursor);
    cursor += rowBytes;
  }

  const idat = buildZlibStore(payload);

  const ihdr = new Uint8Array(13);
  let ihdrOffset = 0;
  ihdrOffset = writeUint32BE(ihdr, ihdrOffset, w);
  ihdrOffset = writeUint32BE(ihdr, ihdrOffset, h);
  ihdr[ihdrOffset++] = 8; // bit depth
  ihdr[ihdrOffset++] = 2; // color type: RGB
  ihdr[ihdrOffset++] = 0; // compression method
  ihdr[ihdrOffset++] = 0; // filter method
  ihdr[ihdrOffset++] = 0; // interlace method

  const totalLen = PNG_SIGNATURE.length + (4 + 4 + ihdr.length + 4) + (4 + 4 + idat.length + 4) + (4 + 4 + 0 + 4);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  out.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  offset = writeChunk(out, offset, CHUNK_IHDR, ihdr);
  offset = writeChunk(out, offset, CHUNK_IDAT, idat);
  offset = writeChunk(out, offset, CHUNK_IEND);

  return out;
}

export function rgbaToPngBlob(rgba: Uint8Array, width: number, height: number): Blob {
  const bytes = encodeRgbaToPng(rgba, width, height);
  return new Blob([bytes], { type: "image/png" });
}

export function rgbToPngBlob(rgb: Uint8Array, width: number, height: number): Blob {
  const bytes = encodeRgbToPng(rgb, width, height);
  return new Blob([bytes], { type: "image/png" });
}

