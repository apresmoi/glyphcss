import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";
import { parseMagicaVoxel, sceneController, mountScene } from "../dist/index.js";

class FakeStyle {
  setProperty(name, value) {
    this[name] = String(value);
  }
  removeProperty(name) {
    delete this[name];
  }
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }
  add(...names) {
    const set = this._toSet();
    for (const name of names) if (name) set.add(name);
    this.owner._className = Array.from(set).join(" ");
  }
  remove(...names) {
    const set = this._toSet();
    for (const name of names) if (name) set.delete(name);
    this.owner._className = Array.from(set).join(" ");
  }
  contains(name) {
    if (!name) return false;
    return this._toSet().has(name);
  }
  _toSet() {
    return new Set(this.owner._className.split(/\s+/).filter(Boolean));
  }
}

class FakeNode {
  constructor(doc, nodeType) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.parentElement = null;
  }
  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    const idx = siblings.indexOf(this);
    if (idx >= 0) siblings.splice(idx, 1);
    this.parentNode = null;
    this.parentElement = null;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName, doc) {
    super(doc, 1);
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.style = new FakeStyle();
    this._className = "";
    this.classList = new FakeClassList(this);
    this.id = "";
    this.textContent = "";
  }
  get className() {
    return this._className;
  }
  set className(value) {
    this._className = String(value ?? "");
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  appendChild(child) {
    if (!child) return null;
    if (child.parentNode) child.remove();
    this.children.push(child);
    child.parentNode = this;
    child.parentElement = this;
    return child;
  }
  insertBefore(child, referenceNode) {
    if (!child) return null;
    if (child.parentNode) child.remove();
    const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (idx >= 0) this.children.splice(idx, 0, child);
    else this.children.push(child);
    child.parentNode = this;
    child.parentElement = this;
    return child;
  }
  set innerHTML(value) {
    this.textContent = String(value ?? "");
    this.children = [];
  }
  get innerHTML() {
    return this.textContent;
  }
  setAttribute(name, value) {
    if (name === "id") this.id = String(value ?? "");
    else this[name] = String(value ?? "");
  }
  getAttribute(name) {
    return name === "id" ? this.id : this[name];
  }
}

class FakeComment extends FakeNode {
  constructor(data, doc) {
    super(doc, 8);
    this.data = data ?? "";
  }
}

class FakeDocument {
  constructor() {
    this._rafId = 0;
    this.documentElement = new FakeElement("html", this);
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.defaultView = {
      requestAnimationFrame: (cb) => {
        const id = (this._rafId += 1);
        cb();
        return id;
      },
      cancelAnimationFrame: () => {}
    };
  }
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
  createElementNS(_ns, tagName) {
    return this.createElement(tagName);
  }
  createComment(data) {
    return new FakeComment(data, this);
  }
  getElementById(id) {
    const needle = String(id ?? "");
    if (!needle) return null;
    const visit = (node) => {
      if (node?.nodeType === 1 && node.id === needle) return node;
      if (!node?.children) return null;
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.head) ?? visit(this.body);
  }
}

const countByClass = (root, className) => {
  let count = 0;
  const visit = (node) => {
    if (!node || node.nodeType !== 1) return;
    const classes = node.className ? node.className.split(/\s+/) : [];
    if (classes.includes(className)) count += 1;
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return count;
};

const getClassTokens = (node) => (node.className ? node.className.split(/\s+/).filter(Boolean) : []);

const hasClass = (node, className) => getClassTokens(node).includes(className);

const collectElements = (root, predicate) => {
  const matches = [];
  const visit = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (predicate(node)) matches.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return matches;
};

const findFirstByClass = (root, className) => {
  let found = null;
  const visit = (node) => {
    if (!node || node.nodeType !== 1 || found) return;
    if (hasClass(node, className)) {
      found = node;
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return found;
};

const parseGridArea = (value) => {
  if (!value) return null;
  const parts = String(value).split("/").map((part) => part.trim());
  if (parts.length < 4) return null;
  const nums = parts.slice(0, 4).map((part) => Number(part));
  if (nums.some((num) => !Number.isFinite(num))) return null;
  const [r0, c0, r1, c1] = nums;
  return { r0, c0, r1, c1 };
};

const parseNumber = (value) => {
  if (value == null) return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;
  const cleaned = raw.endsWith("px") ? raw.slice(0, -2) : raw;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : NaN;
};

const summarizePlaneFaces = (root, filePath) => {
  const planeFaces = collectElements(root, (node) => hasClass(node, "voxcss-plane-face"));
  const faceKeys = ["t", "b", "bl", "br", "fr", "fl"];
  const facesByOrientation = Object.fromEntries(faceKeys.map((key) => [key, 0]));
  const gridCellsByOrientation = Object.fromEntries(faceKeys.map((key) => [key, 0]));
  let gridCellsTotal = 0;
  let gridAreaMissing = 0;
  let baseColorFaces = 0;
  let transparentBaseFaces = 0;
  const uniqueBaseColors = new Set();
  let detailBeforeFaces = 0;
  let detailAfterFaces = 0;
  let detailAnyFaces = 0;
  let detailBeforeAreaPx = 0;
  let detailAfterAreaPx = 0;
  let svgHosts = 0;
  let svgPaths = 0;
  let stampPathBytes = 0;

  for (const face of planeFaces) {
    const classes = getClassTokens(face);
    const faceClass = classes.find((cls) => cls.startsWith("voxcss-plane-face--"));
    const faceKey = faceClass ? faceClass.slice("voxcss-plane-face--".length) : "unknown";
    if (!(faceKey in facesByOrientation)) facesByOrientation[faceKey] = 0;
    if (!(faceKey in gridCellsByOrientation)) gridCellsByOrientation[faceKey] = 0;
    facesByOrientation[faceKey] += 1;

    const gridArea = parseGridArea(face.style.gridArea);
    if (!gridArea) {
      gridAreaMissing += 1;
    } else {
      const area = Math.max(0, gridArea.r1 - gridArea.r0) * Math.max(0, gridArea.c1 - gridArea.c0);
      gridCellsTotal += area;
      gridCellsByOrientation[faceKey] += area;
    }

    const baseColor = String(face.style.backgroundColor ?? "").trim();
    if (baseColor && baseColor !== "transparent") {
      baseColorFaces += 1;
      uniqueBaseColors.add(baseColor);
    } else {
      transparentBaseFaces += 1;
    }

    const beforeOpacity = parseNumber(face.style["--voxcss-plane-detail-before-opacity"]);
    const afterOpacity = parseNumber(face.style["--voxcss-plane-detail-after-opacity"]);
    const hasBefore = Number.isFinite(beforeOpacity) && beforeOpacity > 0;
    const hasAfter = Number.isFinite(afterOpacity) && afterOpacity > 0;
    if (hasBefore) {
      detailBeforeFaces += 1;
      const width = parseNumber(face.style["--voxcss-plane-detail-before-width"]);
      const height = parseNumber(face.style["--voxcss-plane-detail-before-height"]);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        detailBeforeAreaPx += Math.max(0, width) * Math.max(0, height);
      }
    }
    if (hasAfter) {
      detailAfterFaces += 1;
      const width = parseNumber(face.style["--voxcss-plane-detail-after-width"]);
      const height = parseNumber(face.style["--voxcss-plane-detail-after-height"]);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        detailAfterAreaPx += Math.max(0, width) * Math.max(0, height);
      }
    }
    if (hasBefore || hasAfter) detailAnyFaces += 1;

    const svgNodes = collectElements(face, (node) => node.tagName === "SVG");
    if (svgNodes.length) svgHosts += 1;
    const pathNodes = collectElements(face, (node) => node.tagName === "PATH");
    svgPaths += pathNodes.length;
    for (const pathNode of pathNodes) {
      const d = pathNode.getAttribute?.("d") ?? "";
      stampPathBytes += String(d).length;
    }
  }

  const facesByAxis = {};
  for (const [axis, className] of [
    ["z", "voxcss-floor-z"],
    ["x", "voxcss-floor-x"],
    ["y", "voxcss-floor-y"]
  ]) {
    const host = findFirstByClass(root, className);
    facesByAxis[axis] = host ? collectElements(host, (node) => hasClass(node, "voxcss-plane-face")).length : 0;
  }

  return {
    file: path.relative(process.cwd(), filePath),
    planeFaces: planeFaces.length,
    facesByAxis,
    facesByOrientation,
    gridCellsTotal,
    gridCellsByOrientation,
    gridAreaMissing,
    baseColorFaces,
    transparentBaseFaces,
    uniqueBaseColors: uniqueBaseColors.size,
    detailBeforeFaces,
    detailAfterFaces,
    detailAnyFaces,
    detailBeforeAreaPx,
    detailAfterAreaPx,
    detailAreaTotalPx: detailBeforeAreaPx + detailAfterAreaPx,
    svgHosts,
    svgPaths,
    stampPathBytes
  };
};

const args = process.argv.slice(2);
const shouldBuild = args.includes("--build");
const waitArg = args.find((arg) => arg.startsWith("--wait="));
const waitMs = waitArg ? Math.max(0, Number.parseInt(waitArg.slice(7), 10) || 0) : 30;
const fileArg = args.find((arg) => !arg.startsWith("--")) ?? "docs/scene_army.vox";
const filePath = path.resolve(process.cwd(), fileArg);
const rendererMode = process.env.VOXCSS_PLANE_SHELL_RENDERER;
if (rendererMode) {
  globalThis.__VOXCSS_PLANE_SHELL_RENDERER__ = rendererMode;
}

if (shouldBuild) {
  execSync("npm run build", { stdio: "inherit" });
}

const data = fs.readFileSync(filePath);
const { voxels, rows, cols, depth } = parseMagicaVoxel(data);

const documentRef = new FakeDocument();
globalThis.document = documentRef;
globalThis.getComputedStyle = (el) => {
  const raw = String(el?.style?.color ?? "").trim();
  if (!raw) return { color: "" };
  if (/^rgb\(/i.test(raw)) return { color: raw };
  if (raw[0] === "#" && (raw.length === 7 || raw.length === 4)) {
    const hex = raw.length === 4
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return { color: `rgb(${r}, ${g}, ${b})` };
  }
  return { color: raw };
};
const root = documentRef.createElement("div");
documentRef.body.appendChild(root);

const controller = sceneController();
const binding = mountScene({
  controller,
  element: root,
  voxels,
  rows,
  cols,
  depth,
  showWalls: false,
  showFloor: false,
  projection: "cubic",
  mergeVoxels: "3d"
});

if (waitMs) {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

const planeFaceCount = countByClass(root, "voxcss-plane-face");
console.log(`plane-shell quads: ${planeFaceCount}`);
console.log("plane-shell summary:", summarizePlaneFaces(root, filePath));

binding.destroy();
