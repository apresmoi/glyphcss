import type { ButtonHTMLAttributes } from "react";
import styles from "./ActionButton.module.css";

export function ActionButton({
  className = "",
  type = "button",
  compact = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly compact?: boolean }) {
  return (
    <button {...props} type={type} className={`${styles.root}${compact ? ` ${styles.compact}` : ""} ${className}`} />
  );
}
