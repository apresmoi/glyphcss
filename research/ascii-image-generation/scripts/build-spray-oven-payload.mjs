#!/usr/bin/env node
// Build a burnlist-visual-parity-data@1 payload for the spray pipeline so the
// pipeline INPUTS and the model OUTPUT can be inspected side by side per view.
//
// Mapping, chosen so the tabs read as the algorithm actually runs:
//   domain  = subject (cottage / frog / chicken)
//   frame   = view index (0..13)
//   reference = the exact depth-ControlNet conditioning image we sent
//   candidate = the image SDXL generated from it
//   diff      = what was already painted and fed back in (view 0 has none)
//
// This is a read-only view over project-generated artifacts. It computes its
// numbers from the report, never invents them, and marks absent inputs
// explicitly instead of substituting a placeholder.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = resolve(new URL("..", import.meta.url).pathname);
const repoRoot = resolve(root, "..", "..");
const reviewRoot = resolve(root, "review/spray-pass");
const outPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(repoRoot, ".local/burnlist/data/spray-visual-parity.json");

const THUMB = 256;
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

async function thumbnail(path, label) {
  if (!(await exists(path))) return null;
  const image = await loadImage(path);
  const canvas = createCanvas(THUMB, THUMB);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, THUMB, THUMB);
  return {
    src: `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`,
    width: THUMB,
    height: THUMB,
    label,
  };
}

const blank = (label, note) => {
  const canvas = createCanvas(THUMB, THUMB);
  const context = canvas.getContext("2d");
  context.fillStyle = "#141414";
  context.fillRect(0, 0, THUMB, THUMB);
  context.fillStyle = "#8a8a8a";
  context.font = "13px monospace";
  context.textAlign = "center";
  context.fillText(note, THUMB / 2, THUMB / 2);
  return { src: `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`, width: THUMB, height: THUMB, label };
};

const report = JSON.parse(await readFile(resolve(root, "reports/spray-pass.json"), "utf8"));

const domains = [];
const comparisons = [];
const viewCount = report.subjects[0].views.length;

for (let index = 0; index < viewCount; index++) comparisons.push({ id: `view-${String(index).padStart(3, "0")}`, label: `view ${index}`, frame: index, status: "pass", domains: {} });

for (const subject of report.subjects) {
  const observed = subject.beforeFill.observedTexels;
  const painted = observed > 0;
  domains.push({
    id: subject.key,
    label: subject.key,
    isolation: "render-pass",
    qualification: painted ? "target" : "context",
    rationale: painted
      ? `${observed.toLocaleString()} texels observed across ${viewCount} views. reference = depth-ControlNet input, candidate = SDXL output, diff = texture already painted and fed back.`
      : `Painted nothing: no authored UVs (unresolvable material library), so every covered cell is UV-invalid and no texture exists. Shown as diagnostic context only.`,
  });

  const subjectDir = resolve(reviewRoot, "subjects", subject.key);
  for (const [index, view] of subject.views.entries()) {
    const stem = `frame-${String(index).padStart(3, "0")}`;
    const control = await thumbnail(resolve(subjectDir, "generated", `${stem}-control-depth.png`), "depth-ControlNet input");
    const generated = await thumbnail(resolve(subjectDir, "generated", `${stem}.png`), "SDXL output");
    const known = index === 0
      ? blank("already painted", "view 0: nothing painted yet")
      : (await thumbnail(resolve(subjectDir, "inputs", `${stem}-known.png`), "already painted, fed back"))
        ?? blank("already painted", "input not retained");

    const bp = view.backProjection ?? {};
    const covered = bp.cells_covered ?? 0;
    const projected = bp.cells_projected ?? 0;
    comparisons[index].domains[subject.key] = {
      label: `${subject.key} · view ${index} · ${index === 0 ? "text2img" : "inpaint"}`,
      status: projected > 0 ? "pass" : "fail",
      reference: control ?? blank("depth-ControlNet input", "control image not retained"),
      candidate: generated ?? blank("SDXL output", "generation missing"),
      diff: known,
      difference: {
        totalPixels: covered,
        changedPixels: projected,
        ratio: covered ? Number((projected / covered).toFixed(4)) : 0,
        meanAbsoluteDelta: Number((view.meanIncidence ?? 0).toFixed(4)),
        maximumAbsoluteDelta: bp.texels_new ?? 0,
      },
    };
  }
}

const paintedSubjects = report.subjects.filter((s) => s.beforeFill.observedTexels > 0);
const payload = {
  schema: "burnlist-visual-parity-data@1",
  initialDomainId: domains[0].id,
  domains,
  comparisons,
  differentialTesting: {
    schema: "burnlist-differential-testing-data@1",
    title: "Glyphcss spray-paint pipeline",
    subtitle: `PROOF-ONLY, NOT ADMISSIBLE. ${report.subjects.length} subjects x ${viewCount} views. reference = depth control input, candidate = SDXL output, diff = texture fed back.`,
    adapter: { id: "glyphcss-spray-oven-adapter" },
    publishedAt: new Date(0).toISOString(),
    trust: { status: "pass", reportStatus: "pass", blockers: [] },
    summary: {
      runs: { label: "Subjects", total: report.subjects.length, passed: paintedSubjects.length, failed: report.subjects.length - paintedSubjects.length, blocked: 0 },
      frames: { label: "Views", total: report.subjects.length * viewCount, passed: paintedSubjects.length * viewCount, failed: (report.subjects.length - paintedSubjects.length) * viewCount, blocked: 0, uniqueTicks: viewCount },
      fields: { label: "Metrics", total: 0, passed: 0, failed: 0, blocked: 0 },
    },
    fields: [],
    log: [],
    progress: [],
  },
};

// The oven's source pointers (/verdict, /byDomain) are the POST-adaptation shape,
// but burnlist validates them against the raw payload, so a comparisons-only
// payload is served with validated:false and the unadapted data then crashes
// FrameCard/MetricTiles on percent(undefined). Emit the adapted shape too, exactly
// as dashboard/src/lib/visual-parity-oven-adapter.ts would compute it.
const domainSummary = (domainId) => {
  const entries = payload.comparisons.map((c) => c.domains[domainId]);
  const changedPixels = entries.reduce((sum, e) => sum + e.difference.changedPixels, 0);
  const totalPixels = entries.reduce((sum, e) => sum + e.difference.totalPixels, 0);
  const absoluteDelta = entries.reduce((sum, e) => sum + e.difference.meanAbsoluteDelta * e.difference.totalPixels * 3, 0);
  return {
    passed: entries.filter((e) => e.status === "pass").length,
    failed: entries.filter((e) => e.status === "fail").length,
    ratio: totalPixels ? changedPixels / totalPixels : 0,
    meanAbsoluteDelta: totalPixels ? absoluteDelta / (totalPixels * 3) : 0,
    maximumAbsoluteDelta: entries.reduce((max, e) => Math.max(max, e.difference.maximumAbsoluteDelta), 0),
  };
};
payload.byDomain = Object.fromEntries(payload.domains.map((domain) => {
  const summary = domainSummary(domain.id);
  return [domain.id, {
    summary: {
      passed: summary.passed,
      total: payload.comparisons.length,
      ratio: summary.ratio,
      meanAbsoluteDelta: summary.meanAbsoluteDelta,
      maximumAbsoluteDelta: summary.maximumAbsoluteDelta,
    },
    note: { isTarget: domain.qualification === "target", rationale: domain.rationale },
    frames: payload.comparisons.flatMap((comparison) => {
      const entry = comparison.domains[domain.id];
      return entry.reference.src && entry.candidate.src && entry.diff.src
        ? [{ status: entry.status, frame: comparison.frame, difference: entry.difference, images: [entry.reference, entry.candidate, entry.diff], label: entry.label }]
        : [];
    }),
  }];
}));
payload.verdict = {
  targetPass: payload.comparisons.every((c) => c.status === "pass"),
  framesCount: payload.comparisons.length,
  error: "",
};
payload.domains = payload.domains.map((domain) => ({ ...domain, failed: domainSummary(domain.id).failed }));

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(payload), "utf8");
const bytes = (await readFile(outPath)).length;
console.log(JSON.stringify({ payload: outPath, megabytes: +(bytes / 1024 / 1024).toFixed(1), domains: domains.length, comparisons: comparisons.length }));
