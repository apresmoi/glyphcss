import type { ShapeInnerProps } from "./types";
import { getSurfaceColor, getSurfaceDelta, resolveSurfaceTexture, textureBrightnessFilter } from "./utils";

export function Ramp({ voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps) {
  const slopeColor = getSurfaceColor(lighting, "slope", baseColor);
  const slopeDelta = getSurfaceDelta(lighting, "slope");
  const slopeTexture = resolveSurfaceTexture(voxel, "slope", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  return (
    <>
      {showBottom && (
        <div
          className="voxcss-ramp-bottom"
          style={{
            backgroundColor: bottomTexture ? undefined : baseColor,
            backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
            filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
          }}
        />
      )}
      <div
        className="voxcss-ramp-slope"
        style={{
          backgroundColor: slopeTexture ? undefined : slopeColor,
          backgroundImage: slopeTexture ? `url(${slopeTexture})` : undefined,
          backgroundSize: "70px 50px",
          filter: slopeTexture ? textureBrightnessFilter(slopeDelta) : undefined,
          // Exposed as a CSS var so the debug-back ::after can paint with the
          // same front color when the user looks at the slope from behind.
          ...(slopeTexture ? {} : { ["--voxcss-ramp-slope-color" as string]: slopeColor }),
        }}
      />
    </>
  );
}
