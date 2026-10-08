import { type ReactNode } from "react";
import { classes } from "../../../utils/classes/classes";
import { InstrumentSectionHeading } from "../InstrumentSectionHeading";

export function PresetTray({
  id,
  label,
  open,
  title = "Presets",
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly open?: boolean;
  readonly title?: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} className={classes("instrument-tray", open && "is-mobile-open")} aria-label={label}>
      <InstrumentSectionHeading>{title}</InstrumentSectionHeading>
      <div className="synth-presets" role="list" aria-label={label}>
        {children}
      </div>
    </section>
  );
}
