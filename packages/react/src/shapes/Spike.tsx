import type { ShapeInnerProps } from "./types";
import { getSurfaceColor, getSurfaceDelta, resolveSurfaceTexture, textureBrightnessFilter } from "./utils";
import { SvgSlope } from "./SvgSlope";

export function Spike({ voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps) {
  const primaryColor = getSurfaceColor(lighting, "primary", baseColor);
  const secondaryColor = getSurfaceColor(lighting, "secondary", baseColor);
  const primaryDelta = getSurfaceDelta(lighting, "primary");
  const secondaryDelta = getSurfaceDelta(lighting, "secondary");
  const primaryTexture = resolveSurfaceTexture(voxel, "primary", context);
  const secondaryTexture = resolveSurfaceTexture(voxel, "secondary", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  return (
    <>
      {showBottom && (
        <div
          className="voxcss-spike-bottom"
          style={{
            backgroundColor: bottomTexture ? undefined : baseColor,
            backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
            filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
          }}
        />
      )}
      <SvgSlope
        className="voxcss-spike-slope voxcss-spike-slope--primary"
        path="M480 0 L480 480 L0 480 Z"
        fill={primaryColor}
        textureUrl={primaryTexture}
        brightnessDelta={primaryDelta}
        debugBack={!!context.debugShowBackfaces}
      />
      <SvgSlope
        className="voxcss-spike-slope voxcss-spike-slope--secondary"
        path="M0 0 L0 480 L480 0 Z"
        fill={secondaryColor}
        width="50"
        height="56"
        textureUrl={secondaryTexture}
        brightnessDelta={secondaryDelta}
        debugBack={!!context.debugShowBackfaces}
      />
    </>
  );
}
