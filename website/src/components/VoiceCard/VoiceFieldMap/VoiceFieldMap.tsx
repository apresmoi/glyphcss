import { type ReactNode } from "react";
import { type Params, VOICE_FIELD_MAP_BASE_ANGLE, voiceFieldMapKind } from "../../../features/synth/model/parameters";

export function VoiceFieldMap({
  params,
  slot,
  keyPrefix = "",
  fallbackColor = "#7df9ff",
}: {
  params: Params;
  slot: number;
  /** `"c"` for a colour voice (`cfield${slot}`/`corigin…${slot}`/…) — see
   *  `ColorVoiceCard` below. Defaults to `""` (geometry voice keys), every
   *  existing caller's behavior unchanged. */
  keyPrefix?: string;
  /** Colour voices have no per-voice `color${slot}` param of their own (the
   *  combined colour comes from `colorMode`, not an individual swatch) — this
   *  is the mark colour to fall back to when `${keyPrefix}color${slot}`
   *  doesn't exist in `params`. Unused by the default geometry-voice call
   *  (`color${slot}` always exists there). */
  fallbackColor?: string;
}) {
  const size = 100;
  const marks: ReactNode[] = [];
  {
    const field = String(params[`${keyPrefix}field${slot}`]);
    const color = String(params[`${keyPrefix}color${slot}`] ?? fallbackColor);
    const ox = (0.5 + Number(params[`${keyPrefix}originU${slot}`] ?? 0)) * size;
    const oy = (0.5 + Number(params[`${keyPrefix}originV${slot}`] ?? 0)) * size;
    const deg = Number(params[`${keyPrefix}angle${slot}`] ?? 0) + (VOICE_FIELD_MAP_BASE_ANGLE[field] ?? 0);
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad),
      dy = Math.sin(rad);
    const key = `v${slot}`;
    const kind = voiceFieldMapKind(field);
    if (kind === "linear") {
      const L = 30;
      marks.push(
        <g key={key} stroke={color} fill={color}>
          <line
            x1={ox - dx * L}
            y1={oy - dy * L}
            x2={ox + dx * L}
            y2={oy + dy * L}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
          {/* wavefront tick: perpendicular to travel */}
          <line
            x1={ox - dy * 9}
            y1={oy + dx * 9}
            x2={ox + dy * 9}
            y2={oy - dx * 9}
            strokeWidth={1}
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={ox + dx * L} cy={oy + dy * L} r={2.6} stroke="none" />
        </g>,
      );
    } else if (kind === "ring") {
      marks.push(
        <g key={key} stroke={color} fill="none">
          <circle
            cx={ox}
            cy={oy}
            r={16}
            strokeWidth={1.2}
            strokeDasharray={field === "noise" ? "3 3" : undefined}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={ox} cy={oy} r={2.6} fill={color} stroke="none" />
        </g>,
      );
    } else if (kind === "no-direction") {
      // A genuinely out-of-plane axis (`linearZ`) or a per-cell, non-spatial
      // value (the four normal-derived kinds — `fieldHasPlacement` above is
      // `false` for these, so a live colour voice card never actually opens
      // this map on one; kept here so this switch stays exhaustive rather
      // than silently mishandling a field it doesn't recognize, the same
      // "hardcoded-N latent bug" class VOLUMETRIC-4.md calls out) has no 2D
      // direction to draw — mark the centre and label it instead.
      marks.push(
        <g key={key}>
          <circle cx={ox} cy={oy} r={2.6} fill={color} stroke="none" />
          <text x={ox + 6} y={oy + 3} fontSize="9" fill={color}>
            {field === "linearZ" ? "Z" : "n"}
          </text>
        </g>,
      );
    } else {
      const L = 30;
      marks.push(
        <g key={key} stroke={color} fill="none">
          <path
            d={`M ${ox} ${oy} L ${ox + dx * L} ${oy + dy * L}`}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={ox} cy={oy} r={9} strokeWidth={1} opacity={0.55} vectorEffect="non-scaling-stroke" />
          <circle cx={ox} cy={oy} r={2.6} fill={color} stroke="none" />
        </g>,
      );
    }
  }
  // Its own diagram, sitting beside the waveform in the card's left column.
  // The waveform is a dedicated read of freq/speed/mix; this is the same idea
  // for angle/u/v. Painted OVER the rendered field it just fought the render —
  // two different kinds of picture stacked on one another.
  return (
    <svg className="voice-fieldmap" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={size / 2} y1={0} x2={size / 2} y2={size} className="voice-fieldmap-axis" />
      <line x1={0} y1={size / 2} x2={size} y2={size / 2} className="voice-fieldmap-axis" />
      {marks}
    </svg>
  );
}
