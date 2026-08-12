export function stableControlBytes(value) {
  if (value instanceof Float64Array) {
    const stable = new Float64Array(value.length);
    for (let index = 0; index < value.length; index++) {
      const scalar = value[index];
      stable[index] = Number.isFinite(scalar) ? Number(scalar.toPrecision(13)) || 0 : Number.isNaN(scalar) ? Number.NaN : scalar;
    }
    return Buffer.from(stable.buffer, stable.byteOffset, stable.byteLength);
  }
  if (value instanceof Float32Array) {
    const stable = new Float32Array(value.length);
    for (let index = 0; index < value.length; index++) {
      const scalar = value[index];
      stable[index] = Number.isFinite(scalar) ? scalar || 0 : Number.isNaN(scalar) ? Number.NaN : scalar;
    }
    return Buffer.from(stable.buffer, stable.byteOffset, stable.byteLength);
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
