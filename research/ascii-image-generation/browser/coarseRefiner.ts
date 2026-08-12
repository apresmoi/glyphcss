export interface GlyphCoarseRefinerArtifact {
  readonly schemaVersion: "glyph-browser-residual-refiner/v1";
  readonly id: string;
  readonly contentSha256: string;
  readonly disposition: "runnable-native-trajectory-trained-reference";
  readonly architecture: {
    readonly inputWidth: 10;
    readonly outputWidth: 3;
    readonly parameterCount: 33;
  };
  readonly weights: readonly (readonly number[])[];
  readonly bias: readonly number[];
  readonly output: {
    readonly maximumAbsoluteCorrection8: number;
  };
}

export interface GlyphCoarseRefinerInput {
  readonly artifact: GlyphCoarseRefinerArtifact;
  readonly base: ImageData;
  readonly control: Float32Array;
  readonly controlWidth: number;
  readonly controlHeight: number;
  readonly seed: number;
  readonly prompt: string;
  readonly strength: number;
}

// TODO(P2): export and benchmark the real native-trained student with the selected WebGPU runtime.

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function noise(seed: number, x: number, y: number): number {
  let value = (seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca77)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffff_ffff * 2 - 1;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function runGlyphCoarseRefiner(input: GlyphCoarseRefinerInput): ImageData {
  const { artifact, base, control, controlWidth, controlHeight } = input;
  if (artifact.architecture.inputWidth !== 10 || artifact.weights.length !== 3 || artifact.bias.length !== 3) {
    throw new TypeError("The coarse refiner artifact shape is invalid.");
  }
  const cells = controlWidth * controlHeight;
  if (control.length !== 17 * cells) throw new RangeError("The refiner requires one complete 17-channel B32 keyframe.");
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff) throw new RangeError("seed must be a uint32.");
  const strength = Math.max(0, Math.min(1, input.strength));
  const output = new Uint8ClampedArray(base.data);
  const promptSeed = fnv1a32(input.prompt);
  const planes = [2, 3, 4, 5, 6, 7, 8, 16, 15];
  const features = new Float32Array(10);

  for (let y = 0; y < base.height; y++) {
    const controlY = Math.min(controlHeight - 1, Math.floor(y / base.height * controlHeight));
    for (let x = 0; x < base.width; x++) {
      const controlX = Math.min(controlWidth - 1, Math.floor(x / base.width * controlWidth));
      const cell = controlY * controlWidth + controlX;
      for (let feature = 0; feature < planes.length; feature++) {
        features[feature] = control[planes[feature]! * cells + cell]!;
      }
      features[9] = noise((input.seed ^ promptSeed) >>> 0, x, y);
      const coverage = features[8]!;
      const mask = coverage + (1 - coverage) * 0.12;
      const pixel = (y * base.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        let activation = artifact.bias[channel]!;
        const weights = artifact.weights[channel]!;
        for (let feature = 0; feature < 10; feature++) activation += weights[feature]! * features[feature]!;
        const correctionSignal = Math.tanh(activation) * 0.92 + features[9]! * 0.08;
        const correction = correctionSignal * artifact.output.maximumAbsoluteCorrection8 * strength * mask;
        output[pixel + channel] = clampByte(base.data[pixel + channel]! + correction);
      }
    }
  }
  return new ImageData(output, base.width, base.height);
}
