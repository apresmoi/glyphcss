import { parsePureColor } from "@layoutit/polycss-react";
import type { MatrixPrecision, BorderShapePrecision } from "../types";
import { getInlineStyleDeclaration } from "./cssValues";

export function roundMatrix3dValue(value: string, decimals: number): string {
  return value.replace(/matrix3d\(([^)]+)\)/g, (_match, body: string) => {
    const rounded = body.split(",").map((raw) => {
      const trimmed = raw.trim();
      const value = Number(trimmed);
      if (!Number.isFinite(value)) return trimmed;
      const next = value.toFixed(decimals).replace(/\.?0+$/, "");
      return Object.is(Number(next), -0) ? "0" : next;
    });
    return `matrix3d(${rounded.join(",")})`;
  });
}

export function debugPrecisionDecimals(
  precision: MatrixPrecision | BorderShapePrecision,
): number | null {
  if (precision === "exact") return null;
  return Number(precision);
}

export function roundDecimalString(value: string, decimals: number): string {
  const next = Number(value).toFixed(decimals).replace(/\.?0+$/, "");
  return Object.is(Number(next), -0) ? "0" : next;
}

export function solidColorToHex(value: string): string | null {
  const parsed = parsePureColor(value);
  if (!parsed || parsed.alpha < 1) return null;
  const hex = parsed.rgb
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

export function replaceSolidRgbWithHex(value: string): string {
  return value.replace(/rgba?\([^)]*\)/gi, (match) => solidColorToHex(match) ?? match);
}

export function applyDebugSolidColorHex(root: HTMLElement | null): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>(".polycss-mesh, .polycss-scene b, .polycss-scene i, .polycss-scene u");
  for (const element of elements) {
    const current = element.getAttribute("style");
    if (!current || !/rgba?\(/i.test(current)) continue;
    const next = replaceSolidRgbWithHex(current);
    if (next !== current) element.setAttribute("style", next);
  }
}

export function compactStyleValue(value: string): string {
  return value.replace(/matrix3d\(([^)]*)\)/gi, (_match, body: string) =>
    `matrix3d(${body.split(",").map((token) => token.trim()).join(",")})`
  );
}

export function minifyInlineStyle(value: string): string {
  return compactStyleValue(value)
    .trim()
    .replace(/\s*:\s*/g, ":")
    .replace(/\s*;\s*/g, ";");
}

export const BRUSH_INLINE_STYLE_ORDER = new Map([
  ["transform", 0],
  ["border-shape", 1],
  ["border-width", 2],
  ["width", 3],
  ["height", 4],
  ["color", 5],
]);

export function orderBrushInlineStyle(value: string): string {
  const declarations = value.split(";").map((declaration) => declaration.trim()).filter(Boolean);
  return declarations
    .map((declaration, index) => {
      const property = declaration.slice(0, declaration.indexOf(":")).trim().toLowerCase();
      return {
        declaration,
        index,
        order: BRUSH_INLINE_STYLE_ORDER.get(property) ?? Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ declaration }) => declaration)
    .join(";");
}

export function applyDebugInlineStyleOrder(root: HTMLElement | null): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>(".polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u");
  for (const element of elements) {
    const current = element.getAttribute("style");
    if (!current) continue;
    const next = orderBrushInlineStyle(current);
    if (next !== current) element.setAttribute("style", next);
  }
}

export function applyDebugInlineStyleMinify(root: HTMLElement | null): void {
  if (!root) return;
  const elements = root.querySelectorAll<HTMLElement>(".polycss-mesh, .polycss-scene b, .polycss-scene i, .polycss-scene s, .polycss-scene u");
  for (const element of elements) {
    const current = element.getAttribute("style");
    if (!current) continue;
    const next = minifyInlineStyle(current);
    if (next !== current) element.setAttribute("style", next);
  }
}

export function applyDebugMatrixPrecision(root: HTMLElement | null, precision: MatrixPrecision): void {
  if (!root) return;
  const decimals = debugPrecisionDecimals(precision);
  if (decimals === null) return;
  const faces = root.querySelectorAll<HTMLElement>(".polycss-scene i, .polycss-scene b, .polycss-scene s, .polycss-scene u");
  for (const face of faces) {
    const current = face.style.transform;
    if (!current.includes("matrix3d(")) continue;
    const rounded = roundMatrix3dValue(current, decimals);
    if (current !== rounded) face.style.transform = rounded;
  }
}

export function applyDebugBorderShapePrecision(root: HTMLElement | null, precision: BorderShapePrecision): void {
  if (!root) return;
  const decimals = debugPrecisionDecimals(precision);
  if (decimals === null) return;
  const faces = root.querySelectorAll<HTMLElement>(".polycss-scene i");
  for (const face of faces) {
    const current = face.style.getPropertyValue("border-shape");
    if (!current.includes("polygon(")) continue;
    const rounded = current.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (match, offset, source) => {
      const prev = offset > 0 ? source[offset - 1] : "";
      const next = offset + match.length < source.length ? source[offset + match.length] : "";
      const unitContext = prev === "(" || prev === "," || /\s/.test(prev) || prev === "-" || prev === "+";
      const unitSuffix = next === "%" || /[a-z]/i.test(next);
      if (!unitContext || !unitSuffix) return match;
      return roundDecimalString(match, decimals);
    });
    if (current !== rounded) face.style.setProperty("border-shape", rounded);
  }
}

export function roundTriangleBorderWidthToken(token: string, decimals: number): string {
  const trimmed = token.trim();
  const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)$/i);
  if (!match) return trimmed;

  const unit = match[2] ?? "";
  if (unit && unit.toLowerCase() !== "px") return trimmed;

  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return trimmed;
  if (numeric === 0 || Object.is(numeric, -0)) return "0";

  const rounded = roundDecimalString(match[1], decimals);
  return Number(rounded) === 0 || Object.is(Number(rounded), -0)
    ? "0"
    : `${rounded}${unit || "px"}`;
}

export function roundTriangleBorderWidth(value: string, decimals: number): string {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return value;
  return tokens.map((token) => roundTriangleBorderWidthToken(token, decimals)).join(" ");
}

export function setInlineStyleDeclaration(face: HTMLElement, property: string, value: string): void {
  const current = face.getAttribute("style") ?? "";
  const declaration = `${property}:${value}`;
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|;)\\s*${escaped}\\s*:[^;]*`, "i");
  const next = pattern.test(current)
    ? current.replace(pattern, (_match, prefix: string) => `${prefix}${declaration}`)
    : `${current}${current.trim() && !current.trim().endsWith(";") ? ";" : ""}${declaration}`;
  if (next !== current) face.setAttribute("style", next);
}

export function applyDebugTriangleBrushPrecision(root: HTMLElement | null): void {
  if (!root) return;
  const decimals = 1;
  const faces = root.querySelectorAll<HTMLElement>(".polycss-scene u");
  for (const face of faces) {
    const styleAttr = face.getAttribute("style") ?? "";
    const current = getInlineStyleDeclaration(styleAttr, "border-width")
      ?? face.style.getPropertyValue("border-width").trim();
    if (!current) continue;
    const rounded = roundTriangleBorderWidth(current, decimals);
    if (current !== rounded) {
      setInlineStyleDeclaration(face, "border-width", rounded);
    }
  }
}
