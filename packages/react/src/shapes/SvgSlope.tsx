import { useId } from "react";
import { textureBrightnessFilter } from "./utils";

interface SvgSlopeProps {
  className: string;
  path: string;
  fill: string;
  viewBox?: string;
  width?: string;
  height?: string;
  textureUrl?: string;
  brightnessDelta?: number;
  /**
   * When true, render an additional sibling SVG that's rotated 180° on Y
   * (mirroring the slope) with an orange dashed-debug fill. The front SVG
   * gets its own `backface-visibility: hidden` so the browser hides whichever
   * isn't facing the camera — front view shows the original, back view shows
   * the orange copy.
   *
   * The wrapper div's own backface-visibility is set to `visible` in the
   * `.voxcss-debug-show-backfaces` scope (CSS in styles.ts) so both children
   * can render independently.
   */
  debugBack?: boolean;
}

export function SvgSlope({
  className,
  path,
  fill,
  viewBox = "0 0 480 480",
  width = "56",
  height = "50",
  textureUrl,
  brightnessDelta = 0,
  debugBack = false,
}: SvgSlopeProps) {
  const patternId = useId();

  const effectiveFill = textureUrl ? `url(#${patternId})` : fill;
  const filter = textureUrl ? textureBrightnessFilter(brightnessDelta) : undefined;

  return (
    <div className={className} style={{ filter }}>
      <svg
        viewBox={viewBox}
        width={width}
        height={height}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable={false as unknown as undefined}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
          backfaceVisibility: "hidden",
        }}
      >
        {textureUrl && (
          <defs>
            <pattern
              id={patternId}
              patternUnits="objectBoundingBox"
              patternContentUnits="objectBoundingBox"
              width="1"
              height="1"
            >
              <image
                width="1"
                height="1"
                preserveAspectRatio="xMidYMid slice"
                href={textureUrl}
              />
            </pattern>
          </defs>
        )}
        <path
          d={path}
          fill={effectiveFill}
          stroke="rgba(0, 0, 0, 0.1)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {debugBack && (
        <svg
          viewBox={viewBox}
          width={width}
          height={height}
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          focusable={false as unknown as undefined}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            pointerEvents: "none",
            // scale3d(1,1,-1) negates the local Z axis — that flips the
            // outward normal so the browser treats this as the back face,
            // but unlike rotateY(180deg) it does NOT mirror the visible
            // X/Y geometry. The orange shape ends up in the same screen
            // position as the front, just visible from the opposite side.
            transform: "scale3d(1, 1, -1)",
            transformOrigin: "center",
            backfaceVisibility: "hidden",
          }}
        >
          <path
            d={path}
            fill="rgba(249, 115, 22, 0.55)"
            stroke="rgba(249, 115, 22, 0.9)"
            strokeWidth="1"
            strokeDasharray="3,2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
    </div>
  );
}
