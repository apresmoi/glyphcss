import { type ReactNode } from "react";
import { classes } from "../../utils/classes/classes";

export function InstrumentRail({
  id,
  title,
  action,
  open,
  children,
  toolbar,
  footer,
  className,
  size,
  bodyInset,
}: {
  readonly id: string;
  readonly title: ReactNode;
  readonly action?: ReactNode;
  readonly open?: boolean;
  readonly children: ReactNode;
  readonly toolbar?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly size?: "editor";
  readonly bodyInset?: "inline";
}) {
  return (
    <aside data-size={size} id={id} className={classes("synth-voices", open && "is-mobile-open", className)}>
      {(title || action) && (
        <div className="synth-voices-head">
          <span>{title}</span>
          {action}
        </div>
      )}
      {toolbar && <div className="instrument-rail-toolbar">{toolbar}</div>}
      <div className="synth-voices-list" data-inset={bodyInset}>
        {children}
      </div>
      {footer && <div className="instrument-rail-footer">{footer}</div>}
    </aside>
  );
}
