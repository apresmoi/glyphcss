import { type SVGProps } from "react";

// Shared controls live outside any page so importing a selector never pulls
// in Synth's scene, effects, or preview machinery.
export function ToggleIcon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}
