import { h } from "vue";
import type { ShapeInnerProps } from "./types";
import { getSurfaceColor, getSurfaceDelta, resolveSurfaceTexture, textureBrightnessFilter } from "./utils";
import { renderSvgSlope } from "./SvgSlope";

export function renderSpike(
  { voxel, context, baseColor, lighting, showBottom }: ShapeInnerProps,
) {
  const primaryColor = getSurfaceColor(lighting, "primary", baseColor);
  const secondaryColor = getSurfaceColor(lighting, "secondary", baseColor);
  const primaryDelta = getSurfaceDelta(lighting, "primary");
  const secondaryDelta = getSurfaceDelta(lighting, "secondary");
  const primaryTexture = resolveSurfaceTexture(voxel, "primary", context);
  const secondaryTexture = resolveSurfaceTexture(voxel, "secondary", context);
  const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);

  const children = [];
  if (showBottom) {
    children.push(
      h("div", {
        class: "voxcss-spike-bottom",
        style: {
          backgroundColor: bottomTexture ? undefined : baseColor,
          backgroundImage: bottomTexture ? `url(${bottomTexture})` : undefined,
          filter: bottomTexture ? textureBrightnessFilter(0) : undefined,
        },
      })
    );
  }
  children.push(
    renderSvgSlope(
      "voxcss-spike-slope voxcss-spike-slope--primary",
      "M480 0 L480 480 L0 480 Z",
      primaryColor,
      undefined,
      undefined,
      undefined,
      primaryTexture,
      primaryDelta,
    )
  );
  children.push(
    renderSvgSlope(
      "voxcss-spike-slope voxcss-spike-slope--secondary",
      "M0 0 L0 480 L480 0 Z",
      secondaryColor,
      undefined,
      "50",
      "56",
      secondaryTexture,
      secondaryDelta,
    )
  );

  return children;
}
