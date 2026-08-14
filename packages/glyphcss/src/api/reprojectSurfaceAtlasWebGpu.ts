import type { GlyphControlFrame } from "./controlFrame";
import { glyphSurfaceAtlasProvenanceFromFrame, sealGlyphSurfaceAtlasState, validateGlyphSurfaceAtlasFrame, type GlyphReprojectSurfaceAtlasOptions, type GlyphSurfaceAtlasProvenance, type GlyphSurfaceAtlasState } from "./reprojectSurfaceAtlas";

// WebGPU is intentionally structural here.  glyphcss also builds in Node where
// TypeScript's DOM lib does not yet consistently include WebGPU declarations.
type Gpu = any;

const BUFFER = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128, QUERY_RESOLVE: 512 };
const TEXTURE = { COPY_SRC: 1, RENDER_ATTACHMENT: 16 };
const INVALID = 0xffffffff;

export interface GlyphSurfaceAtlasWebGpuSessionOptions {
  readonly device: Gpu;
  /** A single canvas is configured once and presented by the same render pass. */
  readonly canvas: HTMLCanvasElement;
  readonly atlasSize?: number;
  /** Maximum independently addressed stable surfaces kept resident. Default: 128. */
  readonly surfaceCapacity?: number;
  readonly format?: string;
  /** Diagnostic-only exact render-target capture. Never enable in timed presentation. */
  readonly capturePresentation?: boolean;
}

export interface GlyphSurfaceAtlasWebGpuSubmitOptions extends Omit<GlyphReprojectSurfaceAtlasOptions, "state" | "atlasSize"> {}

export interface GlyphSurfaceAtlasWebGpuReadback {
  readonly warpRgb: Float32Array;
  readonly reprojectionValid: Float32Array;
  readonly disocclusion: Float32Array;
  readonly atlasConfidence: Float32Array;
}

export interface GlyphSurfaceAtlasWebGpuPresentationReadback {
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  /** Native canvas bytes in the configured `bgra8unorm` presentation format. */
  readonly bgra: Uint8Array;
}

export interface GlyphSurfaceAtlasWebGpuProfile {
  readonly cpu: {
    readonly routingMs: number;
    readonly uploadEnqueueMs: number;
    readonly dispatchEncodingMs: number;
    readonly renderEncodingMs: number;
    readonly canvasSubmitMs: number;
    readonly gpuCompletionMs: number;
    readonly submitTotalMs: number;
  };
  readonly gpu: {
    readonly timestampQuery: boolean;
    readonly computeNs: number | null;
    readonly renderNs: number | null;
    readonly totalNs: number | null;
    readonly unavailableReason?: string;
  };
}

export interface GlyphSurfaceAtlasWebGpuSession {
  readonly atlasSize: number;
  readonly device: Gpu;
  submit(options: GlyphSurfaceAtlasWebGpuSubmitOptions): void;
  /** Diagnostic-only phase decomposition. The normal submit path never enables profiling. */
  submitProfiled(options: GlyphSurfaceAtlasWebGpuSubmitOptions): Promise<GlyphSurfaceAtlasWebGpuProfile>;
  /** Deliberately untimed checkpoint path; never used by submit/presentation. */
  readback(): Promise<GlyphSurfaceAtlasWebGpuReadback>;
  /** Diagnostic-only render-target readback, captured in the same submit as the canvas pass. */
  readPresentation(): Promise<GlyphSurfaceAtlasWebGpuPresentationReadback>;
  /** Slow integrity boundary: reconstructs the exact CPU oracle state shape. */
  checkpoint(): Promise<GlyphSurfaceAtlasState>;
  destroy(): void;
}

const identity = (frame: GlyphControlFrame) => `${frame.metadata.scene.id}:${frame.metadata.scene.contentSha256}:${frame.metadata.dictionary.id}:${frame.metadata.dictionary.contentSha256}`;
const cells = (frame: GlyphControlFrame) => frame.metadata.cols * frame.metadata.rows;
const usage = (value: number) => value;
const align = (bytes: number) => Math.max(4, Math.ceil(bytes / 4) * 4);
const destroyGpu = (resource: Gpu | null | undefined) => {
  try { resource?.destroy?.(); } catch {}
};

const shader = /* wgsl */`
struct Counts { atlas: u32, source: u32, targetCount: u32, width: u32, height: u32, reset: u32, _pad0: u32, _pad1: u32 }
@group(0) @binding(0) var<storage, read_write> candidates: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> confidence: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> atlas: array<f32>;
@group(0) @binding(3) var<storage, read> sourceRoute: array<u32>;
@group(0) @binding(4) var<storage, read> sourceRgb: array<f32>;
@group(0) @binding(5) var<storage, read> targetRoute: array<u32>;
@group(0) @binding(6) var<storage, read_write> output: array<f32>;
@group(0) @binding(7) var<uniform> counts: Counts;
fn finite(value: f32) -> bool { return value == value && (value - value) == 0.; }
fn route(layer: u32, covered: u32, winner: u32, u: f32, v: f32, depth: f32, worldX: f32, worldY: f32, worldZ: f32) -> u32 {
  if (layer == 0xffffffffu || covered != 1u || winner == 0xffffffffu) { return 0xffffffffu; }
  if (!finite(u) || !finite(v) || u < 0. || u > 1. || v < 0. || v > 1. || !finite(depth) || !finite(worldX) || !finite(worldY) || !finite(worldZ)) { return 0xffffffffu; }
  let size = counts._pad0; let texel = min(size - 1u, u32(floor(v * f32(size)))) * size + min(size - 1u, u32(floor(u * f32(size)))); return layer * size * size + texel;
}
fn sourceRouted(cell: u32) -> u32 { let at = cell * 9u; return route(sourceRoute[at], sourceRoute[at + 1u], sourceRoute[at + 2u], bitcast<f32>(sourceRoute[at + 3u]), bitcast<f32>(sourceRoute[at + 4u]), bitcast<f32>(sourceRoute[at + 5u]), bitcast<f32>(sourceRoute[at + 6u]), bitcast<f32>(sourceRoute[at + 7u]), bitcast<f32>(sourceRoute[at + 8u])); }
fn targetRouted(cell: u32) -> u32 { let at = cell * 9u; return route(targetRoute[at], targetRoute[at + 1u], targetRoute[at + 2u], bitcast<f32>(targetRoute[at + 3u]), bitcast<f32>(targetRoute[at + 4u]), bitcast<f32>(targetRoute[at + 5u]), bitcast<f32>(targetRoute[at + 6u]), bitcast<f32>(targetRoute[at + 7u]), bitcast<f32>(targetRoute[at + 8u])); }

@compute @workgroup_size(64) fn clearCandidates(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < counts.atlas) { atomicStore(&candidates[id.x], 0u); }
}
@compute @workgroup_size(64) fn clearAtlas(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < counts.atlas) { atomicStore(&confidence[id.x], 0u); let at = id.x * 3u; atlas[at] = 0.; atlas[at + 1u] = 0.; atlas[at + 2u] = 0.; }
}
@compute @workgroup_size(64) fn claim(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= counts.source) { return; }
  let slot = sourceRouted(id.x); if (slot == 0xffffffffu) { return; }
  // atomicMax makes the source cell with the greatest linear cell index win,
  // exactly matching the CPU's ordered last-write collision rule.
  atomicMax(&candidates[slot], id.x + 1u);
}
@compute @workgroup_size(64) fn resolve(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= counts.atlas) { return; }
  let winner = atomicLoad(&candidates[id.x]); if (winner == 0u) { return; }
  let source = winner - 1u; let at = id.x * 3u; let rgb = source * 3u;
  atlas[at] = sourceRgb[rgb]; atlas[at + 1u] = sourceRgb[rgb + 1u]; atlas[at + 2u] = sourceRgb[rgb + 2u]; atomicStore(&confidence[id.x], 1u);
}
@compute @workgroup_size(64) fn project(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= counts.targetCount) { return; }
  let slot = targetRouted(id.x); let n = counts.targetCount;
  // CPU marks every covered target winner without a safe atlas route as a
  // disocclusion. Invalid UV/depth/world coordinates are therefore holes too.
  let route = id.x * 9u;
  let coveredWinner = targetRoute[route + 1u] == 1u && targetRoute[route + 2u] != 0xffffffffu;
  if (slot == 0xffffffffu || atomicLoad(&confidence[slot]) == 0u) { output[id.x] = 0.; output[n + id.x] = 0.; output[n * 2u + id.x] = 0.; output[n * 3u + id.x] = 0.; output[n * 4u + id.x] = select(0., 1., coveredWinner); output[n * 5u + id.x] = 0.; let present = n * 6u + id.x * 4u; output[present] = 0.; output[present + 1u] = 0.; output[present + 2u] = 0.; output[present + 3u] = 1.; return; }
  let at = slot * 3u; output[id.x] = atlas[at]; output[n + id.x] = atlas[at + 1u]; output[n * 2u + id.x] = atlas[at + 2u]; output[n * 3u + id.x] = 1.; output[n * 4u + id.x] = 0.; output[n * 5u + id.x] = 1.;
  // Presentation is appended after the NCHW temporal planes. One persistent
  // canvas render pass reads this buffer; no text/CSV or CPU pixels are built.
  let present = n * 6u + id.x * 4u; output[present] = atlas[at]; output[present + 1u] = atlas[at + 1u]; output[present + 2u] = atlas[at + 2u]; output[present + 3u] = 1.;
}
@group(1) @binding(0) var<storage, read> display: array<f32>;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) vertex: u32) -> VertexOut { var p = array<vec2<f32>, 3>(vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.)); var o: VertexOut; o.position = vec4(p[vertex], 0., 1.); o.uv = (p[vertex] + vec2(1.)) * .5; o.uv.y = 1. - o.uv.y; return o; }
@fragment fn fs(in: VertexOut) -> @location(0) vec4<f32> { let x = min(u32(in.uv.x * f32(counts.width)), counts.width - 1u); let y = min(u32(in.uv.y * f32(counts.height)), counts.height - 1u); let at = counts.targetCount * 6u + (y * counts.width + x) * 4u; return vec4(display[at], display[at + 1u], display[at + 2u], display[at + 3u]); }
`;

export function createGlyphSurfaceAtlasWebGpuSession(options: GlyphSurfaceAtlasWebGpuSessionOptions): GlyphSurfaceAtlasWebGpuSession {
  const { device, canvas } = options;
  const atlasSize = options.atlasSize ?? 64;
  if (!Number.isInteger(atlasSize) || atlasSize < 2 || atlasSize > 4096) throw new RangeError("glyphcss: WebGPU atlasSize must be an integer in [2, 4096].");
  if (!device || typeof device.createBuffer !== "function") throw new TypeError("glyphcss: a live WebGPU device is required.");
  const surfaceCapacity = options.surfaceCapacity ?? 128;
  if (!Number.isInteger(surfaceCapacity) || surfaceCapacity < 1 || surfaceCapacity > 4096) throw new RangeError("glyphcss: WebGPU surfaceCapacity must be an integer in [1, 4096].");
  const atlasSlots = atlasSize * atlasSize, atlasEntries = atlasSlots * surfaceCapacity;
  const maxDispatchEntries = (device.limits?.maxComputeWorkgroupsPerDimension ?? 65535) * 64;
  if (!Number.isSafeInteger(maxDispatchEntries) || atlasEntries > maxDispatchEntries) throw new RangeError("glyphcss: WebGPU atlas entries exceed the device compute-dispatch limit.");
  const context = canvas.getContext("webgpu") as any;
  if (!context) throw new Error("glyphcss: WebGPU canvas context is unavailable.");
  const gpu = (globalThis.navigator as any)?.gpu;
  const format = options.format ?? gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm";
  if (options.capturePresentation === true && format !== "bgra8unorm") throw new RangeError("glyphcss: diagnostic presentation capture requires bgra8unorm.");
  const capturePresentation = options.capturePresentation === true;
  const storageLimit = Math.min(device.limits?.maxBufferSize ?? Number.MAX_SAFE_INTEGER, device.limits?.maxStorageBufferBindingSize ?? Number.MAX_SAFE_INTEGER);
  const buffer = (size: number, flags: number) => {
    const aligned = align(size);
    if (!Number.isSafeInteger(aligned) || aligned > storageLimit) throw new RangeError("glyphcss: WebGPU atlas resources exceed the device storage-buffer limits.");
    return device.createBuffer({ size: aligned, usage: usage(flags) });
  };
  let candidates: Gpu | null = null, confidence: Gpu | null = null, atlas: Gpu | null = null, counts: Gpu | null = null;
  let computeLayout: Gpu, compute: Gpu, clearAtlasPipeline: Gpu, claimPipeline: Gpu, resolvePipeline: Gpu, projectPipeline: Gpu, renderPipeline: Gpu;
  try {
    context.configure({ device, format, alphaMode: "opaque", ...(capturePresentation ? { usage: TEXTURE.RENDER_ATTACHMENT | TEXTURE.COPY_SRC } : {}) });
    candidates = buffer(atlasEntries * 4, BUFFER.STORAGE | BUFFER.COPY_DST);
    confidence = buffer(atlasEntries * 4, BUFFER.STORAGE | BUFFER.COPY_DST | BUFFER.COPY_SRC);
    atlas = buffer(atlasEntries * 3 * 4, BUFFER.STORAGE | BUFFER.COPY_DST | BUFFER.COPY_SRC);
    counts = buffer(32, BUFFER.UNIFORM | BUFFER.COPY_DST);
    const module = device.createShaderModule({ code: shader });
    // Every compute entrypoint shares this one declared layout. Auto layouts
    // are pipeline-local and can fail when a bind group is reused.
    computeLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 4, buffer: { type: "storage" } }, { binding: 1, visibility: 4, buffer: { type: "storage" } }, { binding: 2, visibility: 4, buffer: { type: "storage" } },
      { binding: 3, visibility: 4, buffer: { type: "read-only-storage" } }, { binding: 4, visibility: 4, buffer: { type: "read-only-storage" } }, { binding: 5, visibility: 4, buffer: { type: "read-only-storage" } },
      { binding: 6, visibility: 4, buffer: { type: "storage" } }, { binding: 7, visibility: 4, buffer: { type: "uniform" } },
    ] });
    const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
    compute = device.createComputePipeline({ layout: computePipelineLayout, compute: { module, entryPoint: "clearCandidates" } });
    clearAtlasPipeline = device.createComputePipeline({ layout: computePipelineLayout, compute: { module, entryPoint: "clearAtlas" } });
    claimPipeline = device.createComputePipeline({ layout: computePipelineLayout, compute: { module, entryPoint: "claim" } });
    resolvePipeline = device.createComputePipeline({ layout: computePipelineLayout, compute: { module, entryPoint: "resolve" } });
    projectPipeline = device.createComputePipeline({ layout: computePipelineLayout, compute: { module, entryPoint: "project" } });
    renderPipeline = device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" }, fragment: { module, entryPoint: "fs", targets: [{ format }] }, primitive: { topology: "triangle-list" } });
  } catch (error) {
    destroyGpu(candidates); destroyGpu(confidence); destroyGpu(atlas); destroyGpu(counts);
    try { context.unconfigure?.(); } catch {}
    throw error;
  }
  let presentationReadback: Gpu | null = null;
  let presentationWidth = 0, presentationHeight = 0, presentationBytesPerRow = 0, presentationMapped = false;
  let committedCells = 0, stateVersion: number | null = null, currentIdentity: string | null = null, committedProvenance: GlyphSurfaceAtlasProvenance | null = null, lost = false, destroyed = false;
  let surfaceLayers = new Map<string, number>();
  type FrameResources = {
    readonly capacity: number;
    readonly sourceRoute: Gpu;
    readonly sourceRgb: Gpu;
    readonly targetRoute: Gpu;
    readonly output: Gpu;
    readonly computeGroup: Gpu;
    readonly renderCountsGroup: Gpu;
    readonly renderGroup: Gpu;
  };
  let frameResources: FrameResources | null = null;
  const destroyFrameResources = (resources: FrameResources | null) => {
    if (!resources) return;
    destroyGpu(resources.sourceRoute); destroyGpu(resources.sourceRgb); destroyGpu(resources.targetRoute); destroyGpu(resources.output);
  };
  const createFrameResources = (n: number): FrameResources => {
    let sourceRoute: Gpu | null = null, sourceRgb: Gpu | null = null, targetRoute: Gpu | null = null, output: Gpu | null = null;
    try {
      sourceRoute = buffer(n * 9 * 4, BUFFER.STORAGE | BUFFER.COPY_DST);
      sourceRgb = buffer(n * 3 * 4, BUFFER.STORAGE | BUFFER.COPY_DST);
      targetRoute = buffer(n * 9 * 4, BUFFER.STORAGE | BUFFER.COPY_DST);
      // NCHW RGB + valid + disocclusion + confidence plus RGBA presentation.
      output = buffer((n * 6 + n * 4) * 4, BUFFER.STORAGE | BUFFER.COPY_SRC);
      const computeGroup = device.createBindGroup({ layout: computeLayout, entries: [{ binding: 0, resource: { buffer: candidates } }, { binding: 1, resource: { buffer: confidence } }, { binding: 2, resource: { buffer: atlas } }, { binding: 3, resource: { buffer: sourceRoute } }, { binding: 4, resource: { buffer: sourceRgb } }, { binding: 5, resource: { buffer: targetRoute } }, { binding: 6, resource: { buffer: output } }, { binding: 7, resource: { buffer: counts } }] });
      // The render shader uses only the uniform counts in group 0. Its auto
      // layout intentionally differs from the compute layout.
      const renderCountsGroup = device.createBindGroup({ layout: renderPipeline.getBindGroupLayout(0), entries: [{ binding: 7, resource: { buffer: counts } }] });
      const renderGroup = device.createBindGroup({ layout: renderPipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: output } }] });
      return { capacity: n, sourceRoute, sourceRgb, targetRoute, output, computeGroup, renderCountsGroup, renderGroup };
    } catch (error) {
      destroyGpu(sourceRoute); destroyGpu(sourceRgb); destroyGpu(targetRoute); destroyGpu(output);
      throw error;
    }
  };
  const createPresentationResource = (width: number, height: number) => {
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    return { resource: buffer(bytesPerRow * height, BUFFER.COPY_DST | BUFFER.MAP_READ), width, height, bytesPerRow };
  };
  const route = (frame: GlyphControlFrame, surfaceMap: Map<string, number>) => {
    const result = new Uint32Array(cells(frame) * 9); result.fill(INVALID); const floats = new Float32Array(result.buffer);
    for (let cell = 0; cell < cells(frame); cell++) { const local = frame.surfaceId[cell]!; const surface = local < 0 ? undefined : frame.surfaceLookup[local]; const layer = surface === undefined ? undefined : surfaceMap.get(surface); const at = cell * 9; result[at] = layer ?? INVALID; result[at + 1] = frame.coverage[cell]!; result[at + 2] = frame.winnerPolygon[cell]! < 0 ? INVALID : frame.winnerPolygon[cell]!; floats[at + 3] = frame.surfaceUv[cell * 2]!; floats[at + 4] = frame.surfaceUv[cell * 2 + 1]!; floats[at + 5] = frame.depth[cell]!; floats[at + 6] = frame.worldPosition[cell * 3]!; floats[at + 7] = frame.worldPosition[cell * 3 + 1]!; floats[at + 8] = frame.worldPosition[cell * 3 + 2]!; }
    return result;
  };
  const teardown = () => {
    if (destroyed) return;
    destroyed = true; lost = true;
    if (presentationMapped) {
      try { presentationReadback?.unmap?.(); } catch {}
      presentationMapped = false;
    }
    destroyGpu(candidates); destroyGpu(confidence); destroyGpu(atlas); destroyGpu(counts);
    destroyFrameResources(frameResources); frameResources = null;
    destroyGpu(presentationReadback); presentationReadback = null;
    try { context.unconfigure?.(); } catch {}
  };
  void device.lost?.then(teardown, teardown);
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const submitInternal = (input: GlyphSurfaceAtlasWebGpuSubmitOptions, profiled: boolean): Promise<GlyphSurfaceAtlasWebGpuProfile> | null => {
    const submitStart = profiled ? now() : 0;
    if (lost || destroyed) throw new Error("glyphcss: WebGPU device was lost or session was destroyed; atlas session is invalid.");
    if (presentationMapped) throw new Error("glyphcss: cannot submit while presentation readback is mapped.");
    const { sourceFrame, targetFrame, sourceRgb: rgb, sourceStateVersion, targetStateVersion } = input;
    validateGlyphSurfaceAtlasFrame(sourceFrame, "WebGPU source"); validateGlyphSurfaceAtlasFrame(targetFrame, "WebGPU target");
    const n = cells(sourceFrame); if (n !== cells(targetFrame) || sourceFrame.metadata.cols !== targetFrame.metadata.cols || sourceFrame.metadata.rows !== targetFrame.metadata.rows) throw new RangeError("glyphcss: WebGPU source and target grids must match.");
    if (n > maxDispatchEntries) throw new RangeError("glyphcss: WebGPU control-frame cells exceed the device compute-dispatch limit.");
    if (rgb.length !== n * 3 || !Number.isInteger(sourceStateVersion) || sourceStateVersion < 0 || !Number.isInteger(targetStateVersion) || targetStateVersion !== sourceStateVersion + 1) throw new RangeError("glyphcss: WebGPU source RGB/version contract is invalid.");
    for (const value of rgb) if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("glyphcss: WebGPU sourceRgb must be finite normalized [0,1].");
    const sourceIdentity = identity(sourceFrame); if (sourceIdentity !== identity(targetFrame)) throw new TypeError("glyphcss: WebGPU source and target provenance must match.");
    if (!input.reset && stateVersion !== null && (stateVersion !== sourceStateVersion || currentIdentity !== sourceIdentity)) throw new Error("glyphcss: stale WebGPU atlas state is rejected.");
    const routingStart = profiled ? now() : 0;
    const nextSurfaceLayers = input.reset ? new Map<string, number>() : new Map(surfaceLayers);
    const surfaceIds = [...new Set([...sourceFrame.surfaceLookup, ...targetFrame.surfaceLookup])].sort();
    for (const surfaceId of surfaceIds) if (!nextSurfaceLayers.has(surfaceId)) {
      if (nextSurfaceLayers.size >= surfaceCapacity) throw new RangeError("glyphcss: WebGPU atlas surface capacity exceeded.");
      nextSurfaceLayers.set(surfaceId, nextSurfaceLayers.size);
    }
    const source = route(sourceFrame, nextSurfaceLayers), target = route(targetFrame, nextSurfaceLayers);
    const routingEnd = profiled ? now() : 0;
    let pendingFrame: FrameResources | null = null;
    let pendingPresentation: ReturnType<typeof createPresentationResource> | null = null;
    let querySet: Gpu | null = null, queryResolve: Gpu | null = null, queryReadback: Gpu | null = null;
    let uploadEnd = 0, dispatchEnd = 0, renderEnd = 0, submitEnd = 0;
    try {
      if (!frameResources || n > frameResources.capacity) pendingFrame = createFrameResources(n);
      const resources = pendingFrame ?? frameResources!;
      const width = sourceFrame.metadata.cols, height = sourceFrame.metadata.rows;
      if (canvas.width !== width || canvas.height !== height) throw new RangeError("glyphcss: WebGPU canvas dimensions must match the control-frame grid.");
      if (capturePresentation && (!presentationReadback || presentationWidth !== width || presentationHeight !== height)) pendingPresentation = createPresentationResource(width, height);
      const presentation = pendingPresentation?.resource ?? presentationReadback;
      const bytesPerRow = pendingPresentation?.bytesPerRow ?? presentationBytesPerRow;
      device.queue.writeBuffer(resources.sourceRoute, 0, source); device.queue.writeBuffer(resources.sourceRgb, 0, rgb); device.queue.writeBuffer(resources.targetRoute, 0, target);
      device.queue.writeBuffer(counts, 0, new Uint32Array([atlasEntries, n, n, width, height, input.reset ? 1 : 0, atlasSize, 0]));
      uploadEnd = profiled ? now() : 0;
      const timestampQuery = profiled && device.features?.has?.("timestamp-query") === true;
      if (timestampQuery) {
        querySet = device.createQuerySet({ type: "timestamp", count: 4 });
        queryResolve = buffer(32, BUFFER.QUERY_RESOLVE | BUFFER.COPY_SRC);
        queryReadback = buffer(32, BUFFER.COPY_DST | BUFFER.MAP_READ);
      }
      const encoder = device.createCommandEncoder();
      const run = (pipeline: Gpu, work: number, timestampWrites?: Record<string, unknown>) => { const pass = timestampWrites ? encoder.beginComputePass({ timestampWrites }) : encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, resources.computeGroup); pass.dispatchWorkgroups(Math.ceil(work / 64)); pass.end(); };
      if (querySet) {
        run(compute, atlasEntries, { querySet, beginningOfPassWriteIndex: 0 });
        if (input.reset) run(clearAtlasPipeline, atlasEntries);
        run(claimPipeline, n); run(resolvePipeline, atlasEntries); run(projectPipeline, n, { querySet, endOfPassWriteIndex: 1 });
      } else {
        run(compute, atlasEntries); if (input.reset) run(clearAtlasPipeline, atlasEntries); run(claimPipeline, n); run(resolvePipeline, atlasEntries); run(projectPipeline, n);
      }
      dispatchEnd = profiled ? now() : 0;
      const texture = context.getCurrentTexture();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }], ...(querySet ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } } : {}) });
      pass.setPipeline(renderPipeline); pass.setBindGroup(0, resources.renderCountsGroup); pass.setBindGroup(1, resources.renderGroup); pass.draw(3); pass.end();
      if (presentation) encoder.copyTextureToBuffer({ texture }, { buffer: presentation, bytesPerRow }, { width, height, depthOrArrayLayers: 1 });
      if (querySet) { encoder.resolveQuerySet(querySet, 0, 4, queryResolve, 0); encoder.copyBufferToBuffer(queryResolve, 0, queryReadback, 0, 32); }
      const command = encoder.finish();
      renderEnd = profiled ? now() : 0;
      device.queue.submit([command]);
      submitEnd = profiled ? now() : 0;
    } catch (error) {
      destroyFrameResources(pendingFrame);
      destroyGpu(pendingPresentation?.resource);
      destroyGpu(querySet); destroyGpu(queryResolve); destroyGpu(queryReadback);
      throw error;
    }
    if (pendingFrame) {
      destroyFrameResources(frameResources);
      frameResources = pendingFrame;
    }
    if (pendingPresentation) {
      destroyGpu(presentationReadback);
      presentationReadback = pendingPresentation.resource;
      presentationWidth = pendingPresentation.width; presentationHeight = pendingPresentation.height; presentationBytesPerRow = pendingPresentation.bytesPerRow;
    }
    surfaceLayers = nextSurfaceLayers;
    committedCells = n; stateVersion = targetStateVersion; currentIdentity = sourceIdentity; committedProvenance = glyphSurfaceAtlasProvenanceFromFrame(sourceFrame, sourceStateVersion);
    if (!profiled) return null;
    const cpuBeforeCompletion = { routingMs: routingEnd - routingStart, uploadEnqueueMs: uploadEnd - routingEnd, dispatchEncodingMs: dispatchEnd - uploadEnd, renderEncodingMs: renderEnd - dispatchEnd, canvasSubmitMs: submitEnd - renderEnd, submitTotalMs: submitEnd - submitStart };
    if (!querySet || !queryResolve || !queryReadback) {
      const completionStart = now();
      return device.queue.onSubmittedWorkDone().then(() => Object.freeze({ cpu: Object.freeze({ ...cpuBeforeCompletion, gpuCompletionMs: now() - completionStart }), gpu: Object.freeze({ timestampQuery: false, computeNs: null, renderNs: null, totalNs: null, unavailableReason: "The WebGPU device does not expose timestamp-query." }) }));
    }
    const profiledQuerySet = querySet, profiledResolve = queryResolve, profiledReadback = queryReadback;
    const completionStart = now();
    return (async () => {
      let mapped = false;
      try {
        await profiledReadback.mapAsync(1); mapped = true;
        if (lost || destroyed) throw new Error("glyphcss: WebGPU profiled submit was invalidated.");
        const values = new BigUint64Array(profiledReadback.getMappedRange().slice(0));
        const computeNs = Number(values[1]! - values[0]!);
        const renderNs = Number(values[3]! - values[2]!);
        return Object.freeze({ cpu: Object.freeze({ ...cpuBeforeCompletion, gpuCompletionMs: now() - completionStart }), gpu: Object.freeze({ timestampQuery: true, computeNs, renderNs, totalNs: computeNs + renderNs }) });
      } finally {
        if (mapped) { try { profiledReadback.unmap(); } catch {} }
        destroyGpu(profiledQuerySet); destroyGpu(profiledResolve); destroyGpu(profiledReadback);
      }
    })();
  };
  const submit = (input: GlyphSurfaceAtlasWebGpuSubmitOptions) => { submitInternal(input, false); };
  const submitProfiled = (input: GlyphSurfaceAtlasWebGpuSubmitOptions) => submitInternal(input, true)!;
  const readback = async (): Promise<GlyphSurfaceAtlasWebGpuReadback> => {
    if (lost || destroyed) throw new Error("glyphcss: WebGPU device was lost or session was destroyed; atlas readback is unavailable.");
    if (!frameResources || stateVersion === null) throw new Error("glyphcss: WebGPU atlas has no committed frame to read back.");
    const output = frameResources.output, n = committedCells, bytes = n * 6 * 4;
    const staging = buffer(bytes, BUFFER.COPY_DST | BUFFER.MAP_READ);
    let mapped = false;
    try {
      const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(output, 0, staging, 0, bytes); device.queue.submit([encoder.finish()]);
      await staging.mapAsync(1); mapped = true;
      if (lost || destroyed) throw new Error("glyphcss: WebGPU atlas readback was invalidated.");
      const data = new Float32Array(staging.getMappedRange().slice(0));
      return Object.freeze({ warpRgb: data.slice(0, n * 3), reprojectionValid: data.slice(n * 3, n * 4), disocclusion: data.slice(n * 4, n * 5), atlasConfidence: data.slice(n * 5, n * 6) });
    } finally {
      if (mapped) { try { staging.unmap(); } catch {} }
      destroyGpu(staging);
    }
  };
  const readPresentation = async (): Promise<GlyphSurfaceAtlasWebGpuPresentationReadback> => {
    if (lost || destroyed) throw new Error("glyphcss: WebGPU device was lost or session was destroyed; presentation readback is unavailable.");
    if (!presentationReadback || stateVersion === null) throw new Error("glyphcss: presentation capture was not enabled or has no committed frame.");
    if (presentationMapped) throw new Error("glyphcss: presentation readback is already in flight.");
    const readback = presentationReadback, width = presentationWidth, height = presentationHeight, bytesPerRow = presentationBytesPerRow;
    let mapped = false;
    presentationMapped = true;
    try {
      await readback.mapAsync(1); mapped = true;
      if (lost || destroyed) throw new Error("glyphcss: WebGPU presentation readback was invalidated.");
      return Object.freeze({ width, height, bytesPerRow, bgra: new Uint8Array(readback.getMappedRange().slice(0)) });
    } finally {
      if (mapped) { try { readback.unmap(); } catch {} }
      presentationMapped = false;
    }
  };
  const checkpoint = async (): Promise<GlyphSurfaceAtlasState> => {
    if (lost || destroyed || stateVersion === null || !committedProvenance) throw new Error("glyphcss: WebGPU atlas checkpoint is unavailable.");
    const checkpointVersion = stateVersion, checkpointProvenance = committedProvenance, checkpointLayers = new Map(surfaceLayers);
    const rgbBytes = atlasEntries * 3 * 4, confidenceBytes = atlasEntries * 4;
    let rgbReadback: Gpu | null = null, confidenceReadback: Gpu | null = null, rgbMapped = false, confidenceMapped = false;
    try {
      rgbReadback = buffer(rgbBytes, BUFFER.COPY_DST | BUFFER.MAP_READ); confidenceReadback = buffer(confidenceBytes, BUFFER.COPY_DST | BUFFER.MAP_READ);
      const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(atlas, 0, rgbReadback, 0, rgbBytes); encoder.copyBufferToBuffer(confidence, 0, confidenceReadback, 0, confidenceBytes); device.queue.submit([encoder.finish()]);
      const maps = await Promise.allSettled([rgbReadback.mapAsync(1), confidenceReadback.mapAsync(1)]);
      rgbMapped = maps[0]!.status === "fulfilled"; confidenceMapped = maps[1]!.status === "fulfilled";
      const rejected = maps.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      if (lost || destroyed) throw new Error("glyphcss: WebGPU atlas checkpoint was invalidated.");
      const rgb = new Float32Array(rgbReadback.getMappedRange().slice(0)), confidenceValues = new Uint32Array(confidenceReadback.getMappedRange().slice(0));
      const surfaces = [...checkpointLayers.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([surfaceId, layer]) => {
        const start = layer * atlasSlots, end = start + atlasSlots; let observed = false; for (let index = start; index < end; index++) if (confidenceValues[index] !== 0) { observed = true; break; }
        if (!observed) return [];
        const surfaceRgb = new Float32Array(atlasSlots * 3), surfaceConfidence = new Float32Array(atlasSlots);
        for (let texel = 0; texel < atlasSlots; texel++) { const slot = start + texel, from = slot * 3, to = texel * 3; surfaceRgb[to] = rgb[from]!; surfaceRgb[to + 1] = rgb[from + 1]!; surfaceRgb[to + 2] = rgb[from + 2]!; surfaceConfidence[texel] = confidenceValues[slot]!; }
        return [Object.freeze({ surfaceId, rgb: surfaceRgb, confidence: surfaceConfidence })];
      });
      return sealGlyphSurfaceAtlasState({ schemaVersion: "glyph-surface-atlas/v1", atlasSize, stateVersion: checkpointVersion, provenance: checkpointProvenance, surfaces: Object.freeze(surfaces) });
    } finally {
      if (rgbMapped) { try { rgbReadback?.unmap(); } catch {} }
      if (confidenceMapped) { try { confidenceReadback?.unmap(); } catch {} }
      destroyGpu(rgbReadback); destroyGpu(confidenceReadback);
    }
  };
  return Object.freeze({ atlasSize, device, submit, submitProfiled, readback, readPresentation, checkpoint, destroy: teardown });
}
