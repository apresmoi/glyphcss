import { classes } from "../../utils/classes/classes";
import { ActionButton } from "../ActionButton";
import styles from "./InstrumentMobileTabs.module.css";

export interface InstrumentMobileTab {
  readonly id: string;
  readonly label: string;
  readonly controls: string;
  readonly expanded: boolean;
  readonly onClick: () => void;
}

export function InstrumentMobileTabs({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly InstrumentMobileTab[];
}) {
  return (
    <nav className={`${styles.root} dn-mobile-tabs`} aria-label={label}>
      {items.map((item) => (
        <ActionButton
          type="button"
          compact
          className={classes("dn-mobile-tabs__button", item.expanded && "is-active")}
          aria-controls={item.controls}
          aria-expanded={item.expanded}
          onClick={item.onClick}
          key={item.id}
        >
          {item.label}
        </ActionButton>
      ))}
    </nav>
  );
}
