import { type SelectHTMLAttributes } from "react";
import styles from "./BracketSelect.module.css";

/** Native selects retain their keyboard and mobile picker behavior; the
 * surrounding glyphs only provide the shared visual treatment. */
export function BracketSelect({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`${styles.root} gx-select ${className}`}>
      <select {...props} />
    </span>
  );
}
