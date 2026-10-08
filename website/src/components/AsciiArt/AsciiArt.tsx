import { useEffect, useRef } from "react";
import type { Renderable } from "../../utils/ascii-layout/layout";
import styles from "./AsciiArt.module.css";
import { mountAsciiArt } from "./mountAsciiArt";
export interface AsciiArtProps {
  composition: Renderable;
  className?: string;
  minCols?: number;
  maxCols?: number;
  ariaLabel?: string;
}
export function AsciiArt({ composition, className = "", minCols, maxCols, ariaLabel }: AsciiArtProps) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return mountAsciiArt(ref.current, composition, { minCols, maxCols });
  }, [composition, minCols, maxCols]);
  return <pre ref={ref} className={`${styles.art} ${className}`} aria-label={ariaLabel} />;
}
