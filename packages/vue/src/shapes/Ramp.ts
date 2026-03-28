import { h } from "vue";
import type { ShapeInnerProps } from "./types";
import { getSurfaceColor, getSurfaceDelta, resolveSurfaceTexture, textureBrightnessFilter } from "./utils";

export function renderRamp(
  { voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps,
) {
  const slopeColor = getSurfaceColor(lighting, "slope", baseColor);
  const slopeDelta = getSurfaceDelta(lighting, "slope");
  const slopeTexture = resolveSurfaceTexture(voxel, "slope", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  const children = [];
  if (showBottom) {
    children.push(
      h("div", {
        class: "voxcss-ramp-bottom",
        style: {
          backgroundColor: bottomTexture ? undefined : baseColor,
          backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
          filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
        },
      })
    );
  }
  children.push(
    h("div", {
      class: "voxcss-ramp-slope",
      style: {
        backgroundColor: slopeTexture ? undefined : slopeColor,
        backgroundImage: slopeTexture ? `url(${slopeTexture})` : undefined,
        backgroundSize: "70px 50px",
        filter: slopeTexture ? textureBrightnessFilter(slopeDelta) : undefined,
      },
    })
  );

  return children;
}
