import { h } from "vue";
import { textureBrightnessFilter } from "./utils";

let _patternIdCounter = 0;
function nextPatternId(): string {
  return `vox-pat-${++_patternIdCounter}`;
}

export function renderSvgSlope(
  className: string,
  path: string,
  fill: string,
  viewBox = "0 0 480 480",
  width = "56",
  height = "50",
  textureUrl?: string,
  brightnessDelta = 0,
) {
  const patternId = textureUrl ? nextPatternId() : "";
  const effectiveFill = textureUrl ? `url(#${patternId})` : fill;
  const filter = textureUrl ? textureBrightnessFilter(brightnessDelta) : undefined;

  const defs = textureUrl
    ? h("defs", null, [
        h("pattern", {
          id: patternId,
          patternUnits: "objectBoundingBox",
          patternContentUnits: "objectBoundingBox",
          width: "1",
          height: "1",
        }, [
          h("image", {
            width: "1",
            height: "1",
            preserveAspectRatio: "xMidYMid slice",
            href: textureUrl,
          }),
        ]),
      ])
    : null;

  return h("div", { class: className, style: { filter } }, [
    h(
      "svg",
      {
        viewBox,
        width,
        height,
        preserveAspectRatio: "none",
        xmlns: "http://www.w3.org/2000/svg",
        "aria-hidden": "true",
        focusable: "false",
        style: {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "none",
        },
      },
      [
        defs,
        h("path", {
          d: path,
          fill: effectiveFill,
          stroke: "rgba(0, 0, 0, 0.1)",
          "stroke-width": "1",
          "vector-effect": "non-scaling-stroke",
        }),
      ]
    ),
  ]);
}
