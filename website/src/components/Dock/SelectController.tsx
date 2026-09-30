import { Controller, type GUI } from "lil-gui";
import type { ReactNode } from "react";
import { BracketSelect } from "../BracketSelect";
import { IconToggle } from "../IconToggle";

/** lil-gui keeps folder/state ownership; React owns the shared dropdown through a Dock portal. */
export class SelectController<T extends string | number> extends Controller {
  private disposed = false;
  private choices: Record<string, T>;
  private renderWidget: (host: HTMLElement, content: ReactNode | null) => void;

  constructor(
    parent: GUI,
    proxy: { value: T },
    choices: Record<string, T>,
    renderWidget: (host: HTMLElement, content: ReactNode | null) => void,
    private presentation: "select" | "choices",
    private label: string,
  ) {
    super(parent, proxy, "value", "bracket-option");
    this.choices = choices;
    this.renderWidget = renderWidget;
    this.updateDisplay();
  }

  options(choices: Record<string, T>): this {
    this.choices = choices;
    return this.updateDisplay();
  }

  disable(disabled = true): this {
    super.disable(disabled);
    return this.updateDisplay();
  }

  updateDisplay(): this {
    const entries = Object.entries(this.choices);
    const selected = entries.findIndex(([, value]) => value === this.getValue());
    this.renderWidget(
      this.$widget,
      this.presentation === "choices" ? (
        <IconToggle
          groupLabel={this.label}
          value={String(selected)}
          options={entries.map(([label], index) => ({
            value: String(index),
            icon: label,
            label,
            disabled: this._disabled,
          }))}
          onChange={(index) => {
            this.setValue(entries[Number(index)]![1]);
            this._callOnFinishChange();
          }}
        />
      ) : (
        <BracketSelect
          aria-labelledby={this.$name.id}
          value={String(selected)}
          disabled={this._disabled}
          onChange={(event) => {
            this.setValue(entries[event.currentTarget.selectedIndex]![1]);
            this._callOnFinishChange();
          }}
        >
          {entries.map(([label], index) => (
            <option key={label} value={String(index)}>
              {label}
            </option>
          ))}
        </BracketSelect>
      ),
    );
    return this;
  }

  destroy(): void {
    // A parent folder can destroy its children before their React cleanup.
    if (this.disposed) return;
    this.disposed = true;
    this.renderWidget(this.$widget, null);
    super.destroy();
  }
}
