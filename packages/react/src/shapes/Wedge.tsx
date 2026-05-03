import type { ShapeInnerProps } from "./types";
import { getSurfaceColor, getSurfaceDelta, resolveSurfaceTexture, textureBrightnessFilter } from "./utils";
import { SvgSlope } from "./SvgSlope";

export function Wedge({ voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps) {
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
          className="voxcss-wedge-bottom"
          style={{
            backgroundColor: bottomTexture ? undefined : baseColor,
            backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
            filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
          }}
        />
      )}
      <SvgSlope
        className="voxcss-wedge-slope voxcss-wedge-slope--primary"
        path="M0 0 L480 0 L0 480 Z"
        fill={primaryColor}
        textureUrl={primaryTexture}
        brightnessDelta={primaryDelta}
        debugBack={!!context.debugShowBackfaces}
      />
      <SvgSlope
        className="voxcss-wedge-slope voxcss-wedge-slope--secondary"
        path="M480 480 L0 480 L480 0 Z"
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
