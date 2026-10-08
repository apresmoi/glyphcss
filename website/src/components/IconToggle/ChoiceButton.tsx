import type { ButtonHTMLAttributes } from "react";
import styles from "./ChoiceButton.module.css";

export function ChoiceButton({
  className = "",
  type = "button",
  align,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { align?: "center" | "start" }) {
  return <button {...props} type={type} data-align={align} className={`${styles.button} ${className}`} />;
}
