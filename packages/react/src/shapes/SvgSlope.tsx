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
    </div>
  );
}
