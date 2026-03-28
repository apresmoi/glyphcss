import { shadeColor } from "@layoutit/voxcss-core";

const FLOOR_BASE_DELTA = 120;

export interface CeilingProps {
  wallColor: string;
  dimensions: { rows: number; cols: number; depth: number };
  tileSize: number;
}

export function Ceiling({ wallColor, dimensions, tileSize }: CeilingProps) {
  const ceilingColor = shadeColor(wallColor, FLOOR_BASE_DELTA);
  return (
    <div
      className="voxcss-ceiling"
      style={
        {
          width: `${dimensions.cols * tileSize}px`,
          height: `${dimensions.rows * tileSize}px`,
          transform: `translateZ(${dimensions.depth * tileSize}px)`,
          "--voxcss-ceiling-base": ceilingColor,
          "--voxcss-ceiling-opacity": "0.35",
        } as React.CSSProperties
      }
    />
  );
}
